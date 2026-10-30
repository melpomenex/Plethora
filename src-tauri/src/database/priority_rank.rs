//! Priority as a *position* in one global queue.
//!
//! Plethora does not store raw static importance. It keeps every element in a
//! single sorted priority queue and derives the displayed percentage from the
//! element's position in the active queue. Two elements never share a slot, and a
//! percentage means "this far into the collection *right now*" — so it drifts
//! dynamically as the collection grows.
//!
//! We achieve continuous rank semantics without renumbering rows on every edit:
//!
//! * `priority_score REAL` (already on documents / extracts / learning_items)
//!   acts as an **order key**, not an importance value. Its absolute magnitude
//!   is meaningless; only its relative rank matters.
//! * Setting the slider to X% resolves to the rank X% of the way up the queue
//!   and stores the **midpoint of that gap** — one row written, order preserved,
//!   nothing else renumbered.
//! * The percentage the UI shows is computed from rank at read time
//!   ([`percentile_for_score`]), never from the stored number.
//!
//! Direction convention: the order key ascends with importance (higher score =
//! more important), matching the slider and every consumer of `priority_score`.
//! The queue display position converts so that position 1 represents the highest
//! priority element.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sqlx::{Pool, Row, Sqlite};

use crate::error::Result;

/// The queue is every element that can actually be presented. Each table
/// expresses "not presentable" differently: documents have archived and
/// dismissed, extracts only dismissed, cards only suspended.
const QUEUE_ELEMENTS: &str = "
    SELECT priority_score FROM documents      WHERE is_archived = 0 AND is_dismissed = 0
    UNION ALL
    SELECT priority_score FROM extracts       WHERE is_dismissed = 0
    UNION ALL
    SELECT priority_score FROM learning_items WHERE is_suspended = 0
";

/// Order keys live in `[0, 100]` so existing consumers that treat
/// `priority_score / 100.0` as a weight keep working unchanged.
const KEY_MIN: f64 = 0.0;
const KEY_MAX: f64 = 100.0;

/// Below this the midpoint of a gap is no longer distinct from its endpoints
/// at f64 precision near 100.0.
const MIN_GAP: f64 = 1e-9;

/// Order key for an element inserted between two neighbours.
///
/// `below` / `above` are the keys of the elements that should sort immediately
/// under and over the new one; `None` means "no such neighbour" (inserting at
/// an end of the queue, or into an empty queue).
///
/// ponytail: repeated inserts into the same gap halve it each time and exhaust
/// f64 after ~50 splits, at which point new elements land on their neighbour's
/// key and tie. Upgrade path is a renumber pass (rewrite the three tables'
/// keys from `ROW_NUMBER()`) triggered when this returns a gap under `MIN_GAP`.
pub fn key_between(below: Option<f64>, above: Option<f64>) -> f64 {
    keys_between(below, above, 1)[0]
}

/// `count` order keys spread evenly through the gap, in ascending order.
///
/// A bulk "set these 500 documents to 70%" is one insertion of 500 elements at
/// the same rank, not 500 insertions at the same point — spreading them keeps
/// the queue a total order and costs the gap one split instead of 500.
pub fn keys_between(below: Option<f64>, above: Option<f64>, count: usize) -> Vec<f64> {
    let count = count.max(1);
    let (lo, hi) = match (below, above) {
        (None, None) => (KEY_MIN, KEY_MAX),
        (None, Some(hi)) => (KEY_MIN, hi),
        (Some(lo), None) => (lo, KEY_MAX),
        (Some(lo), Some(hi)) => (lo, hi),
    };
    if hi - lo <= MIN_GAP {
        // Gap exhausted: sit on the lower neighbour rather than jumping the
        // elements somewhere arbitrary. Order is now ambiguous for this run.
        return vec![lo; count];
    }
    let step = (hi - lo) / (count + 1) as f64;
    (1..=count).map(|i| lo + step * i as f64).collect()
}

/// How many elements must sort *below* an element the user set to `slider`%.
///
/// Slider 0 → bottom of the queue (nothing below it), 100 → top. This is the
/// inverse of [`percentile_for_rank`].
pub fn rank_for_slider(slider: i32, size: usize) -> usize {
    let fraction = slider.clamp(0, 100) as f64 / 100.0;
    (fraction * size as f64).round() as usize
}

