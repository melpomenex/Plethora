use super::assessment_blueprint::QuestionKind;
/**
 * Domain Models and DTOs for Exam Sessions and Resumable Attempts.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§5–7, §11, §12
 * - openspec/planning/study-plans-assessments-program/04-DATA-AND-MIGRATION-PLAN.md §6
 * - openspec/changes/implement-resumable-examination-sessions/
 */
use serde::{Deserialize, Serialize};

// ============================================================================
// 1. Domain Entities
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExamAttempt {
    pub id: String,
    pub blueprint_revision_id: String,
    pub client_start_key: String,
    pub mode: String,
    pub status: String,
    pub question_revision_ids: Vec<String>,
    pub revision: i64,
    pub started_at: String,
    pub deadline_at: Option<String>,
    pub submitted_at: Option<String>,
    pub completed_at: Option<String>,
    pub submission_reason: Option<String>,
    pub submission_key: Option<String>,
    pub awarded_points: Option<f64>,
    pub maximum_points: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExamResponse {
    pub id: String,
    pub attempt_id: String,
    pub question_revision_id: String,
    pub draft_json: String,
    pub mark: String,
    pub revision: i64,
    pub last_client_mutation_id: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResponseSubmission {
    pub id: String,
    pub response_id: String,
    pub attempt_id: String,
    pub question_revision_id: String,
    pub ordinal: i64,
    pub kind: String,
    pub response_json: String,
    pub mark: String,
    pub hint_level: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExamGrade {
    pub id: String,
    pub response_submission_id: String,
    pub question_revision_id: String,
    pub origin: String,
    pub state: String,
    pub points: Option<f64>,
    pub max_points: f64,
    pub assessment_json: Option<String>,
    pub criteria_json: String,
    pub provenance_json: Option<String>,
    pub manual_reason: Option<String>,
    pub supersedes_grade_id: Option<String>,
    pub is_current: bool,
    pub created_at: String,
}

// ============================================================================
// 2. Grader DTOs
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveGradeOutput {
    pub question_revision_id: String,
    pub origin: String,
    pub state: String,
    pub points: Option<f64>,
    pub max_points: f64,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

// ============================================================================
// 3. Command Inputs and Results
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartAttemptInput {
    pub blueprint_revision_id: String,
    pub client_start_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveResponseInput {
    pub attempt_id: String,
    pub response_id: String,
    pub expected_response_revision: i64,
    pub last_client_mutation_id: String,
    pub draft_json: String,
    pub mark: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAttemptInput {
    pub attempt_id: String,
    pub expected_attempt_revision: i64,
    pub submission_key: String,
    pub submission_reason: String,
    pub objective_grades: Vec<ObjectiveGradeOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckPracticeInput {
    pub attempt_id: String,
    pub response_id: String,
    pub expected_attempt_revision: i64,
    pub client_mutation_id: String,
    pub hint_level: i64,
    pub draft_json: String,
    pub mark: String,
    pub objective_grade: Option<ObjectiveGradeOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PracticeCheckResult {
    pub submission: ResponseSubmission,
    pub grade: Option<ExamGrade>,
    pub attempt_revision: i64,
    pub response_revision: i64,
    pub explanation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttemptDetail {
    pub attempt: ExamAttempt,
    pub responses: Vec<ExamResponse>,
    pub submissions: Vec<ResponseSubmission>,
    pub current_grades: Vec<ExamGrade>,
    pub questions: Vec<AttemptQuestionRevision>,
}

/// Attempt-scoped question projection. `question` is an explicit public
/// allowlist while an attempt is in progress and a full pinned question only
/// after submission or an individual Practice Check.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttemptQuestionRevision {
    pub id: String,
    pub question_id: String,
    pub blueprint_revision_id: String,
    pub revision: i64,
    pub slot_key: String,
    pub fingerprint: String,
    pub kind: QuestionKind,
    pub question: serde_json::Value,
    pub validation: String,
    pub validation_issues: Vec<serde_json::Value>,
    pub committed_at: Option<String>,
    pub provider: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSummary {
    pub id: String,
    pub blueprint_revision_id: String,
    pub blueprint_id: String,
    pub blueprint_title: String,
    pub mode: String,
    pub status: String,
    pub started_at: String,
    pub deadline_at: Option<String>,
    pub completed_at: Option<String>,
    pub awarded_points: Option<f64>,
    pub maximum_points: f64,
    pub question_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttemptHistoryFilter {
    pub blueprint_revision_id: Option<String>,
    pub blueprint_id: Option<String>,
    pub mode: Option<String>,
    pub status: Option<String>,
}
