//! Canonical Study Plan domain models and command DTOs.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3, §11
//! - openspec/changes/establish-persistent-study-plans/

use super::study_source::{RevisionKind, StudySourceResolution};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StudyDepth {
    Survey,
    Foundational,
    Deep,
}

impl fmt::Display for StudyDepth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Survey => write!(f, "survey"),
            Self::Foundational => write!(f, "foundational"),
            Self::Deep => write!(f, "deep"),
        }
    }
}

impl std::str::FromStr for StudyDepth {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "survey" => Ok(Self::Survey),
            "foundational" => Ok(Self::Foundational),
            "deep" => Ok(Self::Deep),
            other => Err(format!("Unknown study depth: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StudyPlanStatus {
    Active,
    Archived,
}

impl fmt::Display for StudyPlanStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Archived => write!(f, "archived"),
        }
    }
}

impl std::str::FromStr for StudyPlanStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "archived" => Ok(Self::Archived),
            other => Err(format!("Unknown study plan status: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanVersionState {
    Draft,
    Published,
    Superseded,
}

impl fmt::Display for PlanVersionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Draft => write!(f, "draft"),
            Self::Published => write!(f, "published"),
            Self::Superseded => write!(f, "superseded"),
        }
    }
}

impl std::str::FromStr for PlanVersionState {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "draft" => Ok(Self::Draft),
            "published" => Ok(Self::Published),
            "superseded" => Ok(Self::Superseded),
            other => Err(format!("Unknown plan version state: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NodeActivity {
    NotStarted,
    InProgress,
    Completed,
    Skipped,
}

impl fmt::Display for NodeActivity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotStarted => write!(f, "not-started"),
            Self::InProgress => write!(f, "in-progress"),
            Self::Completed => write!(f, "completed"),
            Self::Skipped => write!(f, "skipped"),
        }
    }
}

impl std::str::FromStr for NodeActivity {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "not-started" => Ok(Self::NotStarted),
            "in-progress" => Ok(Self::InProgress),
            "completed" => Ok(Self::Completed),
            "skipped" => Ok(Self::Skipped),
            other => Err(format!("Unknown node activity: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MaterialSupport {
    Grounded,
    Unsupported,
    NotValidated,
}

impl fmt::Display for MaterialSupport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Grounded => write!(f, "grounded"),
            Self::Unsupported => write!(f, "unsupported"),
            Self::NotValidated => write!(f, "not-validated"),
        }
    }
}

impl std::str::FromStr for MaterialSupport {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "grounded" => Ok(Self::Grounded),
            "unsupported" => Ok(Self::Unsupported),
            "not-validated" => Ok(Self::NotValidated),
            other => Err(format!("Unknown material support: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlan {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub depth: StudyDepth,
    pub status: StudyPlanStatus,
    pub current_version_id: Option<String>,
    pub current_version: i64,
    pub draft_version_id: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanNodeIdentity {
    pub id: String,
    pub plan_id: String,
    pub semantic_key: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanVersionNode {
    pub node_id: String,
    pub title: String,
    pub summary: String,
    pub learning_objectives: Vec<String>,
    pub concept_id: Option<String>,
    pub concept_label: String,
    pub position: i32,
    pub included: bool,
    pub locked: bool,
    pub user_added: bool,
    pub user_modified: bool,
    pub material_support: MaterialSupport,
    pub why_here: Option<String>,
    pub source_ref_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanPrerequisite {
    pub prerequisite_node_id: String,
    pub dependent_node_id: String,
    pub support: String,
    pub rationale: Option<String>,
    pub source_ref_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LockConflict {
    pub node_id: String,
    pub previous_position: i32,
    pub actual_position: i32,
    pub reason_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanVersionDiff {
    pub added_node_ids: Vec<String>,
    pub removed_node_ids: Vec<String>,
    pub modified_node_ids: Vec<String>,
    pub reordered_node_ids: Vec<String>,
    pub added_prerequisites: Vec<(String, String)>,
    pub removed_prerequisites: Vec<(String, String)>,
    pub lock_conflicts: Vec<LockConflict>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanVersion {
    pub id: String,
    pub plan_id: String,
    pub version: i64,
    pub state: PlanVersionState,
    pub base_version_id: Option<String>,
    pub source_scope: serde_json::Value,
    pub nodes: Vec<StudyPlanVersionNode>,
    pub prerequisites: Vec<PlanPrerequisite>,
    pub change_summary: Option<PlanVersionDiff>,
    pub created_by: String,
    pub created_at: String,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanDetail {
    pub plan: StudyPlan,
    pub version: StudyPlanVersion,
    pub activity_by_node_id: HashMap<String, NodeActivity>,
    pub source_refs: HashMap<String, StudySourceResolution>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanSummary {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub depth: StudyDepth,
    pub status: StudyPlanStatus,
    pub current_version: i64,
    pub node_count: i64,
    pub completed_node_count: i64,
    pub source_document_count: i64,
    pub has_draft: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudyPlanInput {
    pub title: String,
    pub goal: String,
    pub depth: StudyDepth,
    pub source_scope: serde_json::Value,
    pub initial_nodes: Option<Vec<StudyPlanVersionNode>>,
    pub initial_prerequisites: Option<Vec<PlanPrerequisite>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStudyPlanDraftInput {
    pub plan_id: String,
    pub expected_draft_revision: i64,
    #[serde(default)]
    pub source_refs: std::collections::BTreeMap<String, super::study_source::StudySourceRefInput>,
    pub source_scope: Option<serde_json::Value>,
    pub nodes: Vec<StudyPlanVersionNode>,
    pub prerequisites: Vec<PlanPrerequisite>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportResult {
    pub plan_id: String,
    pub imported_node_count: usize,
    pub imported_version: i64,
    pub is_retry: bool,
}