/// The percentage to display for an element with `rank` elements below it.
/// Higher = more important, matching the slider.
pub fn percentile_for_rank(rank: usize, size: usize) -> f64 {
    if size <= 1 {
        return 50.0;
    }
    (rank.min(size - 1) as f64 / (size - 1) as f64) * 100.0
}

/// The 1-based queue position to display: position 1 is the most
/// important element.
pub fn position_for_rank(rank: usize, size: usize) -> usize {
    size.saturating_sub(rank).max(1)
}

/// Total number of elements in the priority queue.
pub async fn queue_size(pool: &Pool<Sqlite>) -> Result<usize> {
    let row = sqlx::query(&format!("SELECT COUNT(*) AS n FROM ({QUEUE_ELEMENTS})"))
        .fetch_one(pool)
        .await?;
    Ok(row.get::<i64, _>("n").max(0) as usize)
}

/// The order key at 0-based index `n` in ascending order, or `None` past the end.
async fn key_at(pool: &Pool<Sqlite>, n: usize) -> Result<Option<f64>> {
    let row = sqlx::query(&format!(
        "SELECT priority_score AS k FROM ({QUEUE_ELEMENTS}) ORDER BY priority_score LIMIT 1 OFFSET ?1"
    ))
    .bind(n as i64)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.get::<f64, _>("k")))
}

/// Resolve a 0-100 slider into a stored order key: find the gap at the
/// corresponding rank and return its midpoint.
///
/// The element being moved is still in the queue while we measure it. That
/// costs at most one rank of drift on a re-set of the same element, which is
/// invisible at any real collection size and not worth a self-exclusion clause
/// on three unioned tables.
pub async fn key_for_slider(pool: &Pool<Sqlite>, slider: i32) -> Result<f64> {
    Ok(keys_for_slider(pool, slider, 1).await?[0])
}

/// [`key_for_slider`] for a batch: `count` keys at the same rank, spread so
/// they stay distinct and in a stable order.
pub async fn keys_for_slider(pool: &Pool<Sqlite>, slider: i32, count: usize) -> Result<Vec<f64>> {
    let size = queue_size(pool).await?;
    let rank = rank_for_slider(slider, size);
    let below = if rank == 0 {
        None
    } else {
        key_at(pool, rank - 1).await?
    };
    let above = key_at(pool, rank).await?;
    Ok(keys_between(below, above, count))
}

/// The stored order key of any queue element, whichever table it lives in.
pub async fn key_of_element(pool: &Pool<Sqlite>, id: &str) -> Result<Option<f64>> {
    let row = sqlx::query(
        "SELECT priority_score AS k FROM documents      WHERE id = ?1
         UNION ALL
         SELECT priority_score AS k FROM extracts       WHERE id = ?1
         UNION ALL
         SELECT priority_score AS k FROM learning_items WHERE id = ?1
         LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.get::<f64, _>("k")))
}

/// What the UI should show for an element whose stored key is `score`:
/// `(percentile, position, queue_size)`.
pub async fn percentile_for_score(pool: &Pool<Sqlite>, score: f64) -> Result<(f64, usize, usize)> {
    let size = queue_size(pool).await?;
    let row = sqlx::query(&format!(
        "SELECT COUNT(*) AS n FROM ({QUEUE_ELEMENTS}) WHERE priority_score < ?1"
    ))
    .bind(score)
    .fetch_one(pool)
    .await?;
    let rank = row.get::<i64, _>("n").max(0) as usize;
    Ok((
        percentile_for_rank(rank, size),
        position_for_rank(rank, size),
        size,
    ))
}

/// Canonical normalized `[0.0, 1.0]` signal accompanied by measurement provenance.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalSignal {
    pub value: f64,
    pub available: bool,
    pub defaulted: bool,
}

impl CanonicalSignal {
    pub const fn measured(value: f64) -> Self {
        Self {
            value,
            available: true,
            defaulted: false,
        }
    }

    pub const fn defaulted_value(value: f64) -> Self {
        Self {
            value,
            available: true,
            defaulted: true,
        }
    }

    pub const fn neutral_unavailable() -> Self {
        Self {
            value: 0.5,
            available: false,
            defaulted: true,
        }
    }
}

