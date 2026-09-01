//! FSRS-7 review-history replay migration.
//!
//! Reconstructs dual-trace memory state (`stability`, `stability_fast`, `difficulty`)
//! from `review_results` using the vendored FSRS-7 implementation. Preserves
//! existing `due_date` values — this migration does not mass-reschedule cards.

use crate::algorithms::fsrs7::create_fsrs7;
use crate::error::{PlethoraError, Result};
use crate::models::MemoryState;
use chrono::{DateTime, Utc};
use fsrs::{FSRSItem, FSRSReview};
use sqlx::{Pool, Row, Sqlite};
use uuid::Uuid;

/// Canonical marker written to `learning_items.fsrs_implementation_version`.
pub const FSRS7_IMPLEMENTATION_VERSION: &str = "fsrs7";

/// Items processed per background batch.
pub const BATCH_SIZE: usize = 100;

/// FSRS-7 memory state reconstructed from review history.
pub type Fsrs7MemoryState = MemoryState;

/// One historical review row used for replay ordering and delta-t computation.
#[derive(Debug, Clone)]
pub struct HistoryReview {
    pub id: String,
    pub rating: u32,
    pub reviewed_at_ms: Option<i64>,
    pub timestamp: Option<DateTime<Utc>>,
}

/// Replay FSRS-7 state from chronological review history.
///
/// Reviews are sorted by `reviewed_at_ms` (falling back to `timestamp`), with
/// `id` as a deterministic tie-break. Elapsed days between reviews are
/// fractional. The first review always has `delta_t = 0`.
pub fn replay_fsrs7_from_history(
    _item_id: &str,
    reviews: &[HistoryReview],
    _desired_retention: f32,
) -> Result<Option<Fsrs7MemoryState>> {
    if reviews.is_empty() {
        return Ok(None);
    }

    let mut sorted: Vec<&HistoryReview> = reviews.iter().collect();
    sorted.sort_by(|left, right| {
        review_sort_key(left)
            .cmp(&review_sort_key(right))
            .then_with(|| left.id.cmp(&right.id))
    });

    let fsrs_reviews = build_fsrs_reviews(&sorted)?;
    if fsrs_reviews.is_empty() {
        return Ok(None);
    }

    let fsrs = create_fsrs7()?;
    let memory = fsrs
        .memory_state(FSRSItem { reviews: fsrs_reviews }, None)
        .map_err(|e| PlethoraError::Internal(format!("FSRS-7 replay failed: {e}")))?;

    Ok(Some(MemoryState {
        stability: memory.stability as f64,
        difficulty: memory.difficulty as f64,
        stability_fast: Some(memory.stability_fast as f64),
    }))
}

fn review_sort_key(review: &HistoryReview) -> i64 {
    review
        .reviewed_at_ms
        .unwrap_or_else(|| review_timestamp_ms(review.timestamp))
}

fn review_timestamp_ms(timestamp: Option<DateTime<Utc>>) -> i64 {
    timestamp
        .map(|ts| ts.timestamp_millis())
        .unwrap_or(0)
}

fn build_fsrs_reviews(sorted_reviews: &[&HistoryReview]) -> Result<Vec<FSRSReview>> {
    let mut fsrs_reviews = Vec::with_capacity(sorted_reviews.len());
    let mut previous_ms: Option<i64> = None;

    for review in sorted_reviews {
        let rating = review.rating.clamp(1, 4);
        let current_ms = review_sort_key(review);
        let delta_t = match previous_ms {
            None => 0.0,
            Some(prev_ms) => ((current_ms - prev_ms).max(0) as f64 / 86_400_000.0) as f32,
        };
        fsrs_reviews.push(FSRSReview { rating, delta_t });
        previous_ms = Some(current_ms);
    }

    Ok(fsrs_reviews)
}

