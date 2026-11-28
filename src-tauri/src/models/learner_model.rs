//! Canonical data models for the 5-dimension Persistent Learner Model (Phase 1B).
//!
//! Matches `openspec/changes/establish-persistent-learner-model/design.md` and
//! migration `169_persistent_learner_model`.

use crate::error::{PlethoraError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const COMPETENCY_POLICY_VERSION: &str = "competency-v1";

pub const ALL_COMPETENCY_DIMENSIONS: [CompetencyDimension; 5] = [
    CompetencyDimension::Exposure,
    CompetencyDimension::Comprehension,
    CompetencyDimension::Retention,
    CompetencyDimension::Application,
    CompetencyDimension::Transfer,
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CompetencyDimension {
    Exposure,
    Comprehension,
    Retention,
    Application,
    Transfer,
}

impl CompetencyDimension {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Exposure => "exposure",
            Self::Comprehension => "comprehension",
            Self::Retention => "retention",
            Self::Application => "application",
            Self::Transfer => "transfer",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self> {
        match value {
            "exposure" => Ok(Self::Exposure),
            "comprehension" => Ok(Self::Comprehension),
            "retention" => Ok(Self::Retention),
            "application" => Ok(Self::Application),
            "transfer" => Ok(Self::Transfer),
            other => Err(PlethoraError::Validation(format!(
                "Invalid competency dimension: {}",
                other
            ))),
        }
    }

    pub fn half_life_days(&self) -> f64 {
        match self {
            Self::Exposure => 90.0,
            Self::Comprehension => 120.0,
            Self::Retention => 45.0,
            Self::Application => 120.0,
            Self::Transfer => 180.0,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompetencyStatus {
    Unknown,
    InsufficientEvidence,
    NeedsAttention,
    Developing,
    Demonstrated,
}

impl CompetencyStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::InsufficientEvidence => "insufficient_evidence",
            Self::NeedsAttention => "needs_attention",
            Self::Developing => "developing",
            Self::Demonstrated => "demonstrated",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self> {
        match value {
            "unknown" => Ok(Self::Unknown),
            "insufficient_evidence" => Ok(Self::InsufficientEvidence),
            "needs_attention" => Ok(Self::NeedsAttention),
            "developing" => Ok(Self::Developing),
            "demonstrated" => Ok(Self::Demonstrated),
            other => Err(PlethoraError::Validation(format!(
                "Invalid competency status: {}",
                other
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompetencyEvidenceSourceKind {
    ReadingProgress,
    ExtractCreated,
    GuidedCheck,
    FsrsReview,
    SocraticPractice,
    PracticeAttempt,
    ExamGrade,
    DiagnosticGrade,
    LanguagePractice,
}

impl CompetencyEvidenceSourceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ReadingProgress => "reading_progress",
            Self::ExtractCreated => "extract_created",
            Self::GuidedCheck => "guided_check",
            Self::FsrsReview => "fsrs_review",
            Self::SocraticPractice => "socratic_practice",
            Self::PracticeAttempt => "practice_attempt",
            Self::ExamGrade => "exam_grade",
            Self::DiagnosticGrade => "diagnostic_grade",
            Self::LanguagePractice => "language_practice",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self> {
        match value {
            "reading_progress" => Ok(Self::ReadingProgress),
            "extract_created" => Ok(Self::ExtractCreated),
            "guided_check" => Ok(Self::GuidedCheck),
            "fsrs_review" => Ok(Self::FsrsReview),
            "socratic_practice" => Ok(Self::SocraticPractice),
            "practice_attempt" => Ok(Self::PracticeAttempt),
            "exam_grade" => Ok(Self::ExamGrade),
            "diagnostic_grade" => Ok(Self::DiagnosticGrade),
            "language_practice" => Ok(Self::LanguagePractice),
            other => Err(PlethoraError::Validation(format!(
                "Invalid competency evidence source kind: {}",
                other
            ))),
        }
    }

    pub fn is_exposure_only(&self) -> bool {
        matches!(self, Self::ReadingProgress | Self::ExtractCreated)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeclaredCompetencyLevel {
    Unfamiliar,
    Familiar,
    Confident,
    NeedsRefresh,
}

impl DeclaredCompetencyLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unfamiliar => "unfamiliar",
            Self::Familiar => "familiar",
            Self::Confident => "confident",
            Self::NeedsRefresh => "needs_refresh",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self> {
        match value {
            "unfamiliar" => Ok(Self::Unfamiliar),
            "familiar" => Ok(Self::Familiar),
            "confident" => Ok(Self::Confident),
            "needs_refresh" => Ok(Self::NeedsRefresh),
            other => Err(PlethoraError::Validation(format!(
                "Invalid declared competency level: {}",
                other
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompetencyEvidenceRecord {
    pub id: String,
    pub concept_id: String,
    pub dimension: CompetencyDimension,
    pub source_kind: CompetencyEvidenceSourceKind,
    pub source_event_id: Option<String>,
    pub source_record_id: String,
    pub evidence_group_id: String,
    pub card_family_id: Option<String>,
    pub session_id: Option<String>,
    pub observed_score: Option<f64>,
    pub base_weight: f64,
    pub elapsed_days: Option<f64>,
    pub hint_level: i64,
    pub is_verified: bool,
    pub is_invalidated: bool,
    pub invalidated_by_event_id: Option<String>,
    pub document_id: Option<String>,
    pub is_local_only: bool,
    pub is_ai_excluded: bool,
    pub occurred_at: String,
    pub policy_version: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordCompetencyEvidenceInput {
    #[serde(default)]
    pub id: Option<String>,
    pub concept_id: String,
    pub dimension: CompetencyDimension,
    pub source_kind: CompetencyEvidenceSourceKind,
    #[serde(default)]
    pub source_event_id: Option<String>,
    pub source_record_id: String,
    pub evidence_group_id: String,
    #[serde(default)]
    pub card_family_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub observed_score: Option<f64>,
    pub base_weight: f64,
    #[serde(default)]
    pub elapsed_days: Option<f64>,
    #[serde(default)]
    pub hint_level: Option<i64>,
    #[serde(default)]
    pub is_verified: Option<bool>,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub is_local_only: Option<bool>,
    #[serde(default)]
    pub is_ai_excluded: Option<bool>,
    #[serde(default)]
    pub occurred_at: Option<String>,
    #[serde(default)]
    pub policy_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvalidateCompetencyEvidenceResult {
    pub invalidated_count: i64,
    pub affected_concept_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DimensionProjection {
    pub dimension: CompetencyDimension,
    pub status: CompetencyStatus,
    pub estimate: Option<f64>,
    pub confidence: f64,
    pub effective_weight: f64,
    pub raw_evidence_count: i64,
    pub independent_groups: i64,
    pub distinct_days: i64,
    pub uncertainty_reasons: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub last_evidence_at: Option<String>,
    pub policy_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LearnerCompetencyDeclaration {
    pub id: String,
    pub concept_id: String,
    pub declared_level: DeclaredCompetencyLevel,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConceptCompetencyProfile {
    pub concept_id: String,
    pub concept_name: String,
    pub dimensions: HashMap<CompetencyDimension, DimensionProjection>,
    pub self_declaration: Option<LearnerCompetencyDeclaration>,
    pub contains_local_only_evidence: bool,
    pub contains_ai_excluded_evidence: bool,
}
