//! Learning item model

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// FSRS Memory State (stability, difficulty, and FSRS-7 fast stability)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryState {
    pub stability: f64,
    pub difficulty: f64,
    /// FSRS-7 fast stability track. `None` on legacy rows until the next review.
    #[serde(default)]
    pub stability_fast: Option<f64>,
}

impl MemoryState {
    pub fn new(stability: f64, difficulty: f64) -> Self {
        Self {
            stability,
            difficulty,
            stability_fast: None,
        }
    }
}

/// Rating for a review
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReviewRating {
    Again = 1,
    Hard = 2,
    Good = 3,
    Easy = 4,
}

impl From<i32> for ReviewRating {
    fn from(value: i32) -> Self {
        match value {
            1 => ReviewRating::Again,
            2 => ReviewRating::Hard,
            3 => ReviewRating::Good,
            4 => ReviewRating::Easy,
            _ => ReviewRating::Good,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningItem {
    pub id: String,
    pub collection_id: String,
    pub extract_id: Option<String>,
    pub document_id: Option<String>,
    pub item_type: ItemType,
    pub question: String,
    pub answer: Option<String>,
    pub cloze_text: Option<String>,
    pub cloze_ranges: Option<Vec<(usize, usize)>>,
    pub difficulty: i32,
    /// Interval in days (can be fractional for learning items, e.g., 0.1 = 2.4 hours)
    pub interval: f64,
    pub ease_factor: f64,
    pub due_date: DateTime<Utc>,
    pub date_created: DateTime<Utc>,
    pub date_modified: DateTime<Utc>,
    pub last_review_date: Option<DateTime<Utc>>,
    pub review_count: i32,
    pub lapses: i32,
    pub state: ItemState,
    pub is_suspended: bool,
    pub tags: Vec<String>,
    pub image_asset_ids: Vec<String>,
    pub interaction_metadata: Option<Value>,
    /// FSRS Memory State (stability and difficulty)
    pub memory_state: Option<MemoryState>,
    /// Algorithm type used for scheduling (e.g., "fsrs", "classic", "adaptive", "precision")
    pub algorithm_type: String,
    /// Algorithm-specific state as JSON (e.g., Adaptive state, Classic params)
    pub algorithm_state: Option<String>,
    /// Sync clock (HLC string from the frontend's `nowHLC()`). Drives
    /// whole-row last-writer-wins merges across devices; separate from
    /// `date_modified` (which also reflects local-only UI edits) so the sync
    /// conflict check is unambiguous. Stored as TEXT; absent on legacy rows
    /// until next review. `None` here means "not yet synced".
    #[serde(default)]
    pub updated_at: Option<String>,
    pub first_reviewed_at: Option<DateTime<Utc>>,
    /// User-set importance rank on the 0-100 priority-queue scale.
    /// Default 50 = neutral midpoint, so un-prioritized cards are not
    /// silently demoted to the bottom. This is distinct from FSRS urgency,
    /// which drives *when* the card is scheduled.
    #[serde(default = "default_priority_slider")]
    pub priority_slider: i32,
    /// Derived priority score used for queue ordering. Recomputed from the
    /// slider on write so the sort key is always consistent.
    #[serde(default)]
    pub priority_score: f64,
    /// 1 once the user commits a priority (any value, including 0); 0 means
    /// never touched. Lets the priority UI distinguish "deliberately set to 0"
    /// from "never set" without a nullable column.
    #[serde(default)]
    pub priority_explicitly_set: bool,
}

fn default_priority_slider() -> i32 {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ItemType {
    Flashcard,
    Cloze,
    Qa,
    Basic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemState {
    New,
    Learning,
    Review,
    Relearning,
}

impl LearningItem {
    pub fn new(item_type: ItemType, question: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            collection_id: super::collection::DEFAULT_COLLECTION_ID.to_string(),
            extract_id: None,
            document_id: None,
            item_type,
            question,
            answer: None,
            cloze_text: None,
            cloze_ranges: None,
            difficulty: 3,
            interval: 0.0,
            ease_factor: 2.5,
            due_date: now,
            date_created: now,
            date_modified: now,
            last_review_date: None,
            review_count: 0,
            lapses: 0,
            state: ItemState::New,
            is_suspended: false,
            tags: Vec::new(),
            image_asset_ids: Vec::new(),
            interaction_metadata: None,
            memory_state: None,
            algorithm_type: "fsrs".to_string(),
            algorithm_state: None,
            updated_at: None,
            first_reviewed_at: None,
            priority_slider: 50,
            priority_score: 0.0,
            priority_explicitly_set: false,
        }
    }

    pub fn with_answer(
        document_id: String,
        item_type: ItemType,
        question: String,
        answer: String,
    ) -> Self {
        let mut item = Self::new(item_type, question);
        item.document_id = Some(document_id);
        item.answer = Some(answer);
        item
    }

    pub fn from_extract(
        extract_id: String,
        document_id: String,
        item_type: ItemType,
        question: String,
        answer: Option<String>,
    ) -> Self {
        let mut item = Self::new(item_type, question);
        item.extract_id = Some(extract_id);
        item.document_id = Some(document_id);
        item.answer = answer;
        item
    }
}