/// Spawn the FSRS-7 data migration on a background task so startup stays responsive.
pub fn spawn_fsrs7_migration(pool: Pool<Sqlite>) {
    tokio::spawn(async move {
        if let Err(error) = run_fsrs7_migration(&pool).await {
            tracing::error!("FSRS-7 migration failed: {error}");
        }
    });
}

/// Idempotent FSRS-7 migration over all learning items not yet marked `fsrs7`.
pub async fn run_fsrs7_migration(pool: &Pool<Sqlite>) -> Result<()> {
    if migration_already_completed(pool).await? {
        tracing::debug!("FSRS-7 migration already completed; skipping");
        return Ok(());
    }

    let run_id = ensure_active_run(pool).await?;
    let desired_retention = load_desired_retention(pool).await?;

    let mut last_item_id: Option<String> = load_resume_cursor(pool, &run_id).await?;
    let mut items_migrated = load_items_migrated(pool, &run_id).await?;

    loop {
        let batch = fetch_pending_items(pool, last_item_id.as_deref(), BATCH_SIZE).await?;
        if batch.is_empty() {
            break;
        }

        for item_id in &batch {
            migrate_single_item(pool, item_id, desired_retention).await?;
            items_migrated += 1;
            last_item_id = Some(item_id.clone());
            update_run_progress(pool, &run_id, items_migrated, last_item_id.as_deref()).await?;
        }
    }

    mark_run_completed(pool, &run_id, items_migrated).await?;
    tracing::info!("FSRS-7 migration completed ({items_migrated} items)");
    Ok(())
}

async fn migration_already_completed(pool: &Pool<Sqlite>) -> Result<bool> {
    let completed: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM fsrs7_migration_runs WHERE status = 'completed' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?;

    Ok(completed.is_some())
}

async fn ensure_active_run(pool: &Pool<Sqlite>) -> Result<String> {
    if let Some(run_id) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM fsrs7_migration_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    {
        return Ok(run_id);
    }

    let run_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().timestamp_millis();
    sqlx::query(
        r#"
        INSERT INTO fsrs7_migration_runs (id, started_at, status, items_total, items_migrated)
        VALUES (?1, ?2, 'running', ?3, 0)
        "#,
    )
    .bind(&run_id)
    .bind(started_at)
    .bind(count_pending_items(pool).await? as i64)
    .execute(pool)
    .await
    .map_err(db_err)?;

    Ok(run_id)
}

async fn count_pending_items(pool: &Pool<Sqlite>) -> Result<usize> {
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM learning_items
        WHERE COALESCE(fsrs_implementation_version, '') != ?1
        "#,
    )
    .bind(FSRS7_IMPLEMENTATION_VERSION)
    .fetch_one(pool)
    .await
    .map_err(db_err)?;

    Ok(count as usize)
}

async fn load_resume_cursor(pool: &Pool<Sqlite>, run_id: &str) -> Result<Option<String>> {
    sqlx::query_scalar(
        "SELECT last_item_id FROM fsrs7_migration_runs WHERE id = ?1",
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await
    .map_err(db_err)
}

async fn load_items_migrated(pool: &Pool<Sqlite>, run_id: &str) -> Result<i64> {
    sqlx::query_scalar("SELECT items_migrated FROM fsrs7_migration_runs WHERE id = ?1")
        .bind(run_id)
        .fetch_one(pool)
        .await
        .map_err(db_err)
}

async fn update_run_progress(
    pool: &Pool<Sqlite>,
    run_id: &str,
    items_migrated: i64,
    last_item_id: Option<&str>,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE fsrs7_migration_runs
        SET items_migrated = ?1, last_item_id = ?2
        WHERE id = ?3
        "#,
    )
    .bind(items_migrated)
    .bind(last_item_id)
    .bind(run_id)
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok(())
}

async fn mark_run_completed(pool: &Pool<Sqlite>, run_id: &str, items_migrated: i64) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE fsrs7_migration_runs
        SET status = 'completed',
            completed_at = ?1,
            items_migrated = ?2,
            error_message = NULL
        WHERE id = ?3
        "#,
    )
    .bind(Utc::now().timestamp_millis())
    .bind(items_migrated)
    .bind(run_id)
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok(())
}

