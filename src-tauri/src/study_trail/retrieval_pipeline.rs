use crate::models::study_trail::{
    InstructionalRole, LearningSegment, LearningSegmentObjectiveLink, ObjectiveCoverageStatus,
    SegmentReadinessStatus, SegmentValidationStatus, StructuralClass,
};
use crate::study_trail::content_classifier::{classify_structural_unit, ClassificationContext};
use crate::study_trail::structural_analyzer::{count_words, StructuralUnit};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

pub const GENERATOR_VERSION: &str = "guided-study-trail-v2";
const WORDS_PER_MINUTE: usize = 200;
const TARGET_IDEAL_WORDS: usize = 550;
const TARGET_MAX_WORDS: usize = 950;
const MIN_QUALITY_THRESHOLD: f64 = 0.34;
const ADEQUATE_QUALITY_THRESHOLD: f64 = 0.52;

#[derive(Debug, Clone)]
pub struct DocumentSourceForTrail {
    pub document_id: String,
    pub document_title: String,
    pub document_revision: String,
    pub format: String,
    pub is_ai_excluded: bool,
    pub readiness: SegmentReadinessStatus,
    pub units: Vec<StructuralUnit>,
    pub total_length_hint: usize,
}

#[derive(Debug, Clone, Default)]
pub struct ObjectiveQuery {
    pub plan_id: String,
    pub version_id: String,
    pub node_id: String,
    pub node_title: String,
    pub node_summary: String,
    pub objective_index: i64,
    pub objective_text: String,
    pub context: ClassificationContext,
    pub cited_excerpts: Vec<String>,
    pub unit_retrieval_scores: HashMap<String, f64>,
    pub assigned_primary_units: HashSet<String>,
}

#[derive(Debug, Clone)]
pub struct EvaluatedCandidate {
    pub segment: LearningSegment,
    pub alignment_score: f64,
    pub rationale: String,
}

#[derive(Debug, Clone)]
pub struct ObjectiveRetrievalResult {
    pub coverage_status: ObjectiveCoverageStatus,
    pub segments: Vec<LearningSegment>,
    pub links: Vec<LearningSegmentObjectiveLink>,
    pub diagnostics: Vec<String>,
}

fn stable_id(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update(b"|");
    }
    let hex = format!("{:x}", hasher.finalize());
    hex[..24].to_string()
}

fn stop_words() -> HashSet<&'static str> {
    [
        "the", "and", "for", "with", "that", "this", "from", "into", "about", "what", "how",
        "why", "when", "where", "which", "their", "there", "these", "those", "understand",
        "explain", "describe", "identify", "analyze", "compare", "contrast", "define", "learn",
        "recognize", "evaluate", "apply", "between", "through", "using", "concept", "concepts",
        "distinguish", "differentiate", "summarize", "connect", "characterize", "relate",
        "defining", "features", "claim", "claims", "account", "role", "importance", "limits",
        "framework", "according", "described", "presented", "source", "excerpt", "usage",
        "meaning", "means", "rather", "instead", "common", "distinct", "primary", "major",
        "examine", "illustrate", "demonstrate", "argue", "argues", "argument", "section",
        "chapter", "author", "book", "text", "reader", "readers", "being", "having", "could",
        "would", "should", "within", "without", "other", "more", "most", "some", "many",
        "such", "both", "each", "only", "also", "than", "then", "them", "they", "have",
        "were", "been", "does", "make", "makes", "made", "take", "takes", "shows", "show",
    ]
    .into_iter()
    .collect()
}

const SHORT_DOMAIN_WORDS: &[&str] = &["zen", "wef", "ego", "gdp", "tax", "war", "law", "art"];

