//! Per-item activity history model
//!
//! Backs the `item_activity_log` table: one row per accrual of active time or
//! completion of a review, for the item types whose history has no other home.
//! Flashcards are deliberately absent — their history already lives in
//! `review_results`, the synced revlog, and is read from there in place.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Item types that write to `item_activity_log`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivityItemType {
    Document,
    Extract,
}

impl ActivityItemType {
    /// The value stored in `item_activity_log.item_type`.
    pub fn as_str(&self) -> &'static str {
        match self {
            ActivityItemType::Document => "document",
            ActivityItemType::Extract => "extract",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "document" => Some(ActivityItemType::Document),
            "extract" => Some(ActivityItemType::Extract),
            _ => None,
        }
    }
}

/// Where an interaction happened. The distinction is user-visible: the stats
/// view splits an item's time by surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivitySurface {
    Queue,
    Reader,
}

impl ActivitySurface {
    /// The value stored in `item_activity_log.surface`.
    pub fn as_str(&self) -> &'static str {
        match self {
            ActivitySurface::Queue => "queue",
            ActivitySurface::Reader => "reader",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "queue" => Some(ActivitySurface::Queue),
            "reader" => Some(ActivitySurface::Reader),
            _ => None,
        }
    }
}

/// One row of `item_activity_log`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemActivityEvent {
    pub id: String,
    pub item_type: ActivityItemType,
    pub item_id: String,
    pub surface: ActivitySurface,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    /// Active seconds attributed to this interaction — never wall-clock.
    pub active_seconds: i64,
    /// Present only when the interaction was a review.
    pub rating: Option<i32>,
    /// The interval the review produced, in days.
    pub resulting_interval_days: Option<f64>,
    /// Reading progress at the start of the interaction (documents only).
    pub progress_start: Option<f64>,
    /// Reading progress at the end of the interaction (documents only).
    pub progress_end: Option<f64>,
}

impl ItemActivityEvent {
    /// A review event: the user rated the item and got a new interval back.
    pub fn review(
        item_type: ActivityItemType,
        item_id: String,
        surface: ActivitySurface,
        active_seconds: i64,
        rating: i32,
        resulting_interval_days: f64,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            item_type,
            item_id,
            surface,
            started_at: now - chrono::Duration::seconds(active_seconds.max(0)),
            ended_at: Some(now),
            active_seconds: active_seconds.max(0),
            rating: Some(rating),
            resulting_interval_days: Some(resulting_interval_days),
            progress_start: None,
            progress_end: None,
        }
    }

    /// Attach a reading-progress delta. Documents record it; extracts do not.
    pub fn with_progress(mut self, start: Option<f64>, end: Option<f64>) -> Self {
        self.progress_start = start;
        self.progress_end = end;
        self
    }

    /// The reading-progress delta for this interaction, when both ends are known.
    pub fn progress_delta(&self) -> Option<f64> {
        match (self.progress_start, self.progress_end) {
            (Some(start), Some(end)) => Some(end - start),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn item_type_and_surface_round_trip_through_their_stored_strings() {
        for item_type in [ActivityItemType::Document, ActivityItemType::Extract] {
            assert_eq!(
                ActivityItemType::from_str(item_type.as_str()),
                Some(item_type)
            );
        }
        for surface in [ActivitySurface::Queue, ActivitySurface::Reader] {
            assert_eq!(ActivitySurface::from_str(surface.as_str()), Some(surface));
        }
        assert_eq!(ActivityItemType::from_str("flashcard"), None);
        assert_eq!(ActivitySurface::from_str("studio"), None);
    }

    #[test]
    fn review_event_spans_exactly_its_active_seconds() {
        let event = ItemActivityEvent::review(
            ActivityItemType::Extract,
            "ext-1".to_string(),
            ActivitySurface::Queue,
            45,
            3,
            2.5,
        );

        assert_eq!(event.active_seconds, 45);
        assert_eq!(event.rating, Some(3));
        assert_eq!(event.resulting_interval_days, Some(2.5));
        let ended = event.ended_at.expect("review events are closed");
        assert_eq!(
            ended.signed_duration_since(event.started_at).num_seconds(),
            45
        );
    }

    #[test]
    fn progress_delta_needs_both_ends() {
        let event = ItemActivityEvent::review(
            ActivityItemType::Document,
            "doc-1".to_string(),
            ActivitySurface::Queue,
            10,
            3,
            1.0,
        );
        assert_eq!(event.progress_delta(), None);

        let with_both = event.clone().with_progress(Some(10.0), Some(42.5));
        assert_eq!(with_both.progress_delta(), Some(32.5));

        let with_one = event.with_progress(Some(10.0), None);
        assert_eq!(with_one.progress_delta(), None);
    }

    #[test]
    fn serialises_with_camel_case_field_names() {
        let event = ItemActivityEvent::review(
            ActivityItemType::Document,
            "doc-1".to_string(),
            ActivitySurface::Reader,
            30,
            4,
            7.0,
        );
        let json = serde_json::to_value(&event).expect("serialise");

        assert!(json.get("itemType").is_some());
        assert!(json.get("activeSeconds").is_some());
        assert!(json.get("resultingIntervalDays").is_some());
        assert_eq!(json["itemType"], "document");
        assert_eq!(json["surface"], "reader");
    }
}