async fn load_desired_retention(pool: &Pool<Sqlite>) -> Result<f32> {
    let value: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'desired_retention' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?;

    Ok(value
        .and_then(|raw| raw.parse::<f32>().ok())
        .filter(|v| v.is_finite() && *v > 0.0 && *v < 1.0)
        .unwrap_or(0.9))
}

async fn fetch_pending_items(
    pool: &Pool<Sqlite>,
    after_item_id: Option<&str>,
    limit: usize,
) -> Result<Vec<String>> {
    let rows = if let Some(cursor) = after_item_id {
        sqlx::query(
            r#"
            SELECT id
            FROM learning_items
            WHERE COALESCE(fsrs_implementation_version, '') != ?1
              AND id > ?2
            ORDER BY id ASC
            LIMIT ?3
            "#,
        )
        .bind(FSRS7_IMPLEMENTATION_VERSION)
        .bind(cursor)
        .bind(limit as i64)
        .fetch_all(pool)
        .await
        .map_err(db_err)?
    } else {
        sqlx::query(
            r#"
            SELECT id
            FROM learning_items
            WHERE COALESCE(fsrs_implementation_version, '') != ?1
            ORDER BY id ASC
            LIMIT ?2
            "#,
        )
        .bind(FSRS7_IMPLEMENTATION_VERSION)
        .bind(limit as i64)
        .fetch_all(pool)
        .await
        .map_err(db_err)?
    };

    Ok(rows
        .into_iter()
        .map(|row| row.get::<String, _>("id"))
        .collect())
}

