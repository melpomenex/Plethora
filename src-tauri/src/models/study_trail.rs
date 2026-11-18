use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StructuralClass {
    InstructionalProse,
    WorkedExample,
    Argument,
    Definition,
    Toc,
    Bibliography,
    Index,
    FrontMatter,
    HeadingOnly,
    RunningHeaderFooter,
    IncidentalMention,
    Other,
}

impl StructuralClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InstructionalProse => "instructional_prose",
            Self::WorkedExample => "worked_example",
            Self::Argument => "argument",
            Self::Definition => "definition",
            Self::Toc => "toc",
            Self::Bibliography => "bibliography",
            Self::Index => "index",
            Self::FrontMatter => "front_matter",
            Self::HeadingOnly => "heading_only",
            Self::RunningHeaderFooter => "running_header_footer",
            Self::IncidentalMention => "incidental_mention",
            Self::Other => "other",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "instructional_prose" => Self::InstructionalProse,
            "worked_example" => Self::WorkedExample,
            "argument" => Self::Argument,
            "definition" => Self::Definition,
            "toc" => Self::Toc,
            "bibliography" => Self::Bibliography,
            "index" => Self::Index,
            "front_matter" => Self::FrontMatter,
            "heading_only" => Self::HeadingOnly,
            "running_header_footer" => Self::RunningHeaderFooter,
            "incidental_mention" => Self::IncidentalMention,
            _ => Self::Other,
        }
    }

    pub fn is_excluded_by_default(self) -> bool {
        matches!(
            self,
            Self::Toc
                | Self::Bibliography
                | Self::Index
                | Self::FrontMatter
                | Self::HeadingOnly
                | Self::RunningHeaderFooter
                | Self::IncidentalMention
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstructionalRole {
    CoreExplanation,
    PrerequisiteFoundation,
    WorkedExample,
    Counterexample,
    Synthesis,
    AlternativePerspective,
    Remediation,
}

impl InstructionalRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CoreExplanation => "core_explanation",
            Self::PrerequisiteFoundation => "prerequisite_foundation",
            Self::WorkedExample => "worked_example",
            Self::Counterexample => "counterexample",
            Self::Synthesis => "synthesis",
            Self::AlternativePerspective => "alternative_perspective",
            Self::Remediation => "remediation",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "prerequisite_foundation" => Self::PrerequisiteFoundation,
            "worked_example" => Self::WorkedExample,
            "counterexample" => Self::Counterexample,
            "synthesis" => Self::Synthesis,
            "alternative_perspective" => Self::AlternativePerspective,
            "remediation" => Self::Remediation,
            _ => Self::CoreExplanation,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SegmentValidationStatus {
    Verified,
    Stale,
    Missing,
    NeedsOcr,
    Rejected,
    Manual,
}

impl SegmentValidationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Verified => "verified",
            Self::Stale => "stale",
            Self::Missing => "missing",
            Self::NeedsOcr => "needs_ocr",
            Self::Rejected => "rejected",
            Self::Manual => "manual",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "verified" => Self::Verified,
            "stale" => Self::Stale,
            "missing" => Self::Missing,
            "needs_ocr" => Self::NeedsOcr,
            "rejected" => Self::Rejected,
            "manual" => Self::Manual,
            _ => Self::Missing,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SegmentReadinessStatus {
    Ready,
    NeedsOcr,
    NeedsTranscript,
    Unindexed,
    Unavailable,
}

impl SegmentReadinessStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::NeedsOcr => "needs_ocr",
            Self::NeedsTranscript => "needs_transcript",
            Self::Unindexed => "unindexed",
            Self::Unavailable => "unavailable",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "ready" => Self::Ready,
            "needs_ocr" => Self::NeedsOcr,
            "needs_transcript" => Self::NeedsTranscript,
            "unindexed" => Self::Unindexed,
            _ => Self::Unavailable,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectiveCoverageStatus {
    AdequatelyCovered,
    PartiallyCovered,
    MultiSegment,
    Insufficient,
    NoMatch,
    SourceUnavailable,
    RevisionChanged,
}

impl ObjectiveCoverageStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AdequatelyCovered => "adequately_covered",
            Self::PartiallyCovered => "partially_covered",
            Self::MultiSegment => "multi_segment",
            Self::Insufficient => "insufficient",
            Self::NoMatch => "no_match",
            Self::SourceUnavailable => "source_unavailable",
            Self::RevisionChanged => "revision_changed",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "adequately_covered" => Self::AdequatelyCovered,
            "partially_covered" => Self::PartiallyCovered,
            "multi_segment" => Self::MultiSegment,
            "insufficient" => Self::Insufficient,
            "source_unavailable" => Self::SourceUnavailable,
            "revision_changed" => Self::RevisionChanged,
            _ => Self::NoMatch,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StudyTrailItemStatus {
    Pending,
    InProgress,
    ReadingCompleted,
    CheckPassed,
    CheckNeedsReview,
    Skipped,
    Deferred,
}

impl StudyTrailItemStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::ReadingCompleted => "reading_completed",
            Self::CheckPassed => "check_passed",
            Self::CheckNeedsReview => "check_needs_review",
            Self::Skipped => "skipped",
            Self::Deferred => "deferred",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "in_progress" => Self::InProgress,
            "reading_completed" => Self::ReadingCompleted,
            "check_passed" => Self::CheckPassed,
            "check_needs_review" => Self::CheckNeedsReview,
            "skipped" => Self::Skipped,
            "deferred" => Self::Deferred,
            _ => Self::Pending,
        }
    }

    pub fn is_completed(self) -> bool {
        matches!(self, Self::ReadingCompleted | Self::CheckPassed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormativePromptFormat {
    ExplainOwnWords,
    ApplyExample,
    DistinguishConcepts,
    ArgumentFromPremises,
    IdentifyMisconception,
    SourceGroundedShortAnswer,
}

impl FormativePromptFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ExplainOwnWords => "explain_own_words",
            Self::ApplyExample => "apply_example",
            Self::DistinguishConcepts => "distinguish_concepts",
            Self::ArgumentFromPremises => "argument_from_premises",
            Self::IdentifyMisconception => "identify_misconception",
            Self::SourceGroundedShortAnswer => "source_grounded_short_answer",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "apply_example" => Self::ApplyExample,
            "distinguish_concepts" => Self::DistinguishConcepts,
            "argument_from_premises" => Self::ArgumentFromPremises,
            "identify_misconception" => Self::IdentifyMisconception,
            "source_grounded_short_answer" => Self::SourceGroundedShortAnswer,
            _ => Self::ExplainOwnWords,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormativeCheckOutcome {
    Understood,
    Partial,
    NeedsReview,
}

impl FormativeCheckOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Understood => "understood",
            Self::Partial => "partial",
            Self::NeedsReview => "needs_review",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "understood" => Self::Understood,
            "partial" => Self::Partial,
            _ => Self::NeedsReview,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssessmentEligibilityPolicy {
    Guided,
    AssessmentFirst,
    Open,
}

impl Default for AssessmentEligibilityPolicy {
    fn default() -> Self {
        Self::Guided
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningSegment {
    pub id: String,
    pub document_id: String,
    pub document_revision: String,
    pub format: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_section_label: Option<String>,
    pub start_locator: serde_json::Value,
    pub end_locator: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_offset: Option<i64>,
    pub excerpt_preview: String,
    pub word_count: i64,
    pub estimated_duration_seconds: i64,
    pub structural_class: StructuralClass,
    pub instructional_role: InstructionalRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality_rationale: Option<String>,
    pub validation_status: SegmentValidationStatus,
    pub readiness_status: SegmentReadinessStatus,
    pub generator_version: String,
    pub schema_version: i64,
    pub provenance: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningSegmentObjectiveLink {
    pub id: String,
    pub plan_id: String,
    pub version_id: String,
    pub node_id: String,
    pub objective_index: i64,
    pub segment_id: String,
    pub coverage_status: ObjectiveCoverageStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment_score: Option<f64>,
    pub selection_rationale: String,
    pub is_primary: bool,
    pub is_required: bool,
    pub authored_override: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyTrailItem {
    pub id: String,
    pub plan_id: String,
    pub version_id: String,
    pub node_id: String,
    pub objective_index: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    pub trail_order: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_group_id: Option<String>,
    pub status: StudyTrailItemStatus,
    pub reading_progress: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_locator: Option<serde_json::Value>,
    pub is_required: bool,
    pub is_remediation: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation_gap_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_order_override: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rejected_reason: Option<String>,
    pub planner_rationale: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormativeCheckResult {
    pub id: String,
    pub plan_id: String,
    pub version_id: String,
    pub trail_item_id: String,
    pub node_id: String,
    pub objective_index: i64,
    pub prompt_format: FormativePromptFormat,
    pub prompt_text: String,
    pub learner_response: String,
    pub outcome: FormativeCheckOutcome,
    pub feedback: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended_segment_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentEligibilitySummary {
    pub policy: AssessmentEligibilityPolicy,
    pub eligible: bool,
    pub required_total: usize,
    pub required_completed: usize,
    pub checks_passed: usize,
    pub blocking_reasons: Vec<String>,
    pub test_out_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyTrailOverview {
    pub plan_id: String,
    pub version_id: String,
    pub segments: Vec<LearningSegment>,
    pub objective_links: Vec<LearningSegmentObjectiveLink>,
    pub trail_items: Vec<StudyTrailItem>,
    pub formative_checks: Vec<FormativeCheckResult>,
    pub eligibility: AssessmentEligibilitySummary,
    pub document_titles: std::collections::HashMap<String, String>,
    pub diagnostics: Vec<String>,
}
