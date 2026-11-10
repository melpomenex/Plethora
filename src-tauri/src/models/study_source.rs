//! Canonical Study Source models and Study Command Error types.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §1, §2
//! - openspec/changes/establish-persistent-study-plans/

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

// ============================================================================
// 1. Shared Study Command Error Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StudyErrorCode {
    InvalidInput,
    NotFound,
    UnsupportedVersion,
    UnsupportedPlatform,
    StaleRevision,
    InvalidState,
    OrderConflict,
    DependencyCycle,
    DanglingPrerequisite,
    DuplicateNode,
    InvalidSource,
    StaleSource,
    MissingSource,
    AmbiguousSource,
    InsufficientEvidence,
    QuotaShortfall,
    UncommittedQuestion,
    CommittedQuestionImmutable,
    DuplicateSubmission,
    GradingUnavailable,
    NeedsManualReview,
    ProviderUnavailable,
    ProviderCapabilityMissing,
    PrivacyDenied,
    CostConsentRequired,
    SourceAiExcluded,
    SourceChanged,
    JobLeaseStale,
    JobCancelled,
    InvalidModelOutput,
    ModelTimeout,
    StorageFailed,
    Cancelled,
    InternalError,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FieldIssue {
    pub path: String,
    pub code: String,
    pub message_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyCommandErrorDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_step_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_position: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_position: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_by_kind: Option<HashMap<String, i32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_node_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cycle: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyCommandError {
    pub code: StudyErrorCode,
    pub message_key: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_issues: Option<Vec<FieldIssue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<StudyCommandErrorDetails>,
}

impl fmt::Display for StudyCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message_key)
    }
}

impl std::error::Error for StudyCommandError {}

impl StudyCommandError {
    pub fn new(code: StudyErrorCode, message_key: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message_key: message_key.into(),
            retryable,
            field_issues: None,
            details: None,
        }
    }

    pub fn invalid_input(message_key: impl Into<String>, issues: Vec<FieldIssue>) -> Self {
        Self {
            code: StudyErrorCode::InvalidInput,
            message_key: message_key.into(),
            retryable: false,
            field_issues: if issues.is_empty() {
                None
            } else {
                Some(issues)
            },
            details: None,
        }
    }

    pub fn not_found(message_key: impl Into<String>) -> Self {
        Self::new(StudyErrorCode::NotFound, message_key, false)
    }

    pub fn storage_failed(message_key: impl Into<String>) -> Self {
        Self::new(StudyErrorCode::StorageFailed, message_key, true)
    }

    pub fn internal_error(message_key: impl Into<String>) -> Self {
        Self::new(StudyErrorCode::InternalError, message_key, false)
    }

    pub fn invalid_state(message_key: impl Into<String>) -> Self {
        Self::new(StudyErrorCode::InvalidState, message_key, false)
    }

    pub fn stale_revision(message_key: impl Into<String>) -> Self {
        Self::new(StudyErrorCode::StaleRevision, message_key, true)
    }

    pub fn order_conflict(message_key: impl Into<String>) -> Self {
        Self::new(StudyErrorCode::OrderConflict, message_key, false)
    }

    pub fn job_lease_stale(message_key: impl Into<String>) -> Self {
        Self::new(StudyErrorCode::JobLeaseStale, message_key, true)
    }

    pub fn job_cancelled(message_key: impl Into<String>) -> Self {
        Self::new(StudyErrorCode::JobCancelled, message_key, false)
    }

    pub fn quota_shortfall(message_key: impl Into<String>) -> Self {
        Self::new(StudyErrorCode::QuotaShortfall, message_key, false)
    }

    pub fn duplicate_submission(message_key: impl Into<String>) -> Self {
        Self::new(StudyErrorCode::DuplicateSubmission, message_key, false)
    }

    pub fn committed_question_immutable(message_key: impl Into<String>) -> Self {
        Self::new(
            StudyErrorCode::CommittedQuestionImmutable,
            message_key,
            false,
        )
    }
}

// ============================================================================
// 2. Study Source Enums and Structs
// ============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RevisionKind {
    ContentHash,
    ModifiedAt,
    Unknown,
}

impl fmt::Display for RevisionKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ContentHash => write!(f, "content-hash"),
            Self::ModifiedAt => write!(f, "modified-at"),
            Self::Unknown => write!(f, "unknown"),
        }
    }
}

impl std::str::FromStr for RevisionKind {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "content-hash" => Ok(Self::ContentHash),
            "modified-at" => Ok(Self::ModifiedAt),
            "unknown" => Ok(Self::Unknown),
            other => Err(format!("Unknown revision kind: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StudySourceStatus {
    Current,
    Stale,
    Missing,
    Ambiguous,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StudySourceNavigation {
    Exact,
    Coarse,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudySourceChunk {
    pub chunk_id: String,
    pub ordinal: i32,
    pub start_offset: i32,
    pub end_offset: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudySourceRefInput {
    pub document_id: String,
    pub extract_id: Option<String>,
    pub excerpt: String,
    pub excerpt_sha256: Option<String>,
    pub revision: Option<String>,
    pub revision_kind: Option<RevisionKind>,
    pub document_title: Option<String>,
    pub source_type: Option<String>,
    pub jump: Option<serde_json::Value>,
    pub chunk: Option<StudySourceChunk>,
    pub section_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudySourceRefV1 {
    pub schema_version: i32,
    pub id: String,
    pub document_id: String,
    pub extract_id: Option<String>,
    pub excerpt: String,
    pub excerpt_sha256: String,
    pub revision: String,
    pub revision_kind: RevisionKind,
    pub document_title: String,
    pub source_type: String,
    pub jump: Option<serde_json::Value>,
    pub chunk: Option<StudySourceChunk>,
    pub section_label: Option<String>,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudySourceResolution {
    #[serde(rename = "ref")]
    pub ref_item: StudySourceRefV1,
    pub status: StudySourceStatus,
    pub navigation: StudySourceNavigation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_key: Option<String>,
}
