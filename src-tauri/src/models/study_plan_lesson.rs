//! Versioned Study Plan lesson persistence models.
//!
//! Lessons are keyed by the stable plan version + node + objective so a
//! learner can resume at the same question. Every checkpoint carries an
//! expected revision and a client request id so interrupted sends and
//! duplicate deliveries can be reconciled idempotently.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LessonStyle {
    Guided,
    ExplainCheck,
    Challenge,
}

impl Default for LessonStyle {
    fn default() -> Self {
        Self::Guided
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanLesson {
    pub id: String,
    pub plan_id: String,
    pub plan_version_id: String,
    pub node_id: String,
    pub objective_index: i64,
    pub style: LessonStyle,
    /// Pinned knowledge authority at lesson launch (e.g. model-only or library policy).
    pub knowledge_authority_json: String,
    /// Source revision snapshot hash for library-backed lessons; empty for model-only.
    pub source_revision_snapshot: String,
    pub prompt_text: String,
    pub answer_draft: String,
    pub hint_count: i64,
    pub turn_count: i64,
    pub turn_state_json: String,
    pub revision: i64,
    pub last_turn_request_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudyPlanLessonInput {
    pub plan_id: String,
    pub plan_version_id: String,
    pub node_id: String,
    pub objective_index: i64,
    #[serde(default)]
    pub style: Option<LessonStyle>,
    #[serde(default)]
    pub knowledge_authority_json: Option<String>,
    #[serde(default)]
    pub source_revision_snapshot: Option<String>,
    #[serde(default)]
    pub prompt_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStudyPlanLessonCheckpointInput {
    pub lesson_id: String,
    pub expected_revision: i64,
    /// Client-generated request id for idempotent turn delivery.
    pub turn_request_id: Option<String>,
    #[serde(default)]
    pub prompt_text: Option<String>,
    #[serde(default)]
    pub answer_draft: Option<String>,
    #[serde(default)]
    pub hint_count: Option<i64>,
    #[serde(default)]
    pub turn_count: Option<i64>,
    #[serde(default)]
    pub turn_state_json: Option<String>,
    #[serde(default)]
    pub style: Option<LessonStyle>,
}
