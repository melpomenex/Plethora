//! TF-IDF and BM25 term salience and keyphrase extractor
//!
//! Provides positional weighting (Title 5x, Headings 3x, Body 1x) and
//! term salience scoring for Tier 1 Smart Tagging.

use std::collections::HashMap;
use super::tokenizer::{extract_candidate_phrases, tokenize_words};

#[derive(Debug, Clone, PartialEq)]
pub struct ScoredTerm {
    pub term: String,
    pub score: f64,
    pub frequency: usize,
    pub is_phrase: bool,
}

#[derive(Debug, Clone, Default)]
pub struct DocumentContentParts<'a> {
    pub title: &'a str,
    pub headings: &'a [&'a str],
    pub body: &'a str,
}

/// Extract salient terms and keyphrases from structured document parts using positional weighting.
///
/// Positional weights:
/// - Title: 5.0
/// - Headings: 3.0
/// - Body: 1.0
pub fn extract_salient_terms(parts: &DocumentContentParts, top_k: usize) -> Vec<ScoredTerm> {
    let mut term_scores: HashMap<String, f64> = HashMap::new();
    let mut term_counts: HashMap<String, usize> = HashMap::new();
    let mut is_phrase_map: HashMap<String, bool> = HashMap::new();

    // 1. Process Title (Weight 5.0)
    let title_tokens = tokenize_words(parts.title);
    let title_phrases = extract_candidate_phrases(parts.title);
    for token in title_tokens {
        *term_scores.entry(token.clone()).or_insert(0.0) += 5.0;
        *term_counts.entry(token.clone()).or_insert(0) += 1;
        is_phrase_map.entry(token).or_insert(false);
    }
    for phrase in title_phrases {
        *term_scores.entry(phrase.clone()).or_insert(0.0) += 8.0; // Extra boost for title phrases
        *term_counts.entry(phrase.clone()).or_insert(0) += 1;
        is_phrase_map.insert(phrase, true);
    }

    // 2. Process Headings (Weight 3.0)
    for heading in parts.headings {
        let heading_tokens = tokenize_words(heading);
        let heading_phrases = extract_candidate_phrases(heading);
        for token in heading_tokens {
            *term_scores.entry(token.clone()).or_insert(0.0) += 3.0;
            *term_counts.entry(token.clone()).or_insert(0) += 1;
            is_phrase_map.entry(token).or_insert(false);
        }
        for phrase in heading_phrases {
            *term_scores.entry(phrase.clone()).or_insert(0.0) += 5.0;
            *term_counts.entry(phrase.clone()).or_insert(0) += 1;
            is_phrase_map.insert(phrase, true);
        }
    }

    // 3. Process Body (Weight 1.0)
    let body_tokens = tokenize_words(parts.body);
    let body_phrases = extract_candidate_phrases(parts.body);
    let body_token_count = body_tokens.len().max(1);

    for token in body_tokens {
        *term_scores.entry(token.clone()).or_insert(0.0) += 1.0;
        *term_counts.entry(token.clone()).or_insert(0) += 1;
        is_phrase_map.entry(token).or_insert(false);
    }
    for phrase in body_phrases {
        *term_scores.entry(phrase.clone()).or_insert(0.0) += 1.5;
        *term_counts.entry(phrase.clone()).or_insert(0) += 1;
        is_phrase_map.insert(phrase, true);
    }

    // 4. BM25 / Frequency Saturation & Length Normalization
    // Score = (weight_sum / (weight_sum + k1 * (1.0 - b + b * (doc_len / avg_len))))
    let k1 = 1.5;
    let b = 0.75;
    let avg_doc_len = 500.0;
    let doc_len_norm = 1.0 - b + b * (body_token_count as f64 / avg_doc_len);

    let mut results = Vec::new();
    for (term, raw_score) in term_scores {
        let count = term_counts.get(&term).copied().unwrap_or(0);
        let is_phrase = is_phrase_map.get(&term).copied().unwrap_or(false);

        // Saturation curve
        let normalized_score = (raw_score * (k1 + 1.0)) / (raw_score + k1 * doc_len_norm);

        // Bonus for multi-word phrases that appeared multiple times
        let phrase_boost = if is_phrase && count >= 2 { 1.3 } else { 1.0 };

        results.push(ScoredTerm {
            term,
            score: normalized_score * phrase_boost,
            frequency: count,
            is_phrase,
        });
    }

    // Sort descending by score. The tie-break on the term itself matters:
    // `results` is built from HashMap iteration, so without it, terms with
    // equal scores at the top-k cut survive (or drop out) in random
    // per-process order — the baseline classifier then flipped fixtures
    // like test_positive_fixture_linux_kernel_scheduling ~1 run in 3.
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.term.cmp(&b.term))
    });

    if results.len() > top_k {
        results.truncate(top_k);
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_title_salience_weighting() {
        let parts = DocumentContentParts {
            title: "Differential Geometry and Tensor Calculus",
            headings: &["Introduction to Manifolds"],
            body: "This textbook covers manifold theory and differential geometry extensively.",
        };
        let terms = extract_salient_terms(&parts, 10);
        assert!(!terms.is_empty());
        let top_terms: Vec<String> = terms.into_iter().map(|t| t.term).collect();
        assert!(top_terms.iter().any(|t| t.contains("geometry") || t.contains("calculus") || t.contains("differential")));
    }
}