pub fn stem_token(word: &str) -> String {
    let clean = word
        .trim_end_matches("'s")
        .trim_end_matches("’s")
        .to_ascii_lowercase();
    if clean.len() <= 4 {
        return clean;
    }
    let mut s = clean.as_str();
    let suffixes = [
        "izations", "isations", "ational", "fulness", "lessness", "iveness", "ically", "ization",
        "isation", "ification", "ability", "ibility", "ements", "ments", "ances", "ences",
        "ation", "ition", "istic", "ities", "ness", "ment", "ance", "ence", "able", "ible",
        "ings", "ally", "ists", "isms", "ate", "ity", "ism", "ist", "ive", "ing", "ied", "ies",
        "ed", "es", "ly",
    ];
    for suf in suffixes {
        if let Some(stem) = s.strip_suffix(suf) {
            if stem.len() >= 4 {
                s = stem;
                break;
            }
        }
    }
    if s.len() >= 5 && s.ends_with('s') && !s.ends_with("ss") && !s.ends_with("is") && !s.ends_with("us") {
        s = &s[..s.len() - 1];
    }
    if s.len() >= 5 && s.ends_with("at") {
        // Normalize e.g. "meditate"/"meditation" -> "medit"
        if let Some(shorter) = s.strip_suffix("at") {
            if shorter.len() >= 4 {
                s = shorter;
            }
        }
    }
    s.to_string()
}

pub fn extract_keywords(text: &str) -> Vec<String> {
    let stops = stop_words();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for raw in text.split(|c: char| !c.is_alphanumeric()) {
        let lower = raw.to_ascii_lowercase();
        let keep = (lower.len() >= 4 || SHORT_DOMAIN_WORDS.contains(&lower.as_str()))
            && !stops.contains(lower.as_str());
        if keep && seen.insert(lower.clone()) {
            out.push(lower);
        }
    }
    out
}

fn extract_stemmed_tokens(text: &str) -> Vec<String> {
    let stops = stop_words();
    text.split(|c: char| !c.is_alphanumeric() && c != '\'' && c != '’')
        .filter_map(|raw| {
            let trimmed = raw
                .trim_matches(|c: char| !c.is_alphanumeric())
                .to_ascii_lowercase();
            if (trimmed.len() >= 4 || SHORT_DOMAIN_WORDS.contains(&trimmed.as_str()))
                && !stops.contains(trimmed.as_str())
            {
                Some(stem_token(&trimmed))
            } else {
                None
            }
        })
        .collect()
}

fn extract_stem_bigrams(text: &str) -> Vec<String> {
    let tokens = extract_stemmed_tokens(text);
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for pair in tokens.windows(2) {
        if pair[0] != pair[1] {
            let bg = format!("{} {}", pair[0], pair[1]);
            if seen.insert(bg.clone()) {
                out.push(bg);
            }
        }
    }
    out
}

fn extract_boundary_quote(text: &str, is_end: bool, target_chars: usize) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return String::new();
    }
    if !is_end {
        let mut out = String::new();
        for w in words {
            if out.is_empty() {
                if w.chars().count() > target_chars {
                    return w.chars().take(target_chars).collect();
                }
                out.push_str(w);
            } else if out.chars().count() + 1 + w.chars().count() <= target_chars {
                out.push(' ');
                out.push_str(w);
            } else {
                break;
            }
        }
        out
    } else {
        let mut selected: Vec<&str> = Vec::new();
        let mut total_chars = 0usize;
        for w in words.into_iter().rev() {
            let w_len = w.chars().count();
            if selected.is_empty() {
                if w_len > target_chars {
                    let chars: Vec<char> = w.chars().collect();
                    return chars[chars.len().saturating_sub(target_chars)..]
                        .iter()
                        .collect();
                }
                selected.push(w);
                total_chars = w_len;
            } else if total_chars + 1 + w_len <= target_chars {
                selected.push(w);
                total_chars += 1 + w_len;
            } else {
                break;
            }
        }
        selected.reverse();
        selected.join(" ")
    }
}

