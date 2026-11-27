use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StudyModeScopeKind {
    StandaloneDocument,
    StandaloneSelection,
    StudyPlanTopic,
    StudyPlanSegment,
}

impl StudyModeScopeKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StandaloneDocument => "standalone_document",
            Self::StandaloneSelection => "standalone_selection",
            Self::StudyPlanTopic => "study_plan_topic",
            Self::StudyPlanSegment => "study_plan_segment",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "standalone_document" => Some(Self::StandaloneDocument),
            "standalone_selection" => Some(Self::StandaloneSelection),
            "study_plan_topic" => Some(Self::StudyPlanTopic),
            "study_plan_segment" => Some(Self::StudyPlanSegment),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyModeSession {
    pub id: String,
    pub scope_kind: String,
    pub scope_key: Option<String>,
    pub document_id: Option<String>,
    pub study_plan_id: Option<String>,
    pub plan_version_id: Option<String>,
    pub topic_id: Option<String>,
    pub segment_id: Option<String>,
    pub source_revision: String,
    pub knowledge_authority: String,
    pub active_view: String,
    pub last_locator_json: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertStudyModeSessionInput {
    pub id: Option<String>,
    pub scope_kind: String,
    #[serde(default)]
    pub scope_key: Option<String>,
    pub document_id: Option<String>,
    pub study_plan_id: Option<String>,
    pub plan_version_id: Option<String>,
    pub topic_id: Option<String>,
    pub segment_id: Option<String>,
    pub source_revision: String,
    pub knowledge_authority: Option<String>,
    pub active_view: Option<String>,
    pub last_locator_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyModeArtifact {
    pub id: String,
    pub session_id: Option<String>,
    pub artifact_type: String,
    pub schema_version: i64,
    pub scope_key: String,
    pub source_ids: Vec<String>,
    pub source_revision: String,
    pub anchors: Vec<serde_json::Value>,
    pub segment_ids: Vec<String>,
    pub concept_ids: Vec<String>,
    pub objective_ids: Vec<String>,
    pub plan_id: Option<String>,
    pub plan_version_id: Option<String>,
    pub preference_fingerprint: String,
    pub task_id: String,
    pub task_version: String,
    pub prompt_version: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub knowledge_authority: String,
    pub validation_status: String,
    pub quality_eval: Option<serde_json::Value>,
    pub payload: serde_json::Value,
    pub is_stale: bool,
    pub is_locked: bool,
    pub dismissed: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStudyModeArtifactInput {
    pub id: Option<String>,
    pub session_id: Option<String>,
    pub artifact_type: String,
    pub schema_version: Option<i64>,
    pub scope_key: String,
    pub source_ids: Vec<String>,
    pub source_revision: String,
    pub anchors: Vec<serde_json::Value>,
    pub segment_ids: Vec<String>,
    pub concept_ids: Vec<String>,
    pub objective_ids: Vec<String>,
    pub plan_id: Option<String>,
    pub plan_version_id: Option<String>,
    pub preference_fingerprint: Option<String>,
    pub task_id: String,
    pub task_version: Option<String>,
    pub prompt_version: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub knowledge_authority: String,
    pub validation_status: String,
    pub quality_eval: Option<serde_json::Value>,
    pub payload: serde_json::Value,
    pub is_locked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyLearnerPreference {
    pub id: String,
    pub subject_key: String,
    pub knowledge_level: Option<String>,
    pub interests: Vec<String>,
    pub familiar_domains: Vec<String>,
    pub explanation_detail: String,
    pub vocabulary_tolerance: String,
    pub explanation_language: Option<String>,
    pub teaching_approach: String,
    pub example_preference: String,
    pub question_difficulty: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertStudyLearnerPreferenceInput {
    pub subject_key: String,
    pub knowledge_level: Option<String>,
    pub interests: Option<Vec<String>>,
    pub familiar_domains: Option<Vec<String>>,
    pub explanation_detail: Option<String>,
    pub vocabulary_tolerance: Option<String>,
    pub explanation_language: Option<String>,
    pub teaching_approach: Option<String>,
    pub example_preference: Option<String>,
    pub question_difficulty: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudyFormativeQuestionInput {
    pub id: Option<String>,
    pub scope_key: String,
    pub session_id: Option<String>,
    pub segment_id: Option<String>,
    pub concept_ids: Vec<String>,
    pub objective_ids: Vec<String>,
    pub question_kind: String,
    pub prompt: String,
    pub options: Option<Vec<String>>,
    pub answer_key: serde_json::Value,
    pub rubric: Option<serde_json::Value>,
    pub difficulty: Option<i64>,
    pub question_fingerprint: String,
    pub source_refs: Vec<serde_json::Value>,
    pub knowledge_authority: String,
    pub provenance: serde_json::Value,
}

/// Client-safe projection of a persisted formative question (answer_key is stripped).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyFormativeQuestionClientView {
    pub id: String,
    pub revision: i64,
    pub scope_key: String,
    pub session_id: Option<String>,
    pub segment_id: Option<String>,
    pub concept_ids: Vec<String>,
    pub objective_ids: Vec<String>,
    pub question_kind: String,
    pub prompt: String,
    pub options: Option<Vec<String>>,
    pub difficulty: i64,
    pub question_fingerprint: String,
    pub source_refs: Vec<serde_json::Value>,
    pub knowledge_authority: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitStudyFormativeAnswerInput {
    pub submission_key: String,
    pub question_id: String,
    pub session_id: Option<String>,
    pub selected_index: Option<i64>,
    pub learner_response: Option<String>,
    pub ai_rubric_score: Option<f64>,
    pub ai_feedback: Option<String>,
    pub ai_misconception: Option<String>,
    pub confidence: Option<f64>,
    pub used_hint: Option<bool>,
    pub record_evidence: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyFormativeSubmissionResult {
    pub id: String,
    pub submission_key: String,
    pub question_id: String,
    pub question_revision: i64,
    pub outcome: String,
    pub score: f64,
    pub feedback: String,
    pub misconception_detected: Option<String>,
    pub grader_origin: String,
    pub evidence_recorded: bool,
    pub deduplicated: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStudyEfficacyEventInput {
    pub session_id: Option<String>,
    pub metric_kind: String,
    pub concept_id: Option<String>,
    pub score: Option<f64>,
    pub latency_ms: Option<i64>,
    pub cost_usd: Option<f64>,
    pub metadata: Option<serde_json::Value>,
}
