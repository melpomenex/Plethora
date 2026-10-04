//! Saved queue model for user-defined queue presets

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriorityRange {
    pub min: f64,
    pub max: f64,
}

impl Default for PriorityRange {
    fn default() -> Self {
        Self { min: 0.0, max: 100.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueueFilters {
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub priority_range: PriorityRange,
    #[serde(default = "default_true")]
    pub exclude_suspended: bool,
}

impl Default for SavedQueueFilters {
    fn default() -> Self {
        Self {
            categories: Vec::new(),
            tags: Vec::new(),
            priority_range: PriorityRange::default(),
            exclude_suspended: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueueItemTypes {
    #[serde(default = "default_true")]
    pub documents: bool,
    #[serde(default = "default_true")]
    pub extracts: bool,
    #[serde(default = "default_true")]
    pub learning_items: bool,
}

fn default_true() -> bool {
    true
}

impl Default for SavedQueueItemTypes {
    fn default() -> Self {
        Self {
            documents: true,
            extracts: true,
            learning_items: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueue {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub collection_id: Option<String>,
    pub filters: SavedQueueFilters,
    pub item_types: SavedQueueItemTypes,
    pub session_duration_minutes: i64,
    pub max_items: i64,
    pub daqe_preset_id: Option<String>,
    pub session_goal: Option<String>,
    pub is_default: bool,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSavedQueueInput {
    pub name: String,
    pub icon: Option<String>,
    pub collection_id: Option<String>,
    pub filters: Option<SavedQueueFilters>,
    pub item_types: Option<SavedQueueItemTypes>,
    pub session_duration_minutes: Option<i64>,
    pub max_items: Option<i64>,
    pub daqe_preset_id: Option<String>,
    pub session_goal: Option<String>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSavedQueueInput {
    pub name: Option<String>,
    pub icon: Option<String>,
    pub collection_id: Option<String>,
    pub filters: Option<SavedQueueFilters>,
    pub item_types: Option<SavedQueueItemTypes>,
    pub session_duration_minutes: Option<i64>,
    pub max_items: Option<i64>,
    pub daqe_preset_id: Option<String>,
    pub session_goal: Option<String>,
    pub is_default: Option<bool>,
    pub sort_order: Option<i64>,
}
