//! Stage E: High-recall hybrid candidate retrieval combining FTS5 lexical
//! signals, stemmed multi-field concept matching, negative exclusion contrast,
//! same-model embedding cosine similarity, and bounded feed-specific feedback
//! priors.

use super::models::{EmbeddingRole, FeedbackType, SmartFeed, SmartFeedEmbeddingRecord};
use super::normalize::{collapse_whitespace, ArticleSnapshot};
use std::collections::{HashMap, HashSet};

const STOPWORDS: &[&str] = &[
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "over",
    "about",
    "involving",
    "related",
    "including",
    "without",
    "generic",
    "unrelated",
    "everyday",
    "meaningful",
    "connection",
    "specified",
    "important",
    "developments",
    "articles",
    "content",
    "news",
    "other",
    "more",
    "most",
    "some",
    "such",
    "than",
    "then",
    "them",
    "they",
    "their",
    "there",
    "these",
    "those",
    "have",
    "has",
    "had",
    "will",
    "would",
    "could",
    "should",
    "being",
    "been",
    "are",
    "was",
    "were",
    "can",
    "not",
    "but",
    "all",
    "any",
    "only",
    "also",
    "very",
    "well",
    "new",
    "how",
    "why",
    "what",
    "when",
    "where",
    "which",
    "who",
    "its",
    "our",
    "your",
    "you",
];

const BOILERPLATE_EXCLUSION_WORDS: &[&str] = &[
    "unrelated",
    "without",
    "generic",
    "everyday",
    "meaningful",
    "connection",
    "specified",
    "news",
    "content",
    "articles",
    "information",
    "substantive",
];

/// Lightweight deterministic suffix stemmer (English-focused Porter-lite).
pub fn stem_token(raw: &str) -> String {
    let w = raw.to_lowercase();
    let len = w.chars().count();
    if len <= 3 {
        return w;
    }
    let bytes = w.as_str();
    let stripped = if len > 6 && bytes.ends_with("ization") {
        &bytes[..bytes.len() - 7]
    } else if len > 6 && bytes.ends_with("ations") {
        &bytes[..bytes.len() - 6]
    } else if len > 5 && bytes.ends_with("ation") {
        &bytes[..bytes.len() - 5]
    } else if len > 6 && bytes.ends_with("ities") {
        &bytes[..bytes.len() - 5]
    } else if len > 5 && bytes.ends_with("ments") {
        &bytes[..bytes.len() - 5]
    } else if len > 4 && bytes.ends_with("ment") {
        &bytes[..bytes.len() - 4]
    } else if len > 5 && bytes.ends_with("ness") {
        &bytes[..bytes.len() - 4]
    } else if len > 5 && bytes.ends_with("ings") {
        &bytes[..bytes.len() - 4]
    } else if len > 4 && bytes.ends_with("ing") {
        &bytes[..bytes.len() - 3]
    } else if len > 4 && bytes.ends_with("ies") {
        &bytes[..bytes.len() - 3]
    } else if len > 4 && bytes.ends_with("ers") {
        &bytes[..bytes.len() - 3]
    } else if len > 4 && bytes.ends_with("ed") {
        &bytes[..bytes.len() - 2]
    } else if len > 4 && bytes.ends_with("es") {
        &bytes[..bytes.len() - 2]
    } else if len > 4 && bytes.ends_with("ly") {
        &bytes[..bytes.len() - 2]
    } else if len > 4 && bytes.ends_with("al") {
        &bytes[..bytes.len() - 2]
    } else if len > 3 && bytes.ends_with('s') && !bytes.ends_with("ss") {
        &bytes[..bytes.len() - 1]
    } else {
        bytes
    };
    let s = stripped.trim_end_matches(|c| c == 'e' && stripped.len() > 4);
    if s.chars().count() >= 3 {
        s.to_string()
    } else {
        w
    }
}

/// Extract normalized stemmed tokens from arbitrary text. Keeps 2-char uppercase
/// acronyms like `AI`, `ML`, `CS`, `OS`, `UI` when original text is uppercase
/// or explicitly tokenizable, plus all >=3-char alphanumeric tokens.
pub fn tokenize_stems(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for raw in text.split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_') {
        let cleaned = raw.trim_matches(|c: char| !c.is_alphanumeric());
        if cleaned.is_empty() {
            continue;
        }
        let lower = cleaned.to_lowercase();
        let char_count = lower.chars().count();
        let is_short_acronym = char_count == 2
            && cleaned
                .chars()
                .all(|c| c.is_ascii_alphabetic() && c.is_ascii_uppercase());
        if char_count < 3 && !is_short_acronym {
            continue;
        }
        if STOPWORDS.contains(&lower.as_str()) {
            continue;
        }
        if lower.contains('-') || lower.contains('_') {
            out.push(lower.clone());
            for sub in lower.split(|c| c == '-' || c == '_') {
                if sub.chars().count() >= 3 && !STOPWORDS.contains(&sub) {
                    out.push(stem_token(sub));
                }
            }
        } else {
            out.push(stem_token(&lower));
        }
    }
    out
}