fn build_locator(unit: &StructuralUnit, is_end: bool, total_len: usize) -> serde_json::Value {
    let quote_clean = extract_boundary_quote(&unit.text, is_end, 140);
    let pct = if total_len > 0 {
        let pos = if is_end { unit.end_offset } else { unit.start_offset };
        ((pos as f64 / total_len as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    match unit.format.as_str() {
        "pdf" => serde_json::json!({
            "kind": "pdf",
            "pageNumber": if is_end { unit.end_page_number.or(unit.page_number).unwrap_or(1) } else { unit.page_number.unwrap_or(1) },
            "textQuote": quote_clean,
        }),
        "epub" => {
            let mut obj = serde_json::json!({
                "kind": "epub",
                "cfi": "",
                "textQuote": quote_clean,
            });
            if let Some(spine) = unit.spine_index {
                obj["spineIndex"] = serde_json::json!(spine);
            }
            obj
        },
        "html" => serde_json::json!({
            "kind": "html",
            "scrollPercent": pct,
            "textQuote": quote_clean,
        }),
        "markdown" => serde_json::json!({
            "kind": "markdown",
            "scrollPercent": pct,
            "textQuote": quote_clean,
        }),
        "youtube" | "video" | "audio" => serde_json::json!({
            "kind": unit.format,
            "timeSeconds": ((if is_end { unit.end_timestamp_ms.or(unit.timestamp_ms).unwrap_or(0) } else { unit.timestamp_ms.unwrap_or(0) }) as f64) / 1000.0,
            "segmentId": unit.segment_id,
            "textQuote": quote_clean,
        }),
        _ => serde_json::json!({
            "kind": "text",
            "scrollPercent": pct,
            "textQuote": quote_clean,
        }),
    }
}

struct QuerySignals {
    primary_terms: Vec<(String, f64)>, // (stem, base_weight)
    summary_stems: Vec<String>,
    bigrams: Vec<String>,
    cited_shingles: Vec<HashSet<String>>,
    has_retrieval: bool,
}

fn word_shingles(text: &str) -> HashSet<String> {
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .map(|w| w.to_ascii_lowercase())
        .filter(|w| w.len() >= 3)
        .collect();
    words
        .windows(4)
        .map(|w| w.join(" "))
        .collect()
}

fn excerpt_overlap_score(unit_text: &str, cited_shingles: &[HashSet<String>]) -> f64 {
    if cited_shingles.is_empty() {
        return 0.0;
    }
    let unit_shingles = word_shingles(unit_text);
    if unit_shingles.is_empty() {
        return 0.0;
    }
    cited_shingles
        .iter()
        .map(|cited| {
            if cited.is_empty() {
                0.0
            } else {
                let hits = cited.iter().filter(|s| unit_shingles.contains(*s)).count();
                (hits as f64 / (cited.len().min(8) as f64)).min(1.0)
            }
        })
        .fold(0.0f64, f64::max)
}

fn score_unit_with_idf(
    unit: &StructuralUnit,
    unit_stems: &HashSet<String>,
    unit_stem_vec: &[String],
    class: StructuralClass,
    signals: &QuerySignals,
    idf_map: &HashMap<String, f64>,
    retrieval_score: f64,
    diversity_penalty: f64,
) -> (f64, String) {
    if signals.primary_terms.is_empty() && retrieval_score <= 0.0 {
        return (0.0, "No searchable keywords in objective".to_string());
    }

    let heading_text = unit.heading_path.join(" ");
    let heading_stems: HashSet<String> = extract_stemmed_tokens(&heading_text).into_iter().collect();

    let mut matched_primary = 0usize;
    let mut heading_hits = 0usize;
    let mut matched_idf_weight = 0.0f64;
    let mut total_idf_weight = 0.0f64;
    let mut heading_idf_weight = 0.0f64;

    for (stem, base_w) in &signals.primary_terms {
        let idf = idf_map.get(stem).copied().unwrap_or(1.0);
        let w = base_w * idf;
        total_idf_weight += w;
        if unit_stems.contains(stem) {
            matched_primary += 1;
            matched_idf_weight += w;
        }
        if heading_stems.contains(stem) {
            heading_hits += 1;
            heading_idf_weight += w;
        }
    }

    let cited_overlap = excerpt_overlap_score(&unit.text, &signals.cited_shingles);

    if matched_primary == 0 && heading_hits == 0 && retrieval_score < 0.35 && cited_overlap < 0.25 {
        return (0.0, "No keyword or semantic overlap".to_string());
    }
    if signals.primary_terms.len() >= 2
        && matched_primary < 2
        && heading_hits == 0
        && retrieval_score < 0.45
        && cited_overlap < 0.35
    {
        return (0.15, "Single keyword mention without heading or semantic alignment".to_string());
    }

    let idf_coverage = if total_idf_weight > 0.0 {
        (matched_idf_weight / total_idf_weight).min(1.0)
    } else {
        0.0
    };
    let heading_bonus = if total_idf_weight > 0.0 && heading_hits > 0 {
        (heading_idf_weight / total_idf_weight).min(1.0)
    } else {
        0.0
    };

    // Bigram phrase matches in prose or heading
    let unit_bigram_set: HashSet<String> = unit_stem_vec
        .windows(2)
        .map(|w| format!("{} {}", w[0], w[1]))
        .collect();
    let bigram_hits = signals
        .bigrams
        .iter()
        .filter(|bg| unit_bigram_set.contains(*bg))
        .count();
    let bigram_ratio = if signals.bigrams.is_empty() {
        0.0
    } else {
        (bigram_hits as f64 / (signals.bigrams.len().min(3) as f64)).min(1.0)
    };

    // Secondary summary support
    let summary_hits = signals
        .summary_stems
        .iter()
        .filter(|s| unit_stems.contains(*s))
        .count();
    let summary_ratio = if signals.summary_stems.is_empty() {
        0.0
    } else {
        (summary_hits as f64 / (signals.summary_stems.len().min(4) as f64)).min(1.0)
    };
    let phrase_and_summary = (bigram_ratio * 0.65 + summary_ratio * 0.35).min(1.0);

    // Pedagogical explanation quality
    let role_bonus: f64 = match class {
        StructuralClass::Argument | StructuralClass::Definition | StructuralClass::WorkedExample => 0.06,
        StructuralClass::InstructionalProse => 0.04,
        _ => 0.0,
    };
    let depth_bonus: f64 = if (80..=450).contains(&unit.word_count) {
        0.06
    } else if unit.word_count >= 45 {
        0.03
    } else {
        -0.05
    };
    let pedagogical = (role_bonus + depth_bonus).max(0.0);

    let raw_score = if signals.has_retrieval {
        idf_coverage * 0.42
            + retrieval_score.clamp(0.0, 1.0) * 0.25
            + phrase_and_summary * 0.11
            + heading_bonus * 0.12
            + cited_overlap * 0.10
            + pedagogical
    } else {
        idf_coverage * 0.56
            + phrase_and_summary * 0.12
            + heading_bonus * 0.16
            + cited_overlap * 0.10
            + pedagogical
    };

    let score = (raw_score - diversity_penalty).clamp(0.0, 1.0);
    let rationale = format!(
        "Matched {}/{} concept terms{} in {} ({} words){}",
        matched_primary,
        signals.primary_terms.len(),
        if retrieval_score >= 0.35 {
            format!(" + {:.0}% semantic match", retrieval_score * 100.0)
        } else {
            String::new()
        },
        class.as_str(),
        unit.word_count,
        if heading_hits > 0 { ", aligned with section heading" } else { "" }
    );
    (score, rationale)
}

fn instructional_role_for(class: StructuralClass) -> InstructionalRole {
    match class {
        StructuralClass::WorkedExample => InstructionalRole::WorkedExample,
        _ => InstructionalRole::CoreExplanation,
    }
}

fn estimate_duration_seconds(word_count: usize, unit: &StructuralUnit) -> i64 {
    if let (Some(s), Some(e)) = (unit.timestamp_ms, unit.end_timestamp_ms) {
        if e > s {
            return ((e - s) / 1000).max(15);
        }
    }
    let minutes = (word_count as f64 / WORDS_PER_MINUTE as f64).max(0.5);
    (minutes * 60.0).round() as i64
}

/// Runs the progressive structural -> classification -> IDF/semantic scoring ->
/// bounded expansion -> quality -> coverage pipeline.
struct PrecomputedUnit {
    class: StructuralClass,
    stem_vec: Vec<String>,
    stem_set: HashSet<String>,
}

struct CachedContextStats {
    idf_map: HashMap<String, f64>,
    excluded_count: usize,
}

/// Precomputed per-source structural classifications, stemmed tokens, and cached
/// per-`ClassificationContext` IDF tables so multi-objective trail generation
/// does not re-stem or re-classify every source unit per objective.
pub struct PreparedTrailCorpus<'a> {
    available_sources: Vec<&'a DocumentSourceForTrail>,
    base_diagnostics: Vec<String>,
    units: Vec<Vec<PrecomputedUnit>>,
    context_cache: HashMap<ClassificationContext, CachedContextStats>,
}

impl<'a> PreparedTrailCorpus<'a> {
    pub fn new(sources: &'a [DocumentSourceForTrail]) -> Self {
        let mut base_diagnostics = Vec::new();
        let available_sources: Vec<&DocumentSourceForTrail> = sources
            .iter()
            .filter(|s| {
                if s.is_ai_excluded {
                    base_diagnostics
                        .push(format!("Skipped AI-excluded source '{}'", s.document_title));
                    return false;
                }
                if s.readiness == SegmentReadinessStatus::NeedsOcr {
                    base_diagnostics.push(format!(
                        "Source '{}' requires OCR before text segments can be verified",
                        s.document_title
                    ));
                    return false;
                }
                if s.readiness == SegmentReadinessStatus::Unavailable {
                    base_diagnostics
                        .push(format!("Source '{}' is currently unavailable", s.document_title));
                    return false;
                }
                true
            })
            .collect();

        let mut units = Vec::with_capacity(available_sources.len());
        for source in &available_sources {
            let mut src_units = Vec::with_capacity(source.units.len());
            for unit in &source.units {
                let class = classify_structural_unit(unit);
                let stem_vec = extract_stemmed_tokens(&format!(
                    "{} {}",
                    unit.heading_path.join(" "),
                    unit.text
                ));
                let stem_set: HashSet<String> = stem_vec.iter().cloned().collect();
                src_units.push(PrecomputedUnit {
                    class,
                    stem_vec,
                    stem_set,
                });
            }
            units.push(src_units);
        }

        Self {
            available_sources,
            base_diagnostics,
            units,
            context_cache: HashMap::new(),
        }
    }

    fn context_stats(&mut self, context: ClassificationContext) -> &CachedContextStats {
        if !self.context_cache.contains_key(&context) {
            let mut df_map: HashMap<String, usize> = HashMap::new();
            let mut permitted_unit_count = 0usize;
            let mut excluded_count = 0usize;

            for src_units in &self.units {
                for u in src_units {
                    if !context.is_permitted(u.class) {
                        excluded_count += 1;
                        continue;
                    }
                    permitted_unit_count += 1;
                    for s in &u.stem_set {
                        *df_map.entry(s.clone()).or_insert(0) += 1;
                    }
                }
            }

            let n_docs = permitted_unit_count.max(1) as f64;
            let idf_map: HashMap<String, f64> = df_map
                .into_iter()
                .map(|(stem, df)| {
                    let idf = ((n_docs + 1.0) / (df as f64 + 1.0)).ln() + 1.0;
                    (stem, idf)
                })
                .collect();

            self.context_cache.insert(
                context,
                CachedContextStats {
                    idf_map,
                    excluded_count,
                },
            );
        }
        &self.context_cache[&context]
    }

    pub fn retrieve_for_objective(
        &mut self,
        query: &ObjectiveQuery,
        now_iso: &str,
    ) -> ObjectiveRetrievalResult {
        let mut diagnostics = self.base_diagnostics.clone();

        if self.available_sources.is_empty() {
            return ObjectiveRetrievalResult {
                coverage_status: ObjectiveCoverageStatus::SourceUnavailable,
                segments: vec![],
                links: vec![],
                diagnostics,
            };
        }

        let obj_stems = extract_stemmed_tokens(&query.objective_text);
        let title_stems = extract_stemmed_tokens(&query.node_title);
        let mut primary_map: HashMap<String, f64> = HashMap::new();
        let mut primary_order: Vec<String> = Vec::new();
        for s in obj_stems {
            if !primary_map.contains_key(&s) {
                primary_order.push(s.clone());
            }
            primary_map.insert(s, 1.0);
        }
        for s in title_stems {
            if !primary_map.contains_key(&s) {
                primary_order.push(s.clone());
                primary_map.insert(s, 0.75);
            }
        }
        let primary_terms: Vec<(String, f64)> = primary_order
            .into_iter()
            .map(|s| {
                let w = primary_map[&s];
                (s, w)
            })
            .collect();

        let summary_stems: Vec<String> = extract_stemmed_tokens(&query.node_summary)
            .into_iter()
            .filter(|s| !primary_map.contains_key(s))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();

        let bigrams = extract_stem_bigrams(&format!("{} {}", query.node_title, query.objective_text));
        let cited_shingles: Vec<HashSet<String>> = query
            .cited_excerpts
            .iter()
            .map(|ex| word_shingles(ex))
            .filter(|set| !set.is_empty())
            .collect();

        let signals = QuerySignals {
            primary_terms,
            summary_stems,
            bigrams,
            cited_shingles,
            has_retrieval: !query.unit_retrieval_scores.is_empty(),
        };
        let keywords = extract_keywords(&format!("{} {}", query.node_title, query.objective_text));

        let _ = self.context_stats(query.context);
        let stats = &self.context_cache[&query.context];
        let idf_map = &stats.idf_map;
        let excluded_count = stats.excluded_count;

        struct ScoredUnit<'b> {
            source_idx: usize,
            source: &'b DocumentSourceForTrail,
            unit_idx: usize,
            class: StructuralClass,
            score: f64,
            rationale: String,
        }

        let mut per_unit_scores: Vec<Vec<f64>> = Vec::with_capacity(self.available_sources.len());
        let mut scored: Vec<ScoredUnit<'_>> = Vec::new();

        for (src_idx, source) in self.available_sources.iter().enumerate() {
            let mut scores_for_source = vec![0.0f64; source.units.len()];
            for (idx, unit) in source.units.iter().enumerate() {
                let pre = &self.units[src_idx][idx];
                if !query.context.is_permitted(pre.class) {
                    continue;
                }
                let retrieval_score = query
                    .unit_retrieval_scores
                    .get(&unit.unit_id)
                    .copied()
                    .unwrap_or(0.0);
                let diversity_penalty = if query.assigned_primary_units.contains(&unit.unit_id) {
                    0.08
                } else {
                    0.0
                };
                let (score, rationale) = score_unit_with_idf(
                    unit,
                    &pre.stem_set,
                    &pre.stem_vec,
                    pre.class,
                    &signals,
                    idf_map,
                    retrieval_score,
                    diversity_penalty,
                );
                scores_for_source[idx] = score;
                if score >= MIN_QUALITY_THRESHOLD {
                    scored.push(ScoredUnit {
                        source_idx: src_idx,
                        source,
                        unit_idx: idx,
                        class: pre.class,
                        score,
                        rationale,
                    });
                }
            }
            per_unit_scores.push(scores_for_source);
        }

    if excluded_count > 0 {
        diagnostics.push(format!(
            "Filtered {} non-instructional units (TOC/bibliography/index/front-matter/incidental)",
            excluded_count
        ));
    }

    if scored.is_empty() {
        return ObjectiveRetrievalResult {
            coverage_status: ObjectiveCoverageStatus::NoMatch,
            segments: vec![],
            links: vec![],
            diagnostics,
        };
    }

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Bounded, relevance-guarded section expansion (deduplicated by document/unit range)
    let mut used_ranges: HashMap<&str, Vec<(usize, usize)>> = HashMap::new();
    let mut segments = Vec::new();
    let mut links = Vec::new();

    for cand in scored.into_iter().take(6) {
        let doc_id = cand.source.document_id.as_str();
        if used_ranges
            .get(doc_id)
            .is_some_and(|ranges| ranges.iter().any(|&(s, e)| cand.unit_idx >= s && cand.unit_idx <= e))
        {
            continue;
        }

        let units = &cand.source.units;
        let anchor_unit = &units[cand.unit_idx];
        let src_scores = &per_unit_scores[cand.source_idx];
        let mut start_idx = cand.unit_idx;
        let mut end_idx = cand.unit_idx;
        let mut total_words = anchor_unit.word_count;

        let same_section = |a: &StructuralUnit, b: &StructuralUnit| -> bool {
            a.heading_path == b.heading_path
                && a.spine_index == b.spine_index
                && match (a.page_number, b.page_number) {
                    (Some(pa), Some(pb)) => pa.abs_diff(pb) <= 2,
                    _ => true,
                }
        };

        // Expand backward at most 1 unit, only if relevant or anchor is short
        if start_idx > 0 {
            let prev = &units[start_idx - 1];
            let prev_pre = &self.units[cand.source_idx][start_idx - 1];
            let prev_score = src_scores[start_idx - 1];
            if query.context.is_permitted(prev_pre.class)
                && same_section(prev, anchor_unit)
                && total_words + prev.word_count <= TARGET_IDEAL_WORDS
                && ((prev_score >= cand.score * 0.65 && prev_score >= MIN_QUALITY_THRESHOLD)
                    || anchor_unit.word_count < 90)
            {
                start_idx -= 1;
                total_words += prev.word_count;
            }
        }

        // Expand forward at most 2 units within the same section/spine
        let mut forward_steps = 0usize;
        while end_idx + 1 < units.len() && forward_steps < 2 {
            let next = &units[end_idx + 1];
            let next_pre = &self.units[cand.source_idx][end_idx + 1];
            let next_score = src_scores[end_idx + 1];
            let within_budget = if total_words < 180 {
                total_words + next.word_count <= TARGET_MAX_WORDS
            } else {
                total_words + next.word_count <= TARGET_IDEAL_WORDS
            };
            let relevant_continuation =
                total_words < 200 || next_score >= MIN_QUALITY_THRESHOLD * 0.70;
            if query.context.is_permitted(next_pre.class)
                && same_section(next, anchor_unit)
                && within_budget
                && relevant_continuation
            {
                end_idx += 1;
                total_words += next.word_count;
                forward_steps += 1;
            } else {
                break;
            }
        }

        used_ranges.entry(doc_id).or_default().push((start_idx, end_idx));

        let first_unit = &units[start_idx];
        let last_unit = &units[end_idx];
        let merged_text = units[start_idx..=end_idx]
            .iter()
            .map(|u| u.text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        let wc = count_words(&merged_text);
        let duration = estimate_duration_seconds(wc, first_unit);
        let preview = extract_boundary_quote(&merged_text, false, 320);

        let seg_id = format!(
            "seg_{}",
            stable_id(&[
                &cand.source.document_id,
                &cand.source.document_revision,
                &first_unit.start_offset.to_string(),
                &last_unit.end_offset.to_string(),
            ])
        );

        let parent_section = if anchor_unit.heading_path.is_empty() {
            None
        } else {
            Some(anchor_unit.heading_path.join(" › "))
        };

        let segment = LearningSegment {
            id: seg_id.clone(),
            document_id: cand.source.document_id.clone(),
            document_revision: cand.source.document_revision.clone(),
            format: cand.source.format.clone(),
            title: anchor_unit.title.clone(),
            parent_section_label: parent_section,
            start_locator: build_locator(first_unit, false, cand.source.total_length_hint),
            end_locator: build_locator(last_unit, true, cand.source.total_length_hint),
            start_offset: Some(first_unit.start_offset as i64),
            end_offset: Some(last_unit.end_offset as i64),
            excerpt_preview: preview,
            word_count: wc as i64,
            estimated_duration_seconds: duration,
            structural_class: cand.class,
            instructional_role: instructional_role_for(cand.class),
            quality_score: Some(cand.score),
            quality_rationale: Some(cand.rationale.clone()),
            validation_status: SegmentValidationStatus::Verified,
            readiness_status: cand.source.readiness,
            generator_version: GENERATOR_VERSION.to_string(),
            schema_version: 1,
            provenance: serde_json::json!({
                "unitIds": units[start_idx..=end_idx].iter().map(|u| &u.unit_id).collect::<Vec<_>>(),
                "keywords": keywords,
            }),
            created_at: now_iso.to_string(),
            updated_at: now_iso.to_string(),
        };

        let is_primary = segments.is_empty();
        let link_id = format!(
            "lso_{}",
            stable_id(&[
                &query.version_id,
                &query.node_id,
                &query.objective_index.to_string(),
                &seg_id,
            ])
        );
        let coverage_for_link = if cand.score >= ADEQUATE_QUALITY_THRESHOLD {
            ObjectiveCoverageStatus::AdequatelyCovered
        } else {
            ObjectiveCoverageStatus::PartiallyCovered
        };

        links.push(LearningSegmentObjectiveLink {
            id: link_id,
            plan_id: query.plan_id.clone(),
            version_id: query.version_id.clone(),
            node_id: query.node_id.clone(),
            objective_index: query.objective_index,
            segment_id: seg_id,
            coverage_status: coverage_for_link,
            alignment_score: Some(cand.score),
            selection_rationale: cand.rationale,
            is_primary,
            is_required: is_primary,
            authored_override: false,
            created_at: now_iso.to_string(),
            updated_at: now_iso.to_string(),
        });
        segments.push(segment);

        if segments.len() >= 3 {
            break;
        }
    }

    let best_score = links
        .first()
        .and_then(|l| l.alignment_score)
        .unwrap_or(0.0);
    let coverage_status = if segments.is_empty() {
        ObjectiveCoverageStatus::NoMatch
    } else if best_score >= ADEQUATE_QUALITY_THRESHOLD {
        if segments.len() > 1 && best_score < 0.72 {
            ObjectiveCoverageStatus::MultiSegment
        } else {
            ObjectiveCoverageStatus::AdequatelyCovered
        }
    } else {
        ObjectiveCoverageStatus::PartiallyCovered
    };

    for link in &mut links {
        link.coverage_status = coverage_status;
    }

    ObjectiveRetrievalResult {
        coverage_status,
        segments,
        links,
        diagnostics,
    }
    }
}

pub fn retrieve_segments_for_objective(
    sources: &[DocumentSourceForTrail],
    query: &ObjectiveQuery,
    now_iso: &str,
) -> ObjectiveRetrievalResult {
    PreparedTrailCorpus::new(sources).retrieve_for_objective(query, now_iso)
}
