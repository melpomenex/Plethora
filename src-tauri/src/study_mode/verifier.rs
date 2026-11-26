use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PedagogicalCriterionId {
    Accuracy,
    SourceFidelity,
    Coverage,
    Emphasis,
    Engagement,
    CognitiveLoad,
    ActiveLearning,
    Metacognition,
    MotivationCuriosity,
    Adaptability,
    ClarityOfIntentions,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PedagogicalRating {
    Pass,
    Partial,
    Fail,
    NotAssessable,
}

impl PedagogicalRating {
    pub fn numeric_score(self) -> Option<f64> {
        match self {
            Self::Pass => Some(1.0),
            Self::Partial => Some(0.5),
            Self::Fail => Some(0.0),
            Self::NotAssessable => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PedagogicalCriterionScore {
    pub criterion: PedagogicalCriterionId,
    pub rating: PedagogicalRating,
    pub rationale: String,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PedagogicalEvaluationReport {
    pub hard_gate_passed: bool,
    pub hard_gate_failures: Vec<String>,
    pub criteria: Vec<PedagogicalCriterionScore>,
    pub evaluator_origin: String,
}

#[derive(Debug, Clone)]
pub struct VerificationInput<'a> {
    pub artifact_type: &'a str,
    pub knowledge_authority: &'a str,
    pub authorized_source_ids: &'a [String],
    pub expected_revision: &'a str,
    pub artifact_revision: &'a str,
    pub source_texts: &'a [String],
    pub payload: &'a Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub valid: bool,
    pub issues: Vec<String>,
    pub report: PedagogicalEvaluationReport,
}

fn normalize_ws(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn contains_unsafe_markup(value: &Value) -> bool {
    match value {
        Value::String(s) => {
            let lower = s.to_lowercase();
            lower.contains("<script")
                || lower.contains("javascript:")
                || lower.contains("onerror=")
                || lower.contains("onload=")
                || lower.contains("onclick=")
        }
        Value::Array(arr) => arr.iter().any(contains_unsafe_markup),
        Value::Object(map) => map.values().any(contains_unsafe_markup),
        _ => false,
    }
}

fn extract_citations(payload: &Value) -> Vec<(Option<String>, Option<String>)> {
    let mut out = Vec::new();
    if let Some(arr) = payload.get("citations").and_then(|v| v.as_array()) {
        for item in arr {
            let source_id = item
                .get("sourceId")
                .or_else(|| item.get("documentId"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let quote = item
                .get("quote")
                .or_else(|| item.get("excerpt"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            out.push((source_id, quote));
        }
    }
    if let Some(arr) = payload.get("sourceRefs").and_then(|v| v.as_array()) {
        for item in arr {
            let source_id = item
                .get("sourceId")
                .or_else(|| item.get("documentId"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let quote = item
                .get("quote")
                .or_else(|| item.get("excerpt"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            out.push((source_id, quote));
        }
    }
    out
}

pub fn verify_artifact_deterministic(input: &VerificationInput<'_>) -> VerificationResult {
    let mut issues = Vec::new();

    if contains_unsafe_markup(input.payload) {
        issues.push("unsafe_markup_detected".to_string());
    }

    if !input.expected_revision.is_empty()
        && !input.artifact_revision.is_empty()
        && input.expected_revision != input.artifact_revision
    {
        issues.push("source_revision_mismatch".to_string());
    }

    let citations = extract_citations(input.payload);
    let normalized_sources: Vec<String> =
        input.source_texts.iter().map(|s| normalize_ws(s)).collect();

    if input.knowledge_authority == "source-only" && citations.is_empty() {
        if matches!(
            input.artifact_type,
            "explanation" | "worked_example" | "summary" | "mind_map" | "timeline" | "slides"
        ) {
            issues.push("missing_required_citations_in_source_only_mode".to_string());
        }
    }

    for (source_id_opt, quote_opt) in &citations {
        if let Some(source_id) = source_id_opt {
            if !input.authorized_source_ids.is_empty()
                && !input.authorized_source_ids.iter().any(|s| s == source_id)
            {
                issues.push(format!("unauthorized_source_id:{}", source_id));
            }
        }
        if let Some(quote) = quote_opt {
            let nq = normalize_ws(quote);
            if nq.len() >= 12
                && !normalized_sources.is_empty()
                && !normalized_sources.iter().any(|src| src.contains(&nq))
            {
                issues.push("citation_quote_not_found_in_source".to_string());
            }
        }
    }

    if input.artifact_type == "formative_question" {
        if let Some(kind) = input.payload.get("questionKind").and_then(|v| v.as_str()) {
            if kind == "multiple_choice" {
                let options = input.payload.get("options").and_then(|v| v.as_array());
                let correct_idx = input
                    .payload
                    .get("answerKey")
                    .and_then(|ak| ak.get("correctIndex"))
                    .and_then(|v| v.as_u64());
                match (options, correct_idx) {
                    (Some(opts), Some(idx)) if opts.len() >= 2 && (idx as usize) < opts.len() => {}
                    _ => issues.push("invalid_multiple_choice_answer_structure".to_string()),
                }
            }
        }
    }

    let source_fidelity_rating = if issues.iter().any(|i| {
        i.contains("citation")
            || i.contains("source")
            || i.contains("revision")
            || i.contains("unauthorized")
    }) {
        PedagogicalRating::Fail
    } else if citations.is_empty() {
        PedagogicalRating::Partial
    } else {
        PedagogicalRating::Pass
    };

    let accuracy_rating = if issues.iter().any(|i| i.contains("unsafe") || i.contains("invalid_multiple_choice")) {
        PedagogicalRating::Fail
    } else {
        PedagogicalRating::Pass
    };

    let hard_gate_passed = issues.is_empty();
    let report = PedagogicalEvaluationReport {
        hard_gate_passed,
        hard_gate_failures: issues.clone(),
        criteria: vec![
            PedagogicalCriterionScore {
                criterion: PedagogicalCriterionId::Accuracy,
                rating: accuracy_rating,
                rationale: if accuracy_rating == PedagogicalRating::Pass {
                    "Deterministic structural and safety checks passed.".to_string()
                } else {
                    "Structural or safety gate failed.".to_string()
                },
                evidence: issues.clone(),
            },
            PedagogicalCriterionScore {
                criterion: PedagogicalCriterionId::SourceFidelity,
                rating: source_fidelity_rating,
                rationale: if source_fidelity_rating == PedagogicalRating::Fail {
                    "Citation or revision verification failed.".to_string()
                } else {
                    "Citations resolved against authorized source scope.".to_string()
                },
                evidence: issues.clone(),
            },
        ],
        evaluator_origin: "deterministic".to_string(),
    };

    VerificationResult {
        valid: hard_gate_passed,
        issues,
        report,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_fabricated_citation_in_source_only_mode() {
        let payload = json!({
            "title": "Test",
            "citations": [{ "sourceId": "doc-1", "quote": "This exact sentence does not exist anywhere in the source text." }]
        });
        let res = verify_artifact_deterministic(&VerificationInput {
            artifact_type: "explanation",
            knowledge_authority: "source-only",
            authorized_source_ids: &["doc-1".to_string()],
            expected_revision: "rev-1",
            artifact_revision: "rev-1",
            source_texts: &["Photosynthesis converts light energy into chemical energy.".to_string()],
            payload: &payload,
        });
        assert!(!res.valid);
        assert!(res.issues.iter().any(|i| i == "citation_quote_not_found_in_source"));
        assert!(!res.report.hard_gate_passed);
    }

    #[test]
    fn rejects_unsafe_script_markup() {
        let payload = json!({
            "title": "Timeline",
            "body": "<script>alert(1)</script>",
            "citations": [{ "sourceId": "doc-1", "quote": "Photosynthesis converts light energy" }]
        });
        let res = verify_artifact_deterministic(&VerificationInput {
            artifact_type: "timeline",
            knowledge_authority: "source-only",
            authorized_source_ids: &["doc-1".to_string()],
            expected_revision: "rev-1",
            artifact_revision: "rev-1",
            source_texts: &["Photosynthesis converts light energy into chemical energy.".to_string()],
            payload: &payload,
        });
        assert!(!res.valid);
        assert!(res.issues.iter().any(|i| i == "unsafe_markup_detected"));
    }

    #[test]
    fn accepts_valid_grounded_artifact() {
        let payload = json!({
            "title": "Photosynthesis",
            "citations": [{ "sourceId": "doc-1", "quote": "Photosynthesis converts light energy into chemical energy." }]
        });
        let res = verify_artifact_deterministic(&VerificationInput {
            artifact_type: "explanation",
            knowledge_authority: "source-only",
            authorized_source_ids: &["doc-1".to_string()],
            expected_revision: "rev-1",
            artifact_revision: "rev-1",
            source_texts: &["Photosynthesis converts light energy into chemical energy.".to_string()],
            payload: &payload,
        });
        assert!(res.valid);
        assert!(res.report.hard_gate_passed);
    }
}