/// Concrete presentable entity table participating in global positional priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PriorityEntityKind {
    Document,
    Extract,
    LearningItem,
}

/// Raw presentable row loaded by [`PriorityPopulationSnapshot::load`].
#[derive(Debug, Clone)]
pub struct PopulationRow {
    pub kind: PriorityEntityKind,
    pub id: String,
    pub priority_score: f64,
    pub priority_slider: i32,
    pub priority_rating: i32,
    pub priority_explicitly_set: bool,
    pub parent_priority_score: Option<f64>,
    pub parent_priority_slider: Option<i32>,
    pub parent_priority_rating: Option<i32>,
    pub parent_explicitly_set: Option<bool>,
}

#[derive(Debug, Clone, Copy)]
enum ResolvedOrderKey {
    Valid { key: f64, defaulted: bool },
    MissingOrInvalid,
}

const SNAPSHOT_POPULATION_SQL: &str = "
    SELECT 'document' AS kind,
           d.id AS id,
           d.priority_score AS priority_score,
           d.priority_slider AS priority_slider,
           d.priority_rating AS priority_rating,
           d.priority_explicitly_set AS priority_explicitly_set,
           NULL AS parent_priority_score,
           NULL AS parent_priority_slider,
           NULL AS parent_priority_rating,
           NULL AS parent_explicitly_set
    FROM documents d
    WHERE d.is_archived = 0 AND d.is_dismissed = 0
    UNION ALL
    SELECT 'extract' AS kind,
           e.id AS id,
           e.priority_score AS priority_score,
           0 AS priority_slider,
           0 AS priority_rating,
           0 AS priority_explicitly_set,
           d.priority_score AS parent_priority_score,
           d.priority_slider AS parent_priority_slider,
           d.priority_rating AS parent_priority_rating,
           d.priority_explicitly_set AS parent_explicitly_set
    FROM extracts e
    LEFT JOIN documents d ON d.id = e.document_id
    WHERE e.is_dismissed = 0
    UNION ALL
    SELECT 'learning-item' AS kind,
           li.id AS id,
           li.priority_score AS priority_score,
           li.priority_slider AS priority_slider,
           0 AS priority_rating,
           li.priority_explicitly_set AS priority_explicitly_set,
           NULL AS parent_priority_score,
           NULL AS parent_priority_slider,
           NULL AS parent_priority_rating,
           NULL AS parent_explicitly_set
    FROM learning_items li
    WHERE li.is_suspended = 0
";

fn legacy_rating_key(rating: i32) -> Option<f64> {
    if (1..=5).contains(&rating) {
        Some(crate::algorithms::resolve_priority_slider(0, rating) as f64)
    } else {
        None
    }
}

fn resolve_direct_key(score: f64, slider: i32, rating: i32, explicit: bool) -> ResolvedOrderKey {
    if !score.is_finite() || score < 0.0 {
        return ResolvedOrderKey::MissingOrInvalid;
    }
    if score > 0.0 {
        return ResolvedOrderKey::Valid {
            key: score,
            defaulted: false,
        };
    }
    if explicit {
        if slider <= 0 {
            return ResolvedOrderKey::Valid {
                key: 0.0,
                defaulted: false,
            };
        }
        return ResolvedOrderKey::Valid {
            key: crate::algorithms::calculate_document_priority_score(Some(rating), slider),
            defaulted: true,
        };
    }
    if slider > 0 {
        return ResolvedOrderKey::Valid {
            key: crate::algorithms::calculate_document_priority_score(Some(rating), slider),
            defaulted: true,
        };
    }
    if let Some(fallback) = legacy_rating_key(rating) {
        return ResolvedOrderKey::Valid {
            key: fallback,
            defaulted: true,
        };
    }
    ResolvedOrderKey::MissingOrInvalid
}