/// Extract normalized multi-word 2-gram phrases from adjacent meaningful tokens.
pub fn extract_phrases(text: &str) -> Vec<String> {
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .map(|w| w.trim().to_lowercase())
        .filter(|w| !w.is_empty() && !STOPWORDS.contains(&w.as_str()))
        .map(|w| stem_token(&w))
        .collect();
    if words.len() < 2 {
        return Vec::new();
    }
    words
        .windows(2)
        .filter(|w| w[0] != w[1])
        .map(|w| format!("{} {}", w[0], w[1]))
        .collect()
}

/// Extract capitalized entity sequences (e.g., "DeepSeek", "Strait of Hormuz")
/// from text for high-recall entity retention.
pub fn extract_entities(text: &str) -> Vec<String> {
    let mut entities = Vec::new();
    let mut current: Vec<String> = Vec::new();
    for token in text.split_whitespace() {
        let trimmed = token.trim_matches(|c: char| !c.is_alphanumeric() && c != '-');
        let starts_upper = trimmed
            .chars()
            .next()
            .map(|c| c.is_uppercase())
            .unwrap_or(false);
        if starts_upper && trimmed.chars().count() >= 2 {
            current.push(trimmed.to_lowercase());
        } else if !current.is_empty() {
            if current.len() >= 2 || current[0].chars().count() >= 3 {
                entities.push(current.join(" "));
            }
            current.clear();
        }
    }
    if !current.is_empty() && (current.len() >= 2 || current[0].chars().count() >= 3) {
        entities.push(current.join(" "));
    }
    entities
}

#[derive(Debug, Clone)]
pub struct FeedQueryProfile {
    pub positive_stems: HashMap<String, f64>, // stem -> specificity weight
    pub positive_phrases: HashSet<String>,
    pub negative_stems: HashSet<String>,
    pub negative_phrases: HashSet<String>,
    pub feedback_term_weights: HashMap<String, f64>, // bounded [-0.12, +0.12]
    pub positive_embedding: Option<SmartFeedEmbeddingRecord>,
    pub negative_embedding: Option<SmartFeedEmbeddingRecord>,
    pub feedback_pos_embedding: Option<SmartFeedEmbeddingRecord>,
    pub feedback_neg_embedding: Option<SmartFeedEmbeddingRecord>,
    pub fts_query: Option<String>,
}

