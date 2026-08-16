//! Per-item statistics payloads.
//!
//! The shape here exists to make one distinction the UI cannot make on its
//! own: a metric that is genuinely `0`, a metric that has no value because the
//! item predates tracking, and a metric that does not apply to this item type
//! at all. Sending a bare `null` for all three would collapse them, and the
//! surface is specified to say *why* a value is missing.

use serde::{Deserialize, Serialize};

/// The item types the statistics surfaces support. The wire values match the
/// frontend's existing `ItemDetailsTarget` discriminants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StatsItemType {
    Document,
    Extract,
    LearningItem,
    Rss,
}

impl StatsItemType {
    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            "document" => Some(StatsItemType::Document),
            "extract" => Some(StatsItemType::Extract),
            "learning-item" => Some(StatsItemType::LearningItem),
            "rss" => Some(StatsItemType::Rss),
            _ => None,
        }
    }
}

/// One metric and the reason it does or does not have a value.
///
/// Serialises as `{"state":"value","value":…}`, `{"state":"untracked"}`, or
/// `{"state":"notApplicable"}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Metric<T> {
    /// A real value — including a genuine zero.
    Value { value: T },
    /// This metric applies, but nothing was ever recorded for it. Rendered as
    /// an explicit "not recorded" note, never as `0`.
    Untracked,
    /// This metric does not exist for this item type. Omitted from the render.
    NotApplicable,
}

impl<T> Metric<T> {
    pub fn value(value: T) -> Self {
        Metric::Value { value }
    }

    /// Lift an `Option` into a metric that applies to this item type: `Some`
    /// becomes a real value, `None` becomes `untracked`.
    pub fn tracked(value: Option<T>) -> Self {
        match value {
            Some(value) => Metric::Value { value },
            None => Metric::Untracked,
        }
    }

    pub fn as_value(&self) -> Option<&T> {
        match self {
            Metric::Value { value } => Some(value),
            _ => None,
        }
    }

    pub fn is_untracked(&self) -> bool {
        matches!(self, Metric::Untracked)
    }

    pub fn is_not_applicable(&self) -> bool {
        matches!(self, Metric::NotApplicable)
    }
}

/// The ≤6 values the Details popover shows above the scheduling grid.
/// Built from indexed lookups only so opening the popover stays fast.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStatsSummary {
    pub item_type: StatsItemType,
    pub item_id: String,
    pub total_active_seconds: Metric<i64>,
    /// Repetitions for reviewable items, sessions for reading.
    pub repetitions: Metric<i64>,
    pub average_seconds_per_repetition: Metric<i64>,
    pub first_interaction_at: Metric<String>,
    pub last_interaction_at: Metric<String>,
}

/// One entry on the item's timeline, normalised across its sources so the UI
/// never branches per item type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStatsEvent {
    /// RFC3339. The moment the interaction ended.
    pub at: String,
    pub active_seconds: Option<i64>,
    /// `queue`, `reader`, or `review` (a flashcard repetition).
    pub surface: String,
    pub rating: Option<i32>,
    pub resulting_interval_days: Option<f64>,
    pub progress_delta: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTimeStats {
    pub total_active_seconds: Metric<i64>,
    pub queue_seconds: Metric<i64>,
    pub reader_seconds: Metric<i64>,
    pub session_count: Metric<i64>,
    pub longest_session_seconds: Metric<i64>,
    pub average_session_seconds: Metric<i64>,
    pub median_session_seconds: Metric<i64>,
    /// Documents only: what the content's length suggests it should take,
    /// against which the actual total can be read.
    pub estimated_reading_seconds: Metric<i64>,
}

/// A point on the interval-growth chart.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntervalPoint {
    pub repetition: i64,
    pub interval_days: f64,
}

/// A point on this item's retention curve.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPoint {
    pub day: i64,
    pub retention: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemScheduleStats {
    pub stability: Metric<f64>,
    pub difficulty: Metric<f64>,
    pub retrievability: Metric<f64>,
    pub current_interval_days: Metric<f64>,
    pub next_interval_days: Metric<f64>,
    pub due_date: Metric<String>,
    pub interval_modifier: Metric<f64>,
    pub interval_history: Vec<IntervalPoint>,
    pub retention_curve: Vec<RetentionPoint>,
}

/// How often each rating was given, in Again/Hard/Good/Easy order.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RatingDistribution {
    pub again: i64,
    pub hard: i64,
    pub good: i64,
    pub easy: i64,
}

impl RatingDistribution {
    pub fn total(&self) -> i64 {
        self.again + self.hard + self.good + self.easy
    }

