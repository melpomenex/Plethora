//! Canonical Study Generation domain models and command DTOs.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §10, §11
//! - openspec/changes/generate-source-grounded-study-curricula/ (C2-T04)

use super::study_source::StudyCommandError;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StudyJobKind {
    Curriculum,
    AssessmentGeneration,
    ExamGrading,
}

impl fmt::Display for StudyJobKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Curriculum => write!(f, "curriculum"),
            Self::AssessmentGeneration => write!(f, "assessment-generation"),
            Self::ExamGrading => write!(f, "exam-grading"),
        }
    }
}

impl std::str::FromStr for StudyJobKind {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "curriculum" => Ok(Self::Curriculum),
            "assessment-generation" => Ok(Self::AssessmentGeneration),
            "exam-grading" => Ok(Self::ExamGrading),
            other => Err(format!("Unknown study job kind: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StudyJobStatus {
    Queued,
    Running,
    AwaitingReview,
    Interrupted,
    Completed,
    Failed,
    Cancelled,
}

impl fmt::Display for StudyJobStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Queued => write!(f, "queued"),
            Self::Running => write!(f, "running"),
            Self::AwaitingReview => write!(f, "awaiting-review"),
            Self::Interrupted => write!(f, "interrupted"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl std::str::FromStr for StudyJobStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "awaiting-review" => Ok(Self::AwaitingReview),
            "interrupted" => Ok(Self::Interrupted),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(format!("Unknown study job status: {}", other)),
        }
    }
}

impl StudyJobStatus {
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::AwaitingReview)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StudyStepStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

impl fmt::Display for StudyStepStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Running => write!(f, "running"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Skipped => write!(f, "skipped"),
        }
    }
}

impl std::str::FromStr for StudyStepStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(Self::Pending),
            "running" => Ok(Self::Running),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "skipped" => Ok(Self::Skipped),
            other => Err(format!("Unknown study step status: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyAiPreflight {
    pub provider_id: String,
    pub generation_destination: String,
    pub embedding_destination: Option<String>,
    pub feature_allowed: bool,
    pub document_ids: Vec<String>,
    pub source_excerpt_count: i64,
    pub sends_source_off_device: bool,
    pub sends_answers_off_device: bool,
    pub billable: bool,
    pub cloud_disclosure_accepted: bool,
    pub cost_consent_accepted: bool,
    pub maximum_model_calls: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudyJobProgress {
    pub completed: i64,
    pub total: i64,
    pub label_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyGenerationJob {
    pub id: String,
    pub kind: StudyJobKind,
    pub target_id: String,
    pub target_revision: i64,
    pub request_hash: String,
    pub creation_key: String,
    pub status: StudyJobStatus,
    pub next_step_index: i64,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<String>,
    pub cancellation_epoch: i64,
    pub attempt_count: i64,
    pub preflight: serde_json::Value,
    pub progress: StudyJobProgress,
    pub last_error: Option<StudyCommandError>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyGenerationStep {
    pub job_id: String,
    pub step_key: String,
    pub ordinal: i64,
    pub input_hash: String,
    pub status: StudyStepStatus,
    pub output_ref_id: Option<String>,
    pub safe_error: Option<StudyCommandError>,
    pub completed_at: Option<String>,
}

// ============================================================================
// Command DTO Inputs
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudyStepInput {
    pub step_key: String,
    pub ordinal: i64,
    pub input_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStudyJobInput {
    pub kind: StudyJobKind,
    pub target_id: String,
    pub target_revision: i64,
    pub creation_key: String,
    pub request_hash: String,
    pub preflight: serde_json::Value,
    pub steps: Vec<CreateStudyStepInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteStudyStepInput {
    pub job_id: String,
    pub step_key: String,
    pub lease_owner: String,
    pub cancellation_epoch: i64,
    pub input_hash: String,
    pub output_ref_id: Option<String>,
    pub next_step_index: i64,
    pub progress: StudyJobProgress,
    pub status: Option<StudyJobStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailStudyStepInput {
    pub job_id: String,
    pub step_key: String,
    pub lease_owner: String,
    pub cancellation_epoch: i64,
    pub error: StudyCommandError,
}
