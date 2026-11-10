//! Canonical Assessment Blueprint domain models and command DTOs.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§4–6, §11
//! - openspec/planning/study-plans-assessments-program/04-DATA-AND-MIGRATION-PLAN.md §5
//! - openspec/changes/generate-study-plan-examinations/ (C3-T04)

use super::study_source::StudyCommandError;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AssessmentMode {
    Exam,
    Practice,
    Diagnostic,
}

impl fmt::Display for AssessmentMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Exam => write!(f, "exam"),
            Self::Practice => write!(f, "practice"),
            Self::Diagnostic => write!(f, "diagnostic"),
        }
    }
}

impl std::str::FromStr for AssessmentMode {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "exam" => Ok(Self::Exam),
            "practice" => Ok(Self::Practice),
            "diagnostic" => Ok(Self::Diagnostic),
            other => Err(format!("Unknown assessment mode: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum QuestionKind {
    SingleSelect,
    MultiSelect,
    Cloze,
    ShortAnswer,
    Essay,
}

impl fmt::Display for QuestionKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SingleSelect => write!(f, "single-select"),
            Self::MultiSelect => write!(f, "multi-select"),
            Self::Cloze => write!(f, "cloze"),
            Self::ShortAnswer => write!(f, "short-answer"),
            Self::Essay => write!(f, "essay"),
        }
    }
}

impl std::str::FromStr for QuestionKind {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "single-select" => Ok(Self::SingleSelect),
            "multi-select" => Ok(Self::MultiSelect),
            "cloze" => Ok(Self::Cloze),
            "short-answer" => Ok(Self::ShortAnswer),
            "essay" => Ok(Self::Essay),
            other => Err(format!("Unknown question kind: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BlueprintLifecycle {
    Active,
    Archived,
}

impl fmt::Display for BlueprintLifecycle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Archived => write!(f, "archived"),
        }
    }
}

impl std::str::FromStr for BlueprintLifecycle {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "archived" => Ok(Self::Archived),
            other => Err(format!("Unknown blueprint lifecycle: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BlueprintState {
    Draft,
    NeedsReview,
    Ready,
    Failed,
    Cancelled,
}

impl fmt::Display for BlueprintState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Draft => write!(f, "draft"),
            Self::NeedsReview => write!(f, "needs-review"),
            Self::Ready => write!(f, "ready"),
            Self::Failed => write!(f, "failed"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl std::str::FromStr for BlueprintState {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "draft" => Ok(Self::Draft),
            "needs-review" => Ok(Self::NeedsReview),
            "ready" => Ok(Self::Ready),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(format!("Unknown blueprint state: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentBlueprint {
    pub id: String,
    pub plan_id: Option<String>,
    pub title: String,
    pub current_revision_id: Option<String>,
    pub lifecycle: BlueprintLifecycle,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintRevision {
    pub id: String,
    pub blueprint_id: String,
    pub revision: i64,
    pub state: BlueprintState,
    pub plan_version_id: Option<String>,
    pub config: serde_json::Value,
    pub scoring: serde_json::Value,
    pub source_scope: serde_json::Value,
    pub quota: serde_json::Value,
    pub generation_job_id: Option<String>,
    pub source_snapshot_hash: String,
    pub created_at: String,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionSourceLink {
    pub source_ref_id: String,
    pub ordinal: i64,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionTargetLink {
    pub concept_id: Option<String>,
    pub concept_label: String,
    pub node_id: Option<String>,
    pub objective_text: String,
    pub ordinal: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentQuestionRevision {
    pub id: String,
    pub question_id: String,
    pub blueprint_revision_id: String,
    pub revision: i64,
    pub slot_key: String,
    pub fingerprint: String,
    pub kind: QuestionKind,
    pub payload: serde_json::Value,
    pub answer_key: serde_json::Value,
    pub rubric: Option<serde_json::Value>,
    pub max_points: i64,
    pub difficulty: i64,
    pub validation: String,
    pub validation_issues: Vec<serde_json::Value>,
    pub committed_at: Option<String>,
    pub provider: Option<serde_json::Value>,
    pub created_at: String,
    pub sources: Vec<QuestionSourceLink>,
    pub targets: Vec<QuestionTargetLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintDetail {
    pub blueprint: AssessmentBlueprint,
    pub revision: BlueprintRevision,
    pub questions: Vec<AssessmentQuestionRevision>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintSummary {
    pub id: String,
    pub plan_id: Option<String>,
    pub title: String,
    pub lifecycle: BlueprintLifecycle,
    pub current_revision_id: Option<String>,
    pub current_revision: i64,
    pub state: BlueprintState,
    pub mode: AssessmentMode,
    pub question_count: i64,
    pub updated_at: String,
}

// ============================================================================
// Command Input Payloads
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBlueprintInput {
    pub plan_id: Option<String>,
    pub title: String,
    pub plan_version_id: Option<String>,
    pub config: serde_json::Value,
    pub source_scope: serde_json::Value,
    pub source_snapshot_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBlueprintDraftInput {
    pub revision_id: String,
    pub expected_revision: i64,
    pub title: Option<String>,
    pub config: Option<serde_json::Value>,
    pub source_scope: Option<serde_json::Value>,
    pub source_snapshot_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionTargetInput {
    pub concept_id: Option<String>,
    pub concept_label: String,
    pub node_id: Option<String>,
    pub objective_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveQuestionDraftInput {
    pub blueprint_revision_id: String,
    pub question_id: Option<String>,
    pub slot_key: String,
    pub fingerprint: String,
    pub kind: QuestionKind,
    pub payload_json: String,
    pub answer_key_json: String,
    pub rubric_json: Option<String>,
    pub max_points: i64,
    pub difficulty: i64,
    pub validation: String,
    pub validation_issues_json: Option<String>,
    pub provider_json: Option<String>,
    pub source_ref_ids: Vec<String>,
    pub targets: Vec<QuestionTargetInput>,
}