async fn migrate_single_item(
    pool: &Pool<Sqlite>,
    item_id: &str,
    desired_retention: f32,
) -> Result<()> {
    let reviews = load_item_reviews(pool, item_id).await?;
    let memory_state = replay_fsrs7_from_history(item_id, &reviews, desired_retention)?;

    let (algorithm_type, algorithm_state): (String, Option<String>) = sqlx::query_as(
        "SELECT algorithm_type, algorithm_state FROM learning_items WHERE id = ?1",
    )
    .bind(item_id)
    .fetch_one(pool)
    .await
    .map_err(db_err)?;

    let (legacy_algorithm_type, legacy_algorithm_state) = if algorithm_type == "fsrs" {
        (None::<String>, None::<String>)
    } else {
        (
            Some(algorithm_type.clone()),
            algorithm_state.clone(),
        )
    };

    if let Some(state) = memory_state {
        sqlx::query(
            r#"
            UPDATE learning_items
            SET memory_state_stability = ?1,
                memory_state_stability_fast = ?2,
                memory_state_difficulty = ?3,
                algorithm_type = 'fsrs',
                algorithm_state = NULL,
                legacy_algorithm_type = COALESCE(legacy_algorithm_type, ?4),
                legacy_algorithm_state = COALESCE(legacy_algorithm_state, ?5),
                fsrs_implementation_version = ?6
            WHERE id = ?7
            "#,
        )
        .bind(state.stability)
        .bind(state.stability_fast)
        .bind(state.difficulty)
        .bind(legacy_algorithm_type)
        .bind(legacy_algorithm_state)
        .bind(FSRS7_IMPLEMENTATION_VERSION)
        .bind(item_id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    } else {
        sqlx::query(
            r#"
            UPDATE learning_items
            SET algorithm_type = 'fsrs',
                algorithm_state = NULL,
                legacy_algorithm_type = COALESCE(legacy_algorithm_type, ?1),
                legacy_algorithm_state = COALESCE(legacy_algorithm_state, ?2),
                fsrs_implementation_version = ?3
            WHERE id = ?4
            "#,
        )
        .bind(legacy_algorithm_type)
        .bind(legacy_algorithm_state)
        .bind(FSRS7_IMPLEMENTATION_VERSION)
        .bind(item_id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    }

    Ok(())
}

async fn load_item_reviews(pool: &Pool<Sqlite>, item_id: &str) -> Result<Vec<HistoryReview>> {
    let rows = sqlx::query(
        r#"
        SELECT id, rating, reviewed_at_ms, timestamp
        FROM review_results
        WHERE item_id = ?1
        "#,
    )
    .bind(item_id)
    .fetch_all(pool)
    .await
    .map_err(db_err)?;

    let mut reviews = Vec::with_capacity(rows.len());
    for row in rows {
        reviews.push(HistoryReview {
            id: row.try_get("id").map_err(db_err)?,
            rating: row.try_get::<i32, _>("rating").map_err(db_err)? as u32,
            reviewed_at_ms: row.try_get("reviewed_at_ms").ok(),
            timestamp: row.try_get("timestamp").ok(),
        });
    }

    Ok(reviews)
}

fn db_err(error: sqlx::Error) -> PlethoraError {
    PlethoraError::Internal(format!("FSRS-7 migration database error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        crate::database::migrations::run_migrations(&pool)
            .await
            .expect("schema migrations");
        pool
    }

    async fn insert_learning_item(
        pool: &Pool<Sqlite>,
        id: &str,
        algorithm_type: &str,
        algorithm_state: Option<&str>,
        due_date: &str,
    ) {
        sqlx::query(
            r#"
            INSERT INTO learning_items (
                id, item_type, question, answer, due_date, date_created, date_modified,
                algorithm_type, algorithm_state
            ) VALUES (?1, 'basic', 'Q', 'A', ?2, ?2, ?2, ?3, ?4)
            "#,
        )
        .bind(id)
        .bind(due_date)
        .bind(algorithm_type)
        .bind(algorithm_state)
        .execute(pool)
        .await
        .expect("insert learning item");
    }

    async fn insert_review(
        pool: &Pool<Sqlite>,
        id: &str,
        item_id: &str,
        rating: i32,
        reviewed_at_ms: i64,
        timestamp: &str,
    ) {
        sqlx::query(
            r#"
            INSERT INTO review_results (
                id, item_id, rating, time_taken, new_due_date, new_interval,
                new_ease_factor, timestamp, reviewed_at_ms
            ) VALUES (?1, ?2, ?3, 1000, ?4, 1, 2.5, ?4, ?5)
            "#,
        )
        .bind(id)
        .bind(item_id)
        .bind(rating)
        .bind(timestamp)
        .bind(reviewed_at_ms)
        .execute(pool)
        .await
        .expect("insert review");
    }

    #[tokio::test]
    async fn new_user_with_zero_reviews_is_marked_without_rescheduling() {
        let pool = test_pool().await;
        insert_learning_item(
            &pool,
            "item-new",
            "fsrs",
            None,
            "2026-09-10T12:00:00Z",
        )
        .await;

        run_fsrs7_migration(&pool).await.expect("migration");

        let row = sqlx::query(
            r#"
            SELECT fsrs_implementation_version, due_date, memory_state_stability
            FROM learning_items WHERE id = 'item-new'
            "#,
        )
        .fetch_one(&pool)
        .await
        .expect("row");

        assert_eq!(
            row.get::<String, _>("fsrs_implementation_version"),
            FSRS7_IMPLEMENTATION_VERSION
        );
        assert_eq!(
            row.get::<String, _>("due_date"),
            "2026-09-10T12:00:00Z"
        );
        let stability: Option<f64> = row.get("memory_state_stability");
        assert!(stability.is_none());
    }

    #[tokio::test]
    async fn light_user_history_replays_to_finite_memory_state() {
        let pool = test_pool().await;
        insert_learning_item(
            &pool,
            "item-light",
            "fsrs",
            None,
            "2026-09-10T12:00:00Z",
        )
        .await;

        let base = Utc.with_ymd_and_hms(2026, 1, 1, 8, 0, 0).unwrap();
        for index in 0..50 {
            let reviewed_at = base + chrono::Duration::days(index);
            insert_review(
                &pool,
                &format!("rev-{index}"),
                "item-light",
                ((index % 4) + 1) as i32,
                reviewed_at.timestamp_millis(),
                &reviewed_at.to_rfc3339(),
            )
            .await;
        }

        run_fsrs7_migration(&pool).await.expect("migration");

        let row = sqlx::query(
            r#"
            SELECT memory_state_stability, memory_state_stability_fast, memory_state_difficulty
            FROM learning_items WHERE id = 'item-light'
            "#,
        )
        .fetch_one(&pool)
        .await
        .expect("row");

        let stability: f64 = row.get("memory_state_stability");
        let stability_fast: f64 = row.get("memory_state_stability_fast");
        let difficulty: f64 = row.get("memory_state_difficulty");
        assert!(stability.is_finite() && stability > 0.0);
        assert!(stability_fast.is_finite() && stability_fast > 0.0);
        assert!(difficulty.is_finite() && difficulty > 0.0);
    }

    #[test]
    fn same_day_reviews_use_fractional_elapsed_days() {
        let day = Utc.with_ymd_and_hms(2026, 6, 1, 8, 0, 0).unwrap();
        let reviews = vec![
            HistoryReview {
                id: "a".into(),
                rating: 3,
                reviewed_at_ms: Some(day.timestamp_millis()),
                timestamp: Some(day),
            },
            HistoryReview {
                id: "b".into(),
                rating: 3,
                reviewed_at_ms: Some((day + chrono::Duration::hours(6)).timestamp_millis()),
                timestamp: None,
            },
            HistoryReview {
                id: "c".into(),
                rating: 4,
                reviewed_at_ms: Some((day + chrono::Duration::hours(12)).timestamp_millis()),
                timestamp: None,
            },
        ];

        let state = replay_fsrs7_from_history("item-fractional", &reviews, 0.9)
            .expect("replay")
            .expect("state");

        assert!(state.stability.is_finite() && state.stability > 0.0);
        let stability_fast = state.stability_fast.expect("stability_fast");
        assert!(stability_fast.is_finite() && stability_fast > 0.0);
        assert!(state.difficulty.is_finite() && state.difficulty > 0.0);

        let sorted = {
            let mut ids = reviews.iter().map(|r| r.id.as_str()).collect::<Vec<_>>();
            ids.sort_by_key(|id| review_sort_key(reviews.iter().find(|r| r.id == *id).unwrap()));
            ids
        };
        assert_eq!(sorted, vec!["a", "b", "c"]);
    }

    #[tokio::test]
    async fn legacy_precision_item_preserves_legacy_algorithm_type() {
        let pool = test_pool().await;
        insert_learning_item(
            &pool,
            "item-precision",
            "precision",
            Some(r#"{"matrix":"m3"}"#),
            "2026-09-10T12:00:00Z",
        )
        .await;
        insert_review(
            &pool,
            "rev-precision",
            "item-precision",
            3,
            Utc.with_ymd_and_hms(2026, 8, 1, 9, 0, 0)
                .unwrap()
                .timestamp_millis(),
            "2026-08-01T09:00:00Z",
        )
        .await;

        run_fsrs7_migration(&pool).await.expect("migration");

        let row = sqlx::query(
            r#"
            SELECT algorithm_type, legacy_algorithm_type, legacy_algorithm_state, due_date
            FROM learning_items WHERE id = 'item-precision'
            "#,
        )
        .fetch_one(&pool)
        .await
        .expect("row");

        assert_eq!(row.get::<String, _>("algorithm_type"), "fsrs");
        assert_eq!(row.get::<String, _>("legacy_algorithm_type"), "precision");
        assert_eq!(
            row.get::<String, _>("legacy_algorithm_state"),
            r#"{"matrix":"m3"}"#
        );
        assert_eq!(
            row.get::<String, _>("due_date"),
            "2026-09-10T12:00:00Z"
        );
    }
}