fn resolve_extract_key(row: &PopulationRow) -> ResolvedOrderKey {
    if !row.priority_score.is_finite() || row.priority_score < 0.0 {
        return ResolvedOrderKey::MissingOrInvalid;
    }
    if row.priority_score > 0.0 {
        return ResolvedOrderKey::Valid {
            key: row.priority_score,
            defaulted: false,
        };
    }
    let parent_explicit = row.parent_explicitly_set.unwrap_or(false);
    let parent_score = row.parent_priority_score.unwrap_or(0.0);
    if parent_score.is_finite() && parent_score > 0.0 {
        return ResolvedOrderKey::Valid {
            key: parent_score,
            defaulted: false,
        };
    }
    if parent_explicit {
        return ResolvedOrderKey::Valid {
            key: 0.0,
            defaulted: false,
        };
    }
    let parent_slider = row.parent_priority_slider.unwrap_or(0);
    let parent_rating = row.parent_priority_rating.unwrap_or(0);
    if parent_slider > 0 {
        return ResolvedOrderKey::Valid {
            key: crate::algorithms::calculate_document_priority_score(
                Some(parent_rating),
                parent_slider,
            ),
            defaulted: true,
        };
    }
    if let Some(fallback) = legacy_rating_key(parent_rating) {
        return ResolvedOrderKey::Valid {
            key: fallback,
            defaulted: true,
        };
    }
    ResolvedOrderKey::MissingOrInvalid
}

fn resolve_row_key(row: &PopulationRow) -> ResolvedOrderKey {
    match row.kind {
        PriorityEntityKind::Extract => resolve_extract_key(row),
        PriorityEntityKind::Document | PriorityEntityKind::LearningItem => resolve_direct_key(
            row.priority_score,
            row.priority_slider,
            row.priority_rating,
            row.priority_explicitly_set,
        ),
    }
}

/// Normalize a valid order key `key` against `sorted_keys` (`P = b / (N - 1)` for `N > 1`, `0.5` for `N <= 1`).
pub fn positional_priority_from_sorted_keys(sorted_keys: &[f64], key: f64) -> f64 {
    if !key.is_finite() || sorted_keys.len() <= 1 {
        return 0.5;
    }
    let strictly_below = sorted_keys.partition_point(|&candidate| candidate.total_cmp(&key).is_lt());
    ((strictly_below as f64) / ((sorted_keys.len() - 1) as f64)).clamp(0.0, 1.0)
}

/// Adapt legacy `1..=10` playlist subscription priority to canonical `[0.0, 1.0]` (`(r - 1) / 9`).
pub fn playlist_subscription_priority(priority_rating: i32) -> CanonicalSignal {
    if (1..=10).contains(&priority_rating) {
        CanonicalSignal::measured(((priority_rating - 1) as f64) / 9.0)
    } else {
        CanonicalSignal::neutral_unavailable()
    }
}

/// Batch-loaded global priority population snapshot (D1).
///
/// Loaded once per ranking pass across all active presentable elements before
/// session/due/search/type filtering so `P` never drifts when filters change.
#[derive(Debug, Clone, Default)]
pub struct PriorityPopulationSnapshot {
    sorted_keys: Vec<f64>,
    by_element: HashMap<(PriorityEntityKind, String), CanonicalSignal>,
    by_document: HashMap<String, CanonicalSignal>,
}

impl PriorityPopulationSnapshot {
    /// Load all presentable elements from SQLite in a single query.
    pub async fn load(pool: &Pool<Sqlite>) -> Result<Self> {
        let raw_rows = sqlx::query(SNAPSHOT_POPULATION_SQL).fetch_all(pool).await?;
        let mut rows = Vec::with_capacity(raw_rows.len());
        for row in raw_rows {
            let kind_str: String = row.get("kind");
            let kind = match kind_str.as_str() {
                "document" => PriorityEntityKind::Document,
                "extract" => PriorityEntityKind::Extract,
                _ => PriorityEntityKind::LearningItem,
            };
            rows.push(PopulationRow {
                kind,
                id: row.get("id"),
                priority_score: row.try_get::<f64, _>("priority_score").unwrap_or(f64::NAN),
                priority_slider: row.try_get::<i32, _>("priority_slider").unwrap_or(0),
                priority_rating: row.try_get::<i32, _>("priority_rating").unwrap_or(0),
                priority_explicitly_set: row
                    .try_get::<i64, _>("priority_explicitly_set")
                    .unwrap_or(0)
                    != 0,
                parent_priority_score: row.try_get::<Option<f64>, _>("parent_priority_score").ok().flatten(),
                parent_priority_slider: row.try_get::<Option<i32>, _>("parent_priority_slider").ok().flatten(),
                parent_priority_rating: row.try_get::<Option<i32>, _>("parent_priority_rating").ok().flatten(),
                parent_explicitly_set: row
                    .try_get::<Option<i64>, _>("parent_explicitly_set")
                    .ok()
                    .flatten()
                    .map(|v| v != 0),
            });
        }
        Ok(Self::from_rows(rows))
    }