    pub fn add(&mut self, rating: i32) {
        match rating {
            1 => self.again += 1,
            2 => self.hard += 1,
            3 => self.good += 1,
            4 => self.easy += 1,
            _ => {}
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemHistoryStats {
    pub events: Vec<ItemStatsEvent>,
    pub rating_distribution: RatingDistribution,
    /// Indexes into `events` where the user rated Again — the lapses, marked
    /// on the timeline rather than only counted.
    pub lapse_positions: Vec<usize>,
    pub lapses: Metric<i64>,
    pub is_leech: bool,
    pub leech_threshold: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemContentStats {
    pub created_at: Metric<String>,
    pub first_seen_at: Metric<String>,
    pub age_days: Metric<i64>,
    pub word_count: Metric<i64>,
    pub character_count: Metric<i64>,
    pub progress_percent: Metric<f64>,
    pub extracts_yielded: Metric<i64>,
    pub flashcards_yielded: Metric<i64>,
    pub priority_score: Metric<f64>,
    pub priority_slider: Metric<i64>,
    pub category: Metric<String>,
    pub tags: Vec<String>,
}

/// Where this item sits against the others of its type, by time invested.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeInvestedRank {
    /// 1 = most time invested.
    pub rank: i64,
    pub total: i64,
}

/// Everything the full Item Statistics view needs, in one round trip.
///
/// A `None` section is one the current item type has no data for; the UI omits
/// it entirely rather than rendering it empty.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStatsDetail {
    pub summary: ItemStatsSummary,
    pub time: Option<ItemTimeStats>,
    pub schedule: Option<ItemScheduleStats>,
    pub history: Option<ItemHistoryStats>,
    pub content: Option<ItemContentStats>,
    pub rank_by_time_invested: Metric<TimeInvestedRank>,
}

/// Median of a sorted-in-place copy. Even-length inputs average the middle
/// pair, which is what "median session length" means to a reader.
pub fn median_seconds(values: &[i64]) -> Option<i64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 1 {
        Some(sorted[mid])
    } else {
        Some((sorted[mid - 1] + sorted[mid]) / 2)
    }
}

/// FSRS forgetting curve: retention after `days` at the given stability.
/// Returns an empty curve when stability is unknown or non-positive — there is
/// nothing honest to draw.
pub fn retention_curve(stability: Option<f64>, horizon_days: i64) -> Vec<RetentionPoint> {
    let Some(stability) = stability.filter(|s| *s > 0.0) else {
        return Vec::new();
    };

    (0..=horizon_days)
        .map(|day| RetentionPoint {
            day,
            retention: (1.0 + day as f64 / (9.0 * stability)).powf(-1.0),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metric_states_serialise_distinguishably() {
        let value = serde_json::to_value(Metric::value(0i64)).expect("serialise");
        assert_eq!(value["state"], "value");
        assert_eq!(value["value"], 0, "a genuine zero stays a value");

        let untracked = serde_json::to_value(Metric::<i64>::Untracked).expect("serialise");
        assert_eq!(untracked["state"], "untracked");
        assert!(untracked.get("value").is_none());

        let na = serde_json::to_value(Metric::<i64>::NotApplicable).expect("serialise");
        assert_eq!(na["state"], "notApplicable");
    }

    #[test]
    fn tracked_maps_none_to_untracked_and_zero_to_a_value() {
        assert!(Metric::tracked(None::<i64>).is_untracked());
        assert_eq!(Metric::tracked(Some(0i64)).as_value(), Some(&0));
    }

    #[test]
    fn item_type_wire_values_match_the_frontend_discriminants() {
        assert_eq!(
            StatsItemType::from_wire("learning-item"),
            Some(StatsItemType::LearningItem)
        );
        assert_eq!(StatsItemType::from_wire("rss"), Some(StatsItemType::Rss));
        assert_eq!(StatsItemType::from_wire("flashcard"), None);
        assert_eq!(
            serde_json::to_value(StatsItemType::LearningItem).expect("serialise"),
            serde_json::json!("learning-item")
        );
    }

    #[test]
    fn median_averages_the_middle_pair_on_even_input() {
        assert_eq!(median_seconds(&[]), None);
        assert_eq!(median_seconds(&[30]), Some(30));
        assert_eq!(median_seconds(&[90, 10, 50]), Some(50));
        assert_eq!(median_seconds(&[10, 20, 30, 40]), Some(25));
    }

    #[test]
    fn rating_distribution_ignores_out_of_range_ratings() {
        let mut dist = RatingDistribution::default();
        for rating in [1, 3, 3, 4, 0, 9] {
            dist.add(rating);
        }
        assert_eq!(dist.again, 1);
        assert_eq!(dist.good, 2);
        assert_eq!(dist.easy, 1);
        assert_eq!(dist.total(), 4);
    }

    #[test]
    fn retention_curve_starts_at_one_and_decays() {
        assert!(retention_curve(None, 30).is_empty());
        assert!(retention_curve(Some(0.0), 30).is_empty());

        let curve = retention_curve(Some(10.0), 30);
        assert_eq!(curve.len(), 31);
        assert!((curve[0].retention - 1.0).abs() < f64::EPSILON);
        assert!(curve[30].retention < curve[1].retention);
        assert!(curve
            .iter()
            .all(|p| p.retention > 0.0 && p.retention <= 1.0));
    }
}
