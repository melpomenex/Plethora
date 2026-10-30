//! Queue model

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct QueueItem {
    pub id: String,
    pub document_id: String,
    pub document_title: String,
    pub extract_id: Option<String>,
    pub learning_item_id: Option<String>,
    pub question: Option<String>,
    pub answer: Option<String>,
    pub cloze_text: Option<String>,
    /// Short, pre-stripped preview of the card content for queue LISTINGS.
    /// Populated only by the slim listing path (see `strip_content_for_listing`
    /// in commands/queue.rs), where `question`/`answer`/`cloze_text` are
    /// omitted from the payload; full-content commands leave it None.
    #[serde(default)]
    pub learning_hint: Option<String>,
    pub item_type: String, // "document", "extract", "video-extract", "learning-item", "playlist-video"
    pub priority_rating: Option<i32>,
    pub priority_slider: Option<i32>,
    pub priority: f64,
    pub due_date: Option<String>,
    pub estimated_time: i32, // in minutes
    pub tags: Vec<String>,
    pub category: Option<String>,
    pub progress: i32, // 0-100

    // Playlist video interspersion fields
    /// The source of this queue item (e.g., "playlist:<subscription_id>")
    pub source: Option<String>,
    /// The position in the queue (used for interspersion ordering)
    pub position: Option<i32>,

    // FSRS / algorithm metadata (populated when available)
    pub stability: Option<f64>,
    pub difficulty: Option<f64>,
    pub interval: Option<f64>,
    pub retrievability: Option<f64>,
    pub lapses: Option<i32>,
    pub reps: Option<i32>,

    // Canonical D1/D2 ranking & scheduling evidence (omitted when absent so older consumers stay compatible)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_priority: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority_available: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority_explicitly_set: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temporal_urgency: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temporal_available: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overdue_urgency: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_urgency: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_review_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stability_fast: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub algorithm_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_new_item: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
}