    /// Pure deterministic snapshot builder over preloaded rows.
    pub fn from_rows(rows: Vec<PopulationRow>) -> Self {
        let mut resolved = Vec::with_capacity(rows.len());
        let mut sorted_keys = Vec::with_capacity(rows.len());
        for row in rows {
            let outcome = resolve_row_key(&row);
            if let ResolvedOrderKey::Valid { key, .. } = outcome {
                sorted_keys.push(key);
            }
            resolved.push((row.kind, row.id, outcome));
        }
        sorted_keys.sort_by(f64::total_cmp);

        let mut by_element = HashMap::with_capacity(resolved.len());
        let mut by_document = HashMap::new();
        for (kind, id, outcome) in resolved {
            let signal = match outcome {
                ResolvedOrderKey::Valid { key, defaulted } => {
                    let value = positional_priority_from_sorted_keys(&sorted_keys, key);
                    if defaulted {
                        CanonicalSignal::defaulted_value(value)
                    } else {
                        CanonicalSignal::measured(value)
                    }
                }
                ResolvedOrderKey::MissingOrInvalid => CanonicalSignal::neutral_unavailable(),
            };
            if kind == PriorityEntityKind::Document {
                by_document.insert(id.clone(), signal);
            }
            by_element.insert((kind, id), signal);
        }

        Self {
            sorted_keys,
            by_element,
            by_document,
        }
    }

    pub fn valid_population_size(&self) -> usize {
        self.sorted_keys.len()
    }

    pub fn signal_for(&self, kind: PriorityEntityKind, id: &str) -> CanonicalSignal {
        self.by_element
            .get(&(kind, id.to_string()))
            .copied()
            .unwrap_or_else(CanonicalSignal::neutral_unavailable)
    }

    pub fn document_signal(&self, doc_id: &str) -> CanonicalSignal {
        self.signal_for(PriorityEntityKind::Document, doc_id)
    }

    pub fn extract_signal(&self, extract_id: &str) -> CanonicalSignal {
        self.signal_for(PriorityEntityKind::Extract, extract_id)
    }

    pub fn learning_item_signal(&self, card_id: &str) -> CanonicalSignal {
        self.signal_for(PriorityEntityKind::LearningItem, card_id)
    }