/// Build a structured query profile from a Smart Feed's definition, persisted
/// definition/feedback embeddings, and feedback-learned lexical priors.
pub fn build_feed_query_profile(
    feed: &SmartFeed,
    embeddings: &[SmartFeedEmbeddingRecord],
    feedback_articles: &[(FeedbackType, ArticleSnapshot)],
) -> FeedQueryProfile {
    let pos_text = format!(
        "{}\n{}\n{}",
        feed.name, feed.description, feed.inclusion_criteria
    );
    let mut stem_counts: HashMap<String, usize> = HashMap::new();
    let mut ordered_raw_tokens: Vec<String> = Vec::new();

    for raw in pos_text.split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_') {
        let cleaned = raw.trim_matches(|c: char| !c.is_alphanumeric());
        if cleaned.len() >= 2 {
            ordered_raw_tokens.push(cleaned.to_string());
        }
    }

    for stem in tokenize_stems(&pos_text) {
        *stem_counts.entry(stem).or_insert(0) += 1;
    }

    // Weight name/title tokens slightly less if single-word generic, and give
    // distinctive rare domain terms higher specificity weight.
    let mut positive_stems: HashMap<String, f64> = HashMap::new();
    for (stem, count) in &stem_counts {
        let base_w = if stem.chars().count() <= 2 {
            0.55 // short acronym like "ai", "cs" — needs corroboration
        } else if *count > 1 {
            1.15
        } else {
            1.0
        };
        positive_stems.insert(stem.clone(), base_w);
    }

    let positive_phrases: HashSet<String> = extract_phrases(&pos_text).into_iter().collect();

    // Parse exclusions independently, subtracting shared positive stems and
    // boilerplate words so e.g. "Iran" in "Iranian tourism" never penalizes
    // genuine Iran War reporting.
    let mut negative_stems = HashSet::new();
    for stem in tokenize_stems(&feed.exclusion_criteria) {
        if !positive_stems.contains_key(&stem)
            && !BOILERPLATE_EXCLUSION_WORDS.contains(&stem.as_str())
        {
            negative_stems.insert(stem);
        }
    }
    let negative_phrases: HashSet<String> = extract_phrases(&feed.exclusion_criteria)
        .into_iter()
        .filter(|ph| !positive_phrases.contains(ph))
        .collect();

    // Compute bounded Laplace-smoothed log-odds lexical priors from active
    // feed-specific feedback events. Damped so 1 correction never overfits.
    let feedback_term_weights =
        compute_feedback_lexical_weights(feedback_articles, &positive_stems);

    // Build safe FTS5 OR query from up to 14 top non-acronym raw tokens.
    let mut fts_terms: Vec<String> = Vec::new();
    let mut seen_fts = HashSet::new();
    for tok in &ordered_raw_tokens {
        let lower = tok.to_lowercase();
        if lower.chars().count() >= 3
            && !STOPWORDS.contains(&lower.as_str())
            && lower.chars().all(|c| c.is_alphanumeric())
            && seen_fts.insert(lower.clone())
        {
            fts_terms.push(format!("\"{}\"", lower));
            if fts_terms.len() >= 14 {
                break;
            }
        }
    }
    let fts_query = if fts_terms.is_empty() {
        None
    } else {
        Some(fts_terms.join(" OR "))
    };

    let find_role = |role: EmbeddingRole| {
        embeddings
            .iter()
            .find(|e| e.role == role && !e.embedding.is_empty())
            .cloned()
    };

    FeedQueryProfile {
        positive_stems,
        positive_phrases,
        negative_stems,
        negative_phrases,
        feedback_term_weights,
        positive_embedding: find_role(EmbeddingRole::Positive),
        negative_embedding: find_role(EmbeddingRole::Negative),
        feedback_pos_embedding: find_role(EmbeddingRole::FeedbackPos),
        feedback_neg_embedding: find_role(EmbeddingRole::FeedbackNeg),
        fts_query,
    }
}

fn compute_feedback_lexical_weights(
    feedback_articles: &[(FeedbackType, ArticleSnapshot)],
    positive_stems: &HashMap<String, f64>,
) -> HashMap<String, f64> {
    if feedback_articles.is_empty() {
        return HashMap::new();
    }
    let mut pos_df: HashMap<String, usize> = HashMap::new();
    let mut neg_df: HashMap<String, usize> = HashMap::new();
    let mut pos_docs = 0usize;
    let mut neg_docs = 0usize;

    for (fb_type, snap) in feedback_articles {
        let text = format!("{} {}", snap.title, snap.summary_text);
        let stems: HashSet<String> = tokenize_stems(&text).into_iter().collect();
        match fb_type {
            FeedbackType::SHOULD_INCLUDE => {
                pos_docs += 1;
                for s in stems {
                    *pos_df.entry(s).or_insert(0) += 1;
                }
            }
            FeedbackType::SHOULD_EXCLUDE => {
                neg_docs += 1;
                for s in stems {
                    *neg_df.entry(s).or_insert(0) += 1;
                }
            }
            FeedbackType::UNDO => {}
        }
    }

    let total_fb = pos_docs + neg_docs;
    if total_fb == 0 {
        return HashMap::new();
    }
    let damping = (total_fb.min(5) as f64) / 5.0;
    let mut weights = HashMap::new();
    let mut all_terms: HashSet<&String> = pos_df.keys().chain(neg_df.keys()).collect();

    for term in all_terms.drain() {
        // Never allow feedback alone to invert core feed definition keywords.
        if positive_stems.contains_key(term) {
            continue;
        }
        let p = *pos_df.get(term).unwrap_or(&0) as f64;
        let n = *neg_df.get(term).unwrap_or(&0) as f64;
        let p_prob = (p + 1.0) / (pos_docs as f64 + 2.0);
        let n_prob = (n + 1.0) / (neg_docs as f64 + 2.0);
        let log_odds = (p_prob / n_prob).ln();
        let bounded = (log_odds * 0.06 * damping).clamp(-0.12, 0.12);
        if bounded.abs() >= 0.015 {
            weights.insert(term.clone(), bounded);
        }
    }
    weights
}

