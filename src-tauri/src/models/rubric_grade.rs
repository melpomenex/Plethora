/**
 * Domain Models and DTOs for Rubric-Based Exam Grading.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§6, §10, §11, §12
 * - openspec/changes/implement-rubric-based-exam-grading/ (C5-T03)
 */
use crate::models::exam_session::ExamGrade;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordRubricGradeInput {
    pub attempt_id: String,
    pub response_submission_id: String,
    pub question_revision_id: String,
    pub expected_attempt_revision: i64,
    pub origin: String, // "ai" | "manual"
    pub state: String,  // "final" | "needs-review" | "failed"
    pub points: Option<f64>,
    pub max_points: f64,
    pub outcome: Option<String>,
    pub assessment_json: Option<String>,
    pub criteria_json: String,
    pub provenance_json: Option<String>,
    pub manual_reason: Option<String>,
    pub job_id: Option<String>,
    pub step_key: Option<String>,
    pub lease_owner: Option<String>,
    pub cancellation_epoch: Option<i64>,
    pub input_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManualCriterionGradeItem {
    pub criterion_id: String,
    pub level: i64,
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordManualGradeInput {
    pub attempt_id: String,
    pub response_submission_id: String,
    pub question_revision_id: String,
    pub expected_attempt_revision: i64,
    pub criteria: Vec<ManualCriterionGradeItem>,
    pub manual_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GradeSettlementOutcome {
    pub grade: ExamGrade,
    pub attempt_status: String,
    pub attempt_revision: i64,
    pub awarded_points: Option<f64>,
    pub maximum_points: f64,
    pub is_complete: bool,
}