    /// Parent-document inheritance for video extracts and audio editions (D1).
    pub fn inherited_document_signal(&self, parent_doc_id: &str) -> CanonicalSignal {
        match self.by_document.get(parent_doc_id) {
            Some(parent) if parent.available => CanonicalSignal::defaulted_value(parent.value),
            _ => CanonicalSignal::neutral_unavailable(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn seeded_pool(keys: &[f64]) -> Pool<Sqlite> {
        let db = crate::database::connection::Database::new(std::path::PathBuf::from(":memory:"))
            .await
            .expect("db");
        db.migrate().await.expect("migrate");
        let pool = db.pool().clone();
        let now = chrono::Utc::now().to_rfc3339();
        for (i, key) in keys.iter().enumerate() {
            sqlx::query(
                r#"INSERT INTO documents (id, collection_id, title, file_path, file_type, tags,
                       date_added, date_modified, extract_count, learning_item_count,
                       priority_rating, priority_slider, priority_score,
                       is_archived, is_favorite, is_dismissed)
                   VALUES (?1, 'default', 't', '/t.pdf', 'pdf', '[]', ?2, ?2, 0, 0, 0, 50, ?3, 0, 0, 0)"#,
            )
            .bind(format!("doc{i}"))
            .bind(&now)
            .bind(key)
            .execute(&pool)
            .await
            .expect("seed");
        }
        pool
    }

    #[tokio::test]
    async fn slider_lands_the_element_at_the_matching_rank() {
        // Five elements already spaced 10..50. The SQL is built as a string,
        // so only running it validates the column names and the ordering.
        let pool = seeded_pool(&[10.0, 20.0, 30.0, 40.0, 50.0]).await;
        assert_eq!(queue_size(&pool).await.unwrap(), 5);

        let top = key_for_slider(&pool, 100).await.unwrap();
        assert!(
            top > 50.0,
            "slider 100 must sort above everything, got {top}"
        );

        let bottom = key_for_slider(&pool, 0).await.unwrap();
        assert!(
            bottom < 10.0,
            "slider 0 must sort below everything, got {bottom}"
        );

        let middle = key_for_slider(&pool, 50).await.unwrap();
        assert!(
            (30.0..40.0).contains(&middle),
            "slider 50 must land mid-queue, got {middle}"
        );
    }

    #[tokio::test]
    async fn stored_key_reads_back_as_the_slider_that_set_it() {
        // The round trip that matters: what the user set is what the UI shows,
        // even though nothing stores the percentage.
        let existing: Vec<f64> = (0..99).map(|i| i as f64).collect();
        let pool = seeded_pool(&existing).await;
        let now = chrono::Utc::now().to_rfc3339();

        for (n, slider) in [0, 25, 50, 75, 100].into_iter().enumerate() {
            // Resolve the slider, then actually store it — the readout is
            // rank-based, so it only means anything once the element is in the
            // queue it is being ranked against.
            let key = key_for_slider(&pool, slider).await.unwrap();
            sqlx::query(
                r#"INSERT INTO documents (id, collection_id, title, file_path, file_type, tags,
                       date_added, date_modified, extract_count, learning_item_count,
                       priority_rating, priority_slider, priority_score,
                       is_archived, is_favorite, is_dismissed)
                   VALUES (?1, 'default', 't', '/t.pdf', 'pdf', '[]', ?2, ?2, 0, 0, 0, ?3, ?4, 0, 0, 0)"#,
            )
            .bind(format!("set{n}"))
            .bind(&now)
            .bind(slider)
            .bind(key)
            .execute(&pool)
            .await
            .expect("store");

            let (percentile, position, size) = percentile_for_score(&pool, key).await.unwrap();
            assert!(
                (percentile - slider as f64).abs() <= 2.0,
                "set {slider}% but reads back {percentile}% (position {position} of {size})"
            );
        }
    }

    #[tokio::test]
    async fn percentile_is_relative_so_it_drifts_as_the_collection_grows() {
        // The whole point of the model: an unchanged element's percentage
        // moves when the collection around it changes.
        let small = seeded_pool(&[10.0, 20.0, 30.0]).await;
        let (before, _, _) = percentile_for_score(&small, 30.0).await.unwrap();

        let now = chrono::Utc::now().to_rfc3339();
        for i in 0..6 {
            sqlx::query(
                r#"INSERT INTO documents (id, collection_id, title, file_path, file_type, tags,
                       date_added, date_modified, extract_count, learning_item_count,
                       priority_rating, priority_slider, priority_score,
                       is_archived, is_favorite, is_dismissed)
                   VALUES (?1, 'default', 't', '/t.pdf', 'pdf', '[]', ?2, ?2, 0, 0, 0, 50, ?3, 0, 0, 0)"#,
            )
            .bind(format!("newer{i}"))
            .bind(&now)
            .bind(40.0 + i as f64)
            .execute(&small)
            .await
            .expect("seed");
        }
        let (after, _, _) = percentile_for_score(&small, 30.0).await.unwrap();
        assert!(
            after < before,
            "adding higher-priority elements must push this one down ({before}% -> {after}%)"
        );
    }

    #[test]
    fn key_between_splits_the_gap() {
        assert_eq!(key_between(Some(10.0), Some(20.0)), 15.0);
        assert_eq!(key_between(None, Some(20.0)), 10.0);
        assert_eq!(key_between(Some(80.0), None), 90.0);
        assert_eq!(key_between(None, None), 50.0);
    }

    #[test]
    fn key_between_stays_inside_the_key_range() {
        for (lo, hi) in [(None, None), (None, Some(0.0)), (Some(100.0), None)] {
            let k = key_between(lo, hi);
            assert!((KEY_MIN..=KEY_MAX).contains(&k), "{k} out of range");
        }
    }

