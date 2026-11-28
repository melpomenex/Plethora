//! Canonical data models for Unified Learning Goals (Phase 1C).
//!
//! Matches `openspec/changes/unify-learning-goals-and-study-plans/design.md` and
//! migration `170_unified_learning_goals`.

use crate::error::{PlethoraError, Result};
use crate::models::learner_model::{CompetencyDimension, CompetencyStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LearningGoalKind {
    Exploration,
    Retention,
    Mastery,
    Deadline,
    Skill,
    Continuous,
    Language,
}

impl LearningGoalKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Exploration => "exploration",
            Self::Retention => "retention",
            Self::Mastery => "mastery",
            Self::Deadline => "deadline",
            Self::Skill => "skill",
            Self::Continuous => "continuous",
            Self::Language => "language",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self> {
        match value {
            "exploration" => Ok(Self::Exploration),
            "retention" => Ok(Self::Retention),
            "mastery" => Ok(Self::Mastery),
            "deadline" => Ok(Self::Deadline),
            "skill" => Ok(Self::Skill),
            "continuous" => Ok(Self::Continuous),
            "language" => Ok(Self::Language),
            other => Err(PlethoraError::Validation(format!(
                "Invalid learning goal kind: {}",
                other
            ))),
        }
    }

    pub fn default_dimensions(&self) -> Vec<CompetencyDimension> {
        match self {
            Self::Exploration | Self::Continuous => {
                vec![CompetencyDimension::Exposure, CompetencyDimension::Comprehension]
            }
            Self::Retention => vec![CompetencyDimension::Retention],
            Self::Mastery | Self::Deadline | Self::Language => vec![
                CompetencyDimension::Comprehension,
                CompetencyDimension::Retention,
                CompetencyDimension::Application,
            ],
            Self::Skill => vec![
                CompetencyDimension::Comprehension,
                CompetencyDimension::Application,
                CompetencyDimension::Transfer,
            ],
        }
    }

    pub fn default_mastery_threshold(&self) -> f64 {
        match self {
            Self::Exploration => 0.65,
            Self::Retention | Self::Mastery => 0.85,
            Self::Deadline | Self::Skill | Self::Language => 0.80,
            Self::Continuous => 0.70,
        }
    }

    pub fn default_daily_minutes_budget(&self) -> Option<i64> {
        match self {
            Self::Exploration => None,
            Self::Retention => Some(20),
            Self::Mastery | Self::Deadline => Some(45),
            Self::Skill | Self::Language => Some(30),
            Self::Continuous => Some(15),
        }
    }

    pub fn default_policy_json(&self) -> serde_json::Value {
        serde_json::json!({
            "defaultDimensions": self.default_dimensions(),
            "defaultMasteryThreshold": self.default_mastery_threshold(),
            "expectsDeadline": matches!(self, Self::Deadline),
            "expectsStudyPlan": matches!(self, Self::Mastery | Self::Deadline),
            "defaultDailyMinutesBudget": self.default_daily_minutes_budget(),
            "smartFeedsPrimary": matches!(self, Self::Continuous),
            "allowZeroDeadline": !matches!(self, Self::Deadline),
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LearningGoalStatus {
    Active,
    Paused,
    Completed,
    Archived,
}

impl LearningGoalStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Archived => "archived",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "completed" => Ok(Self::Completed),
            "archived" => Ok(Self::Archived),
            other => Err(PlethoraError::Validation(format!(
                "Invalid learning goal status: {}",
                other
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalSourceKind {
    Document,
    Collection,
    SavedQueue,
    StudyPlan,
    SmartFeed,
    Concept,
    Tag,
}

impl GoalSourceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Collection => "collection",
            Self::SavedQueue => "saved_queue",
            Self::StudyPlan => "study_plan",
            Self::SmartFeed => "smart_feed",
            Self::Concept => "concept",
            Self::Tag => "tag",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self> {
        match value {
            "document" => Ok(Self::Document),
            "collection" => Ok(Self::Collection),
            "saved_queue" => Ok(Self::SavedQueue),
            "study_plan" => Ok(Self::StudyPlan),
            "smart_feed" => Ok(Self::SmartFeed),
            "concept" => Ok(Self::Concept),
            "tag" => Ok(Self::Tag),
            other => Err(PlethoraError::Validation(format!(
                "Invalid goal source kind: {}",
                other
            ))),
        }
    }

    pub fn default_role(&self) -> GoalSourceRole {
        match self {
            Self::SmartFeed => GoalSourceRole::ExplorationCandidate,
            _ => GoalSourceRole::Primary,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalSourceRole {
    Primary,
    Supplemental,
    ExplorationCandidate,
}

impl GoalSourceRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::Supplemental => "supplemental",
            Self::ExplorationCandidate => "exploration_candidate",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self> {
        match value {
            "primary" => Ok(Self::Primary),
            "supplemental" => Ok(Self::Supplemental),
            "exploration_candidate" => Ok(Self::ExplorationCandidate),
            other => Err(PlethoraError::Validation(format!(
                "Invalid goal source role: {}",
                other
            ))),
        }
    }
}

pub fn validate_goal_source_link(kind: GoalSourceKind, role: GoalSourceRole) -> Result<()> {
    if kind == GoalSourceKind::SmartFeed && role != GoalSourceRole::ExplorationCandidate {
        return Err(PlethoraError::Validation(
            "Smart Feed sources must use source_role 'exploration_candidate' and never auto-create SRS review obligations.".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LearningGoalMilestoneStatus {
    Pending,
    Completed,
    Skipped,
}

impl LearningGoalMilestoneStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Completed => "completed",
            Self::Skipped => "skipped",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "completed" => Ok(Self::Completed),
            "skipped" => Ok(Self::Skipped),
            other => Err(PlethoraError::Validation(format!(
                "Invalid goal milestone status: {}",
                other
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalFeasibilityStatus {
    Unbounded,
    OnTrack,
    Tight,
    AtRisk,
    Infeasible,
    InsufficientData,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalAdjustmentKind {
    IncreaseDailyBudget,
    ExtendDeadline,
    NarrowScope,
    FocusWeakestDimensions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearningGoalSource {
    pub id: String,
    pub goal_id: String,
    pub source_kind: GoalSourceKind,
    pub source_id: String,
    pub source_role: GoalSourceRole,
    pub weight: f64,
    pub added_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_ai_excluded: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LearningGoalMilestone {
    pub id: String,
    pub goal_id: String,
    pub title: String,
    pub target_date: Option<String>,
    pub status: LearningGoalMilestoneStatus,
    pub linked_node_id: Option<String>,
    pub sort_order: i64,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearningGoal {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub kind: LearningGoalKind,
    pub status: LearningGoalStatus,
    pub priority: i64,
    pub study_plan_id: Option<String>,
    pub language_code: Option<String>,
    pub target_date: Option<String>,
    pub daily_minutes_budget: Option<i64>,
    pub target_dimensions: Vec<CompetencyDimension>,
    pub target_mastery_threshold: f64,
    pub policy: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub sources: Vec<LearningGoalSource>,
    pub milestones: Vec<LearningGoalMilestone>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLearningGoalSourceInput {
    pub source_kind: GoalSourceKind,
    pub source_id: String,
    #[serde(default)]
    pub source_role: Option<GoalSourceRole>,
    #[serde(default)]
    pub weight: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLearningGoalInput {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<LearningGoalKind>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub study_plan_id: Option<String>,
    #[serde(default)]
    pub language_code: Option<String>,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub daily_minutes_budget: Option<i64>,
    #[serde(default)]
    pub target_dimensions: Option<Vec<CompetencyDimension>>,
    #[serde(default)]
    pub target_mastery_threshold: Option<f64>,
    #[serde(default)]
    pub policy: Option<serde_json::Value>,
    #[serde(default)]
    pub initial_sources: Option<Vec<CreateLearningGoalSourceInput>>,
}

fn deserialize_double_option<'de, T, D>(deserializer: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLearningGoalInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub description: Option<Option<String>>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub language_code: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub target_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub daily_minutes_budget: Option<Option<i64>>,
    #[serde(default)]
    pub target_dimensions: Option<Vec<CompetencyDimension>>,
    #[serde(default)]
    pub target_mastery_threshold: Option<f64>,
    #[serde(default)]
    pub policy: Option<serde_json::Value>,
    #[serde(default)]
    pub status: Option<LearningGoalStatus>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolveLearningGoalInput {
    #[serde(default)]
    pub kind: Option<LearningGoalKind>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub study_plan_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub target_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub daily_minutes_budget: Option<Option<i64>>,
    #[serde(default)]
    pub target_dimensions: Option<Vec<CompetencyDimension>>,
    #[serde(default)]
    pub target_mastery_threshold: Option<f64>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub language_code: Option<Option<String>>,
    #[serde(default)]
    pub policy: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LearningGoalStatusFilter {
    Single(LearningGoalStatus),
    Multiple(Vec<LearningGoalStatus>),
}

impl LearningGoalStatusFilter {
    pub fn into_vec(&self) -> Vec<LearningGoalStatus> {
        match self {
            Self::Single(s) => vec![*s],
            Self::Multiple(v) => v.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListLearningGoalsFilter {
    #[serde(default)]
    pub status: Option<LearningGoalStatusFilter>,
    #[serde(default)]
    pub kind: Option<LearningGoalKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkGoalSourceInput {
    pub goal_id: String,
    pub source_kind: GoalSourceKind,
    pub source_id: String,
    #[serde(default)]
    pub source_role: Option<GoalSourceRole>,
    #[serde(default)]
    pub weight: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertGoalMilestoneInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub status: Option<LearningGoalMilestoneStatus>,
    #[serde(default)]
    pub linked_node_id: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GoalDimensionProjection {
    pub dimension: CompetencyDimension,
    pub status: CompetencyStatus,
    pub estimate: Option<f64>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub last_evidence_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalConceptFeasibilityInput {
    pub concept_id: String,
    pub estimated_minutes_to_master: f64,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub dimensions: HashMap<CompetencyDimension, GoalDimensionProjection>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateGoalFeasibilityContext {
    #[serde(default)]
    pub concept_states: Option<Vec<GoalConceptFeasibilityInput>>,
    #[serde(default)]
    pub uncompleted_reading_minutes: Option<f64>,
    #[serde(default)]
    pub projected_due_review_minutes: Option<f64>,
    #[serde(default)]
    pub now_iso: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GoalAdjustmentSuggestion {
    pub kind: GoalAdjustmentKind,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_daily_minutes_budget: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_target_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deferrable_source_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deferrable_concept_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_dimensions: Option<Vec<CompetencyDimension>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GoalFeasibilityReport {
    pub goal_id: String,
    pub status: GoalFeasibilityStatus,
    pub remaining_minutes: i64,
    pub remaining_concept_minutes: i64,
    pub remaining_reading_minutes: i64,
    pub projected_review_minutes: i64,
    pub available_minutes: Option<i64>,
    pub days_remaining: Option<i64>,
    pub required_daily_minutes: Option<i64>,
    pub utilization_ratio: Option<f64>,
    pub progress_ratio: f64,
    pub prior_mastered_concept_count: i64,
    pub total_concept_count: i64,
    pub recommendations: Vec<GoalAdjustmentSuggestion>,
    pub uncertainty_reasons: Vec<String>,
    pub evaluated_at: String,
}
