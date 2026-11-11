/**
 * Learning Evidence, Knowledge Gaps, and Remediation Models.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§8, 9, 11
 * - openspec/planning/study-plans-assessments-program/04-DATA-AND-MIGRATION-PLAN.md §7
 * - openspec/changes/derive-study-gaps-from-exam-evidence/ (C6-T04)
 */
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningEvidenceRecord {
    pub id: String,
    pub concept_id: String,
    pub concept_label: String,
    pub plan_id: Option<String>,
    pub node_id: Option<String>,
    pub source_kind: String, // 'exam-final' | 'practice-check' | 'diagnostic-final' | 'review-result'
    pub source_id: String,
    pub grade_id: Option<String>,
    pub evidence_group_id: String,
    pub question_fingerprint: Option<String>,
    pub observed_score: Option<f64>,
    pub outcome: String, // 'correct' | 'partial' | 'incorrect' | 'misconception' | 'unanswered' | 'skipped' | 'review-lapse'
    pub misconception: Option<String>,
    pub learner_confidence: Option<f64>,
    pub hint_level: i64,
    pub grader_origin: String, // 'deterministic' | 'ai' | 'manual' | 'user-review'
    pub occurred_at: String,
    pub policy_version: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptMasterySummary {
    pub concept_id: String,
    pub level: String, // 'insufficient-evidence' | 'needs-attention' | 'developing' | 'demonstrated-consistently'
    pub observed_mean: Option<f64>,
    pub evidence_weight: f64,
    pub independent_sessions: i64,
    pub distinct_days: i64,
    pub minimum_observed: Option<f64>,
    pub maximum_observed: Option<f64>,
    pub latest_evidence_at: Option<String>,
    pub uncertainty: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub policy_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GapEvidenceRecord {
    pub record_id: String,
    pub kind: String, // 'review_lapse' | 'unreviewed_reading' | 'graph_edge' | 'assessment'
    pub description: String,
    pub learning_evidence_id: Option<String>,
    pub source_ref_id: Option<String>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGapView {
    pub id: String,
    pub kind: String, // 'weak_prerequisite' | 'missing_concept' | 'repeatedly_failed' | 'read_never_reviewed' | 'disconnected_cluster' | 'weak_transfer'
    pub concept_id: String,
    pub concept_name: String,
    pub plan_id: Option<String>,
    pub node_id: Option<String>,
    pub rule_id: String,
    pub status: String, // 'active' | 'dismissed' | 'resolved'
    pub evidence: Vec<GapEvidenceRecord>,
    pub demonstrated: Option<ConceptMasterySummary>,
    pub first_detected_at: String,
    pub last_detected_at: String,
    pub evidence_cutoff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemediationRecommendation {
    pub id: String,
    pub gap_id: String,
    pub kind: String, // 'open-source' | 'review-extract' | 'tutor' | 'targeted-practice' | 'card-proposals' | 'follow-up-exam' | 'plan-adjustment'
    pub status: String, // 'suggested' | 'accepted' | 'dismissed' | 'completed'
    pub source_ref_ids: Vec<String>,
    pub payload: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningEvidenceReconcileResult {
    pub processed: i64,
    pub remaining: i64,
    pub next_after_grade_id: Option<String>,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurriculumPriorEvidenceConcept {
    pub concept_id: String,
    pub level: String,
    pub observed_mean: Option<f64>,
    pub uncertainty: Vec<String>,
    pub evidence_group_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurriculumPriorEvidence {
    pub diagnostic_attempt_id: String,
    pub concepts: Vec<CurriculumPriorEvidenceConcept>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeLearningProgress {
    pub node_id: String,
    pub activity: serde_json::Value,
    pub content_coverage: serde_json::Value,
    pub coverage_activity: serde_json::Value,
    pub demonstrated: Option<ConceptMasterySummary>,
    pub source_statuses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEvidenceSummary {
    pub plan_id: String,
    pub version_id: String,
    pub nodes: Vec<NodeLearningProgress>,
    pub active_gap_ids: Vec<String>,
    pub computed_at: String,
}