    #[test]
    fn bulk_keys_are_distinct_and_ordered_inside_the_gap() {
        let keys = keys_between(Some(10.0), Some(20.0), 500);
        assert_eq!(keys.len(), 500);
        for pair in keys.windows(2) {
            assert!(pair[0] < pair[1], "keys must be strictly ascending");
        }
        assert!(
            keys[0] > 10.0 && keys[499] < 20.0,
            "keys must stay in the gap"
        );
    }

    #[test]
    fn key_between_gives_up_cleanly_when_the_gap_is_exhausted() {
        // No panic, no NaN, no jumping outside the neighbours.
        let k = key_between(Some(50.0), Some(50.0 + MIN_GAP / 2.0));
        assert_eq!(k, 50.0);
    }

    #[test]
    fn slider_maps_to_the_ends_of_the_queue() {
        assert_eq!(rank_for_slider(0, 200), 0); // nothing below it
        assert_eq!(rank_for_slider(100, 200), 200); // everything below it
        assert_eq!(rank_for_slider(50, 200), 100);
    }

    #[test]
    fn slider_and_percentile_round_trip() {
        let size = 101;
        for slider in [0, 25, 50, 75, 100] {
            let rank = rank_for_slider(slider, size - 1);
            let shown = percentile_for_rank(rank, size);
            assert!(
                (shown - slider as f64).abs() < 1.0,
                "slider {slider} displayed back as {shown}"
            );
        }
    }

    #[test]
    fn position_one_is_the_most_important() {
        assert_eq!(position_for_rank(99, 100), 1); // 99 below it => top
        assert_eq!(position_for_rank(0, 100), 100); // nothing below => bottom
    }

    #[test]
    fn single_element_queue_is_neutral_not_zero() {
        assert_eq!(percentile_for_rank(0, 1), 50.0);
        assert_eq!(position_for_rank(0, 1), 1);
    }

    #[test]
    fn test_positional_priority_from_sorted_keys_direction_ties_singleton() {
        // Singleton and empty
        assert_eq!(positional_priority_from_sorted_keys(&[42.0], 42.0), 0.5);
        assert_eq!(positional_priority_from_sorted_keys(&[], 42.0), 0.5);

        // 5 items: 0.0, 25.0, 50.0, 75.0, 100.0
        let sorted = vec![0.0, 25.0, 50.0, 75.0, 100.0];
        // 0 strictly below: 0/(5-1) = 0.0
        assert_eq!(positional_priority_from_sorted_keys(&sorted, 0.0), 0.0);
        // 1 strictly below: 1/4 = 0.25
        assert_eq!(positional_priority_from_sorted_keys(&sorted, 25.0), 0.25);
        // 2 strictly below: 2/4 = 0.50
        assert_eq!(positional_priority_from_sorted_keys(&sorted, 50.0), 0.50);
        // 3 strictly below: 3/4 = 0.75
        assert_eq!(positional_priority_from_sorted_keys(&sorted, 75.0), 0.75);
        // 4 strictly below: 4/4 = 1.00
        assert_eq!(positional_priority_from_sorted_keys(&sorted, 100.0), 1.00);

        // Ties: equal keys get equal strictly_below count
        let tied = vec![10.0, 20.0, 20.0, 30.0];
        // For key 20.0: strictly below is 1 (only 10.0 is < 20.0). N=4 => 1/3
        assert_eq!(positional_priority_from_sorted_keys(&tied, 20.0), 1.0 / 3.0);
    }

    #[test]
    fn test_playlist_subscription_priority_adaptation() {
        // 1..=10 adapted to (r-1)/9
        let p1 = playlist_subscription_priority(1);
        assert!(p1.available);
        assert!(!p1.defaulted);
        assert_eq!(p1.value, 0.0);

        let p10 = playlist_subscription_priority(10);
        assert!(p10.available);
        assert_eq!(p10.value, 1.0);

        let p5 = playlist_subscription_priority(5);
        assert!(p5.available);
        assert_eq!(p5.value, 4.0 / 9.0);

        // Invalid: 0 or >10
        let p0 = playlist_subscription_priority(0);
        assert!(!p0.available);
        assert!(p0.defaulted);
        assert_eq!(p0.value, 0.5);

        let p11 = playlist_subscription_priority(11);
        assert!(!p11.available);
        assert_eq!(p11.value, 0.5);
    }

