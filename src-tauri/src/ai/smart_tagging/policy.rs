//! Acceptance policy, confidence gating, and tag synthesis
//!
//! Enforces confidence threshold (>= 0.70), bounds tag count (3-8),
//! assigns 0 tags when evidence is weak, and generates explainability reasons.

use chrono::Utc;
use std::collections::HashSet;

use crate::models::SmartTagDetail;
use super::candidate_retrieval::CandidateTag;
use super::domain_signatures::DomainMatch;
use super::normalization::{canonicalize_tag, normalize_for_comparison};
use super::salience::ScoredTerm;

pub const DEFAULT_CONFIDENCE_THRESHOLD: f64 = 0.70;
pub const DEFAULT_MAX_TAGS: usize = 6;
pub const MIN_TAG_CAP: usize = 3;
pub const MAX_TAG_CAP: usize = 8;

pub struct PolicyConfig {
    pub min_confidence: f64,
    pub max_tags: usize,
    pub prefer_existing: bool,
}

impl Default for PolicyConfig {
    fn default() -> Self {
        Self {
            min_confidence: DEFAULT_CONFIDENCE_THRESHOLD,
            max_tags: DEFAULT_MAX_TAGS,
            prefer_existing: true,
        }
    }
}

/// Synthesize and filter candidate tags into final accepted SmartTagDetails.
pub fn evaluate_and_filter_tags(
    title: &str,
    domain_matches: &[DomainMatch],
    candidate_existing: &[CandidateTag],
    salient_terms: &[ScoredTerm],
    existing_library_tags: &[String],
    manual_tags: &[String],
    dismissed_tags: &[String],
    config: &PolicyConfig,
) -> Vec<SmartTagDetail> {
    let now = Utc::now().to_rfc3339();
    let max_tags = config.max_tags.clamp(MIN_TAG_CAP, MAX_TAG_CAP);

    let dismissed_norms: HashSet<String> = dismissed_tags
        .iter()
        .map(|t| normalize_for_comparison(t))
        .collect();

    let manual_norms: HashSet<String> = manual_tags
        .iter()
        .map(|t| normalize_for_comparison(t))
        .collect();

    let mut proposed_details: Vec<SmartTagDetail> = Vec::new();
    let mut seen_canonical: HashSet<String> = HashSet::new();

    // 1. Process Domain Signature Matches
    for dm in domain_matches {
        if dm.confidence >= config.min_confidence {
            let canonical = canonicalize_tag(dm.domain_name, existing_library_tags);
            let norm = normalize_for_comparison(&canonical);

            if !dismissed_norms.contains(&norm) && !manual_norms.contains(&norm) && !seen_canonical.contains(&norm) {
                seen_canonical.insert(norm);
                proposed_details.push(SmartTagDetail {
                    tag: canonical,
                    provenance: "smart-local".to_string(),
                    confidence: dm.confidence,
                    reason: dm.reason.clone(),
                    assigned_at: now.clone(),
                    dismissed: None,
                });
            }
        }
    }

    // 2. Process High-Scoring Candidate Existing Tags
    for ct in candidate_existing {
        // Compute confidence from candidate score
        let confidence = (ct.score / 12.0).clamp(0.50, 0.96);
        if confidence >= config.min_confidence {
            let canonical = ct.tag.clone();
            let norm = normalize_for_comparison(&canonical);

            if !dismissed_norms.contains(&norm) && !manual_norms.contains(&norm) && !seen_canonical.contains(&norm) {
                seen_canonical.insert(norm);
                let reason = match ct.match_type {
                    "title-exact" => format!("Exact match with document title and existing library tag '{}'", ct.tag),
                    "title-contains" => format!("Strong lexical match in document title for existing tag '{}'", ct.tag),
                    "heading-contains" => format!("Matches section headings for existing library tag '{}'", ct.tag),
                    "salient-term" => format!("High TF-IDF term density aligned with existing tag '{}'", ct.tag),
                    _ => format!("Taxonomy alignment with existing library tag '{}'", ct.tag),
                };

                proposed_details.push(SmartTagDetail {
                    tag: canonical,
                    provenance: "smart-local".to_string(),
                    confidence,
                    reason,
                    assigned_at: now.clone(),
                    dismissed: None,
                });
            }
        }
    }

    // 3. Process High-Salience Keyphrases if slot capacity allows
    for st in salient_terms {
        if proposed_details.len() >= max_tags {
            break;
        }

        // Only accept multi-word phrases or terms with strong evidence (e.g. score >= 4.5 and freq >= 2)
        if st.is_phrase && st.score >= 4.0 && st.frequency >= 2 {
            let canonical = canonicalize_tag(&st.term, existing_library_tags);
            let norm = normalize_for_comparison(&canonical);

            if !dismissed_norms.contains(&norm) && !manual_norms.contains(&norm) && !seen_canonical.contains(&norm) {
                let confidence = (st.score / 8.0).clamp(0.70, 0.90);
                if confidence >= config.min_confidence {
                    seen_canonical.insert(norm);
                    let reason = format!(
                        "Prominent multi-word keyphrase (frequency {}, TF-IDF score {:.1})",
                        st.frequency, st.score
                    );

                    proposed_details.push(SmartTagDetail {
                        tag: canonical,
                        provenance: "smart-local".to_string(),
                        confidence,
                        reason,
                        assigned_at: now.clone(),
                        dismissed: None,
                    });
                }
            }
        }
    }

    // Sort by confidence descending
    proposed_details.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));

    if proposed_details.len() > max_tags {
        proposed_details.truncate(max_tags);
    }

    proposed_details
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_insufficient_evidence_produces_zero_tags() {
        let config = PolicyConfig::default();
        let details = evaluate_and_filter_tags(
            "Short note",
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &config,
        );
        assert!(details.is_empty(), "Zero tags should be produced for weak evidence");
    }

    #[test]
    fn test_dismissed_and_manual_tags_are_not_duplicated() {
        let config = PolicyConfig::default();
        let domain_matches = vec![
            DomainMatch {
                domain_name: "Mathematics",
                confidence: 0.90,
                matched_terms: vec!["calculus".to_string()],
                reason: "Matched calculus".to_string(),
            },
        ];

        // If "Mathematics" was dismissed by the user, policy should not re-add it
        let details = evaluate_and_filter_tags(
            "Calculus notes",
            &domain_matches,
            &[],
            &[],
            &[],
            &[],
            &["Mathematics".to_string()],
            &config,
        );
        assert!(details.is_empty(), "Dismissed tags must not be re-applied");
    }
}