#[derive(Debug, Clone)]
pub struct CandidateSignals {
    pub is_candidate: bool,
    pub positive_lexical_score: f64,
    pub negative_lexical_score: f64,
    pub positive_semantic_sim: Option<f64>,
    pub negative_semantic_sim: Option<f64>,
    pub feedback_semantic_delta: Option<f64>,
    pub feedback_lexical_delta: f64,
    pub fts_boost: f64,
    pub matched_positive_terms: Vec<String>,
    pub matched_negative_terms: Vec<String>,
    pub distinct_positive_hits: usize,
    pub title_positive_hits: usize,
    pub semantic_available: bool,
}

#[derive(Debug, Clone)]
pub struct ArticleVectorRef<'a> {
    pub provider: &'a str,
    pub model: &'a str,
    pub vector: &'a [f32],
}

fn same_space_cosine(
    article: Option<&ArticleVectorRef<'_>>,
    target: Option<&SmartFeedEmbeddingRecord>,
) -> Option<f64> {
    let (a, t) = (article?, target?);
    if a.vector.is_empty()
        || t.embedding.is_empty()
        || a.vector.len() != t.embedding.len()
        || a.provider != t.provider
        || a.model != t.model
    {
        return None;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (&x, &y) in a.vector.iter().zip(t.embedding.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 || !denom.is_finite() {
        return None;
    }
    let sim = (dot / denom) as f64;
    if sim.is_finite() {
        Some(sim.clamp(-1.0, 1.0))
    } else {
        None
    }
}

/// Evaluate candidate retrieval signals for a single article snapshot against a
/// Smart Feed query profile. Designed for high recall so borderline matches
/// proceed to Stage F rather than being silently discarded.
pub fn retrieve_candidate_signals(
    profile: &FeedQueryProfile,
    snapshot: &ArticleSnapshot,
    article_vector: Option<&ArticleVectorRef<'_>>,
    fts_rank_boost: f64,
    has_user_override: bool,
) -> CandidateSignals {
    let title_stems: HashSet<String> = tokenize_stems(&snapshot.title).into_iter().collect();
    let cat_text = snapshot.categories.join(" ");
    let cat_stems: HashSet<String> = tokenize_stems(&cat_text).into_iter().collect();
    let summary_stems: HashSet<String> =
        tokenize_stems(&snapshot.summary_text).into_iter().collect();
    let body_stems: HashSet<String> = tokenize_stems(&snapshot.best_text).into_iter().collect();

    let all_article_text = format!(
        "{} {} {} {}",
        snapshot.title, cat_text, snapshot.summary_text, snapshot.best_text
    );
    let article_phrases: HashSet<String> = extract_phrases(&all_article_text).into_iter().collect();

    let mut weighted_pos_sum = 0.0f64;
    let mut matched_positive_terms = Vec::new();
    let mut distinct_positive_hits = 0usize;
    let mut title_positive_hits = 0usize;
    let mut strong_non_acronym_hits = 0usize;

    for (stem, &spec_w) in &profile.positive_stems {
        let in_title = title_stems.contains(stem);
        let in_cat = cat_stems.contains(stem);
        let in_summary = summary_stems.contains(stem);
        let in_body = body_stems.contains(stem);
        if in_title || in_cat || in_summary || in_body {
            distinct_positive_hits += 1;
            if in_title {
                title_positive_hits += 1;
            }
            if spec_w >= 0.9 {
                strong_non_acronym_hits += 1;
            }
            let field_w: f64 = (if in_title { 1.45 } else { 0.0 })
                + (if in_cat { 0.90 } else { 0.0 })
                + (if in_summary { 0.70 } else { 0.0 })
                + (if in_body { 0.55 } else { 0.0 });
            // Cap contribution per concept so repeating one word in 4 fields
            // never dominates multi-concept relevance.
            weighted_pos_sum += (field_w.min(2.1)) * spec_w;
            matched_positive_terms.push(stem.clone());
        }
    }

    let mut phrase_bonus = 0.0f64;
    for phrase in &profile.positive_phrases {
        if article_phrases.contains(phrase) {
            phrase_bonus += 0.55;
            if matched_positive_terms.len() < 8 {
                matched_positive_terms.push(phrase.clone());
            }
        }
    }

    // Saturating lexical normalization in [0.0, 1.0]. Single-concept matches
    // (especially a 2-char acronym or lone country name without predicate terms)
    // stay bounded below inclusion threshold unless corroborated semantically.
    let raw_pos = weighted_pos_sum + phrase_bonus + fts_rank_boost * 0.35;
    let mut positive_lexical_score = (1.0 - (-raw_pos / 3.4).exp()).clamp(0.0, 1.0);
    if distinct_positive_hits <= 1 && phrase_bonus == 0.0 {
        let cap = if strong_non_acronym_hits == 0 {
            0.16
        } else {
            0.22
        };
        positive_lexical_score = positive_lexical_score.min(cap);
    }

    // Negative exclusion matching
    let mut neg_sum = 0.0f64;
    let mut matched_negative_terms = Vec::new();
    for stem in &profile.negative_stems {
        let in_title = title_stems.contains(stem);
        let in_cat = cat_stems.contains(stem);
        let in_summary = summary_stems.contains(stem);
        let in_body = body_stems.contains(stem);
        if in_title || in_cat || in_summary || in_body {
            let w: f64 = (if in_title { 1.35 } else { 0.0 })
                + (if in_cat { 0.85 } else { 0.0 })
                + (if in_summary { 0.65 } else { 0.0 })
                + (if in_body { 0.45 } else { 0.0 });
            neg_sum += w.min(1.8);
            matched_negative_terms.push(stem.clone());
        }
    }
    for phrase in &profile.negative_phrases {
        if article_phrases.contains(phrase) {
            neg_sum += 0.9;
            matched_negative_terms.push(phrase.clone());
        }
    }
    let negative_lexical_score = (1.0 - (-neg_sum / 2.0).exp()).clamp(0.0, 1.0);

    // Feed-specific learned lexical prior
    let mut fb_lex = 0.0f64;
    for (term, &w) in &profile.feedback_term_weights {
        if title_stems.contains(term) || summary_stems.contains(term) || body_stems.contains(term) {
            fb_lex += w;
        }
    }
    let feedback_lexical_delta = fb_lex.clamp(-0.12, 0.12);

    // Same-model semantic similarities
    let positive_semantic_sim =
        same_space_cosine(article_vector, profile.positive_embedding.as_ref());
    let negative_semantic_sim =
        same_space_cosine(article_vector, profile.negative_embedding.as_ref());
    let fb_pos_sim = same_space_cosine(article_vector, profile.feedback_pos_embedding.as_ref());
    let fb_neg_sim = same_space_cosine(article_vector, profile.feedback_neg_embedding.as_ref());
    let semantic_available = positive_semantic_sim.is_some();

    let feedback_semantic_delta = match (fb_pos_sim, fb_neg_sim) {
        (Some(p), Some(n)) => Some(((p.max(0.0) - n.max(0.0)) * 0.22).clamp(-0.18, 0.18)),
        (Some(p), None) => Some((p.max(0.0) * 0.18).clamp(0.0, 0.18)),
        (None, Some(n)) => Some((-n.max(0.0) * 0.18).clamp(-0.18, 0.0)),
        (None, None) => None,
    };

    // High-recall candidate gate
    let sem_ok = positive_semantic_sim.map(|s| s >= 0.26).unwrap_or(false);
    let lex_ok = positive_lexical_score >= 0.10 || fts_rank_boost > 0.0;
    let fb_ok = fb_pos_sim.map(|s| s >= 0.42).unwrap_or(false) || feedback_lexical_delta >= 0.05;
    let is_candidate = has_user_override || sem_ok || lex_ok || fb_ok;

    matched_positive_terms.sort();
    matched_positive_terms.dedup();
    matched_positive_terms.truncate(8);
    matched_negative_terms.sort();
    matched_negative_terms.dedup();
    matched_negative_terms.truncate(6);

    CandidateSignals {
        is_candidate,
        positive_lexical_score,
        negative_lexical_score,
        positive_semantic_sim,
        negative_semantic_sim,
        feedback_semantic_delta,
        feedback_lexical_delta,
        fts_boost: fts_rank_boost,
        matched_positive_terms,
        matched_negative_terms,
        distinct_positive_hits,
        title_positive_hits,
        semantic_available,
    }
}

/// Sanitize a feed definition into an FTS5-safe MATCH expression.
pub fn build_safe_fts_query(text: &str) -> Option<String> {
    let clean = collapse_whitespace(text);
    let mut terms = Vec::new();
    let mut seen = HashSet::new();
    for raw in clean.split(|c: char| !c.is_alphanumeric()) {
        let lower = raw.to_lowercase();
        if lower.chars().count() >= 3
            && !STOPWORDS.contains(&lower.as_str())
            && seen.insert(lower.clone())
        {
            terms.push(format!("\"{}\"", lower));
            if terms.len() >= 12 {
                break;
            }
        }
    }
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" OR "))
    }
}