    #[test]
    fn test_population_snapshot_rows_resolution_and_inheritance() {
        let rows = vec![
            // Document 1 with score 80
            PopulationRow {
                kind: PriorityEntityKind::Document,
                id: "doc1".to_string(),
                priority_score: 80.0,
                priority_slider: 80,
                priority_rating: 4,
                priority_explicitly_set: true,
                parent_priority_score: None,
                parent_priority_slider: None,
                parent_priority_rating: None,
                parent_explicitly_set: None,
            },
            // Document 2 explicit zero
            PopulationRow {
                kind: PriorityEntityKind::Document,
                id: "doc2".to_string(),
                priority_score: 0.0,
                priority_slider: 0,
                priority_rating: 0,
                priority_explicitly_set: true,
                parent_priority_score: None,
                parent_priority_slider: None,
                parent_priority_rating: None,
                parent_explicitly_set: None,
            },
            // Extract following doc1 (inherits 80.0)
            PopulationRow {
                kind: PriorityEntityKind::Extract,
                id: "ext1".to_string(),
                priority_score: 0.0,
                priority_slider: 0,
                priority_rating: 0,
                priority_explicitly_set: false,
                parent_priority_score: Some(80.0),
                parent_priority_slider: Some(80),
                parent_priority_rating: Some(4),
                parent_explicitly_set: Some(true),
            },
            // Extract reprioritized on its own with score 50.0
            PopulationRow {
                kind: PriorityEntityKind::Extract,
                id: "ext2".to_string(),
                priority_score: 50.0,
                priority_slider: 0,
                priority_rating: 0,
                priority_explicitly_set: false,
                parent_priority_score: Some(80.0),
                parent_priority_slider: Some(80),
                parent_priority_rating: Some(4),
                parent_explicitly_set: Some(true),
            },
            // Legacy row with invalid NaN score and no slider/rating
            PopulationRow {
                kind: PriorityEntityKind::Document,
                id: "doc_invalid".to_string(),
                priority_score: f64::NAN,
                priority_slider: 0,
                priority_rating: 0,
                priority_explicitly_set: false,
                parent_priority_score: None,
                parent_priority_slider: None,
                parent_priority_rating: None,
                parent_explicitly_set: None,
            },
        ];

        let snapshot = PriorityPopulationSnapshot::from_rows(rows);
        // Valid population items: doc1 (80), doc2 (0), ext1 (80), ext2 (50). Total 4 valid.
        assert_eq!(snapshot.valid_population_size(), 4);

        // doc2 (score 0.0): 0 strictly below out of 4-1=3 => P = 0.0
        let doc2_sig = snapshot.document_signal("doc2");
        assert!(doc2_sig.available);
        assert!(!doc2_sig.defaulted);
        assert_eq!(doc2_sig.value, 0.0);

        // ext2 (score 50.0): 1 strictly below (doc2) => 1/3
        let ext2_sig = snapshot.extract_signal("ext2");
        assert!(ext2_sig.available);
        assert_eq!(ext2_sig.value, 1.0 / 3.0);

        // doc1 and ext1 (both 80.0): 2 strictly below (doc2 and ext2) => 2/3
        let doc1_sig = snapshot.document_signal("doc1");
        let ext1_sig = snapshot.extract_signal("ext1");
        assert_eq!(doc1_sig.value, 2.0 / 3.0);
        assert_eq!(ext1_sig.value, 2.0 / 3.0);

        // Invalid row gets neutral unavailable 0.5
        let invalid_sig = snapshot.document_signal("doc_invalid");
        assert!(!invalid_sig.available);
        assert!(invalid_sig.defaulted);
        assert_eq!(invalid_sig.value, 0.5);

        // Video extract parent inheritance
        let video_inherited = snapshot.inherited_document_signal("doc1");
        assert!(video_inherited.available);
        assert!(video_inherited.defaulted);
        assert_eq!(video_inherited.value, 2.0 / 3.0);

        let video_missing_parent = snapshot.inherited_document_signal("nonexistent");
        assert!(!video_missing_parent.available);
        assert_eq!(video_missing_parent.value, 0.5);
    }
}
