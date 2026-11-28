//! Canonical data models for the unified learning event spine (Phase 1A).
//!
//! Matches `openspec/changes/unify-learning-state-and-events/design.md` and
//! migration `168_unify_learning_state_events`.

use crate::error::{PlethoraError, Result};
use serde::{Deserialize, Serialize};

pub const LEARNING_EVENT_SCHEMA_VERSION: i64 = 1;

pub const VALID_LEARNING_ACTORS: &[&str] = &["user", "system", "sync"];

pub const VALID_LEARNING_SURFACES: &[&str] = &[
    "review",
    "scroll_mode",
    "quick_review",
    "zen_review",
    "queue",
    "reader",
    "study_mode",
    "guided_trail",
    "exam",
    "unified_session",
    "knowledge_atlas",
    "today_dashboard",
    "background",
    "sync",
    "unknown",
];

pub const VALID_LEARNING_ENTITY_KINDS: &[&str] = &[
    "learning_item",
    "extract",
    "document",
    "concept",
    "study_plan",
    "study_plan_node",
    "assessment_attempt",
    "exam_grade",
    "guided_trail",
    "learning_goal",
    "learning_session",
    "remediation",
];

const FORBIDDEN_HEALTH_TOKENS: &[&str] = &[
    "health",
    "wearable",
    "biometric",
    "heart_rate",
    "heartrate",
    "hrv",
    "sleep",
    "blood_pressure",
    "bloodpressure",
    "spo2",
    "vo2",
    "glucose",
    "garmin",
    "whoop",
    "oura",
    "fitbit",
    "apple_health",
    "applehealth",
    "body_weight",
    "bodyweight",
    "menstrual",
    "medication",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum LearningEventType {
    ReviewCommitted,
    ReviewUndone,
    ReadingProgressed,
    ReadingCompleted,
    ExtractCreated,
    CardCreated,
    GuidedCheckCompleted,
    PracticeAttempted,
    AssessmentSubmitted,
    AssessmentGraded,
    AssessmentGradeInvalidated,
    ConceptMasteryDeclared,
    GoalCreated,
    GoalUpdated,
    GoalCompleted,
    SessionStarted,
    SessionPaused,
    SessionResumed,
    SessionCompleted,
    RemediationCompleted,
}

impl LearningEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ReviewCommitted => "review_committed",
            Self::ReviewUndone => "review_undone",
            Self::ReadingProgressed => "reading_progressed",
            Self::ReadingCompleted => "reading_completed",
            Self::ExtractCreated => "extract_created",
            Self::CardCreated => "card_created",
            Self::GuidedCheckCompleted => "guided_check_completed",
            Self::PracticeAttempted => "practice_attempted",
            Self::AssessmentSubmitted => "assessment_submitted",
            Self::AssessmentGraded => "assessment_graded",
            Self::AssessmentGradeInvalidated => "assessment_grade_invalidated",
            Self::ConceptMasteryDeclared => "concept_mastery_declared",
            Self::GoalCreated => "goal_created",
            Self::GoalUpdated => "goal_updated",
            Self::GoalCompleted => "goal_completed",
            Self::SessionStarted => "session_started",
            Self::SessionPaused => "session_paused",
            Self::SessionResumed => "session_resumed",
            Self::SessionCompleted => "session_completed",
            Self::RemediationCompleted => "remediation_completed",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self> {
        match value {
            "review_committed" => Ok(Self::ReviewCommitted),
            "review_undone" => Ok(Self::ReviewUndone),
            "reading_progressed" => Ok(Self::ReadingProgressed),
            "reading_completed" => Ok(Self::ReadingCompleted),
            "extract_created" => Ok(Self::ExtractCreated),
            "card_created" => Ok(Self::CardCreated),
            "guided_check_completed" => Ok(Self::GuidedCheckCompleted),
            "practice_attempted" => Ok(Self::PracticeAttempted),
            "assessment_submitted" => Ok(Self::AssessmentSubmitted),
            "assessment_graded" => Ok(Self::AssessmentGraded),
            "assessment_grade_invalidated" => Ok(Self::AssessmentGradeInvalidated),
            "concept_mastery_declared" => Ok(Self::ConceptMasteryDeclared),
            "goal_created" => Ok(Self::GoalCreated),
            "goal_updated" => Ok(Self::GoalUpdated),
            "goal_completed" => Ok(Self::GoalCompleted),
            "session_started" => Ok(Self::SessionStarted),
            "session_paused" => Ok(Self::SessionPaused),
            "session_resumed" => Ok(Self::SessionResumed),
            "session_completed" => Ok(Self::SessionCompleted),
            "remediation_completed" => Ok(Self::RemediationCompleted),
            other => Err(PlethoraError::Validation(format!(
                "Invalid learning event type: {}",
                other
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearningEvent {
    pub seq: i64,
    pub id: String,
    pub idempotency_key: String,
    pub schema_version: i64,
    pub event_type: LearningEventType,
    pub actor: String,
    pub surface: String,
    pub session_id: Option<String>,
    pub goal_id: Option<String>,
    pub entity_kind: String,
    pub entity_id: String,
    pub document_id: Option<String>,
    pub is_local_only: bool,
    pub is_ai_excluded: bool,
    pub payload: serde_json::Value,
    pub occurred_at: String,
    pub created_at: String,
    pub retracted_by_event_id: Option<String>,
}

fn default_empty_object() -> serde_json::Value {
    serde_json::Value::Object(serde_json::Map::new())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendLearningEventInput {
    pub idempotency_key: String,
    pub event_type: LearningEventType,
    #[serde(default)]
    pub actor: Option<String>,
    pub surface: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub goal_id: Option<String>,
    pub entity_kind: String,
    pub entity_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub is_local_only: Option<bool>,
    #[serde(default)]
    pub is_ai_excluded: Option<bool>,
    #[serde(default = "default_empty_object")]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub occurred_at: Option<String>,
    #[serde(default)]
    pub retracts_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendLearningEventResult {
    pub event: LearningEvent,
    pub inserted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LearningEventCheckpoint {
    pub consumer_id: String,
    pub last_seq: i64,
    pub policy_version: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningEventFilter {
    #[serde(default)]
    pub event_types: Option<Vec<LearningEventType>>,
    #[serde(default)]
    pub surfaces: Option<Vec<String>>,
    #[serde(default)]
    pub entity_kind: Option<String>,
    #[serde(default)]
    pub entity_id: Option<String>,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub goal_id: Option<String>,
    #[serde(default)]
    pub since_seq: Option<i64>,
    #[serde(default)]
    pub include_retracted: Option<bool>,
    #[serde(default)]
    pub exclude_ai_excluded: Option<bool>,
    #[serde(default)]
    pub limit: Option<i64>,
}

fn contains_health_token(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let compact: String = lower
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    FORBIDDEN_HEALTH_TOKENS
        .iter()
        .any(|tok| lower.contains(tok) || compact.contains(tok))
}

fn scan_payload_for_health_fields(value: &serde_json::Value, path: &str) -> Result<()> {
    match value {
        serde_json::Value::Array(items) => {
            for (idx, item) in items.iter().enumerate() {
                scan_payload_for_health_fields(item, &format!("{}[{}]", path, idx))?;
            }
        }
        serde_json::Value::Object(map) => {
            for (key, nested) in map {
                if contains_health_token(key) {
                    return Err(PlethoraError::Validation(format!(
                        "Health Vault boundary violation: forbidden field '{}.{}' cannot enter learning_events",
                        path, key
                    )));
                }
                scan_payload_for_health_fields(nested, &format!("{}.{}", path, key))?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Enforces the Health Vault hard boundary and validates learning event fields.
pub fn validate_learning_event_input(input: &AppendLearningEventInput) -> Result<()> {
    if input.idempotency_key.trim().is_empty() {
        return Err(PlethoraError::Validation(
            "idempotency_key cannot be empty".to_string(),
        ));
    }
    if input.entity_id.trim().is_empty() {
        return Err(PlethoraError::Validation(
            "entity_id cannot be empty".to_string(),
        ));
    }

    if contains_health_token(&input.entity_kind) {
        return Err(PlethoraError::Validation(format!(
            "Health Vault boundary violation: entity_kind '{}' is forbidden in learning_events",
            input.entity_kind
        )));
    }
    if !VALID_LEARNING_ENTITY_KINDS.contains(&input.entity_kind.as_str()) {
        return Err(PlethoraError::Validation(format!(
            "Invalid learning event entity_kind: '{}'",
            input.entity_kind
        )));
    }

    if contains_health_token(&input.surface) {
        return Err(PlethoraError::Validation(format!(
            "Health Vault boundary violation: surface '{}' is forbidden in learning_events",
            input.surface
        )));
    }
    if !VALID_LEARNING_SURFACES.contains(&input.surface.as_str()) {
        return Err(PlethoraError::Validation(format!(
            "Invalid learning event surface: '{}'",
            input.surface
        )));
    }

    let actor = input.actor.as_deref().unwrap_or("user");
    if !VALID_LEARNING_ACTORS.contains(&actor) {
        return Err(PlethoraError::Validation(format!(
            "Invalid learning event actor: '{}'",
            actor
        )));
    }

    scan_payload_for_health_fields(&input.payload, "payload")?;
    Ok(())
}
