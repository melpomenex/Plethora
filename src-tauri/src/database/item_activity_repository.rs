//! Per-item activity repository — the write path for `item_activity_log`,
//! the cumulative time columns, and reading-session heartbeats.
//!
//! Two rules shape everything here:
//!
//! 1. **Totals only grow.** Nothing recomputes or resets a value that was
//!    already accumulated, so a user never sees a number go backwards.
//! 2. **Nothing is written for a period that was not observed.** A heartbeat
//!    records seconds the frontend actually counted; a crash therefore loses
//!    at most one flush interval and can never inflate a total.

use crate::error::{IncrementumError, Result};
use crate::models::item_activity::{ActivityItemType, ActivitySurface, ItemActivityEvent};
use chrono::{DateTime, Duration, Utc};
use sqlx::{Pool, Sqlite};
use uuid::Uuid;

/// How long after its last heartbeat an open activity row still counts as the
/// same burst of engagement. Within this window a flush extends the existing
/// row; past it, the next flush starts a new one. Keeps the timeline one row
/// per contiguous sitting rather than one row per 30 s flush.
pub const ACTIVITY_COALESCE_WINDOW_SECONDS: i64 = 300;

#[derive(Clone)]
pub struct ItemActivityRepository {
    pool: Pool<Sqlite>,
}

impl ItemActivityRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Insert a completed activity row (a review, typically).
    pub async fn record_event(&self, event: &ItemActivityEvent) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO item_activity_log (
                id, item_type, item_id, surface, started_at, ended_at,
                active_seconds, rating, resulting_interval_days,
                progress_start, progress_end
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
        )
        .bind(&event.id)
        .bind(event.item_type.as_str())
        .bind(&event.item_id)
        .bind(event.surface.as_str())
        .bind(event.started_at.to_rfc3339())
        .bind(event.ended_at.map(|d| d.to_rfc3339()))
        .bind(event.active_seconds)
        .bind(event.rating)
        .bind(event.resulting_interval_days)
        .bind(event.progress_start)
        .bind(event.progress_end)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            IncrementumError::Internal(format!("Failed to record item activity: {}", e))
        })?;

        Ok(())
    }

    /// Add active seconds to an item's cumulative total.
    ///
    /// `COALESCE(total_time_spent, 0)` on purpose: a NULL means "never
    /// recorded", and the first accrual must turn it into a real number
    /// without the caller having to know which state it was in.
    pub async fn accumulate_item_time(
        &self,
        item_type: ActivityItemType,
        item_id: &str,
        active_seconds: i64,
    ) -> Result<()> {
        if active_seconds <= 0 {
            return Ok(());
        }

        let sql = match item_type {
            ActivityItemType::Document => {
                "UPDATE documents SET total_time_spent = COALESCE(total_time_spent, 0) + ?1 WHERE id = ?2"
            }
            ActivityItemType::Extract => {
                "UPDATE extracts SET total_time_spent = COALESCE(total_time_spent, 0) + ?1 WHERE id = ?2"
            }
        };

        sqlx::query(sql)
            .bind(active_seconds)
            .bind(item_id)
            .execute(&self.pool)
            .await
            .map_err(|e| {
                IncrementumError::Internal(format!("Failed to accumulate item time: {}", e))
            })?;

        Ok(())
    }

    /// Fold a heartbeat flush into the item's activity timeline.
    ///
    /// Extends the most recent un-rated row for the same item and surface when
    /// the flush lands inside [`ACTIVITY_COALESCE_WINDOW_SECONDS`] of that
    /// row's end; otherwise opens a new one. Either way the row ends at the
    /// last observed engagement, never at "now minus an unobserved gap".
    pub async fn record_heartbeat_activity(
        &self,
        item_type: ActivityItemType,
        item_id: &str,
        surface: ActivitySurface,
        active_seconds: i64,
    ) -> Result<()> {
        if active_seconds <= 0 {
            return Ok(());
        }

        let now = Utc::now();
        let cutoff = (now - Duration::seconds(ACTIVITY_COALESCE_WINDOW_SECONDS)).to_rfc3339();

        let open_row: Option<(String,)> = sqlx::query_as(
            r#"
            SELECT id FROM item_activity_log
            WHERE item_type = ?1 AND item_id = ?2 AND surface = ?3
              AND rating IS NULL
              AND COALESCE(ended_at, started_at) >= ?4
            ORDER BY COALESCE(ended_at, started_at) DESC
            LIMIT 1
            "#,
        )
        .bind(item_type.as_str())
        .bind(item_id)
        .bind(surface.as_str())
        .bind(&cutoff)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            IncrementumError::Internal(format!("Failed to look up open activity row: {}", e))
        })?;

        match open_row {
            Some((id,)) => {
                sqlx::query(
                    "UPDATE item_activity_log
                     SET active_seconds = active_seconds + ?1, ended_at = ?2
                     WHERE id = ?3",
                )
                .bind(active_seconds)
                .bind(now.to_rfc3339())
                .bind(&id)
                .execute(&self.pool)
                .await
                .map_err(|e| {
                    IncrementumError::Internal(format!("Failed to extend activity row: {}", e))
                })?;
            }
            None => {
                let started_at = now - Duration::seconds(active_seconds);
                sqlx::query(
                    r#"
                    INSERT INTO item_activity_log (
                        id, item_type, item_id, surface, started_at, ended_at, active_seconds
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                    "#,
                )
                .bind(Uuid::new_v4().to_string())
                .bind(item_type.as_str())
                .bind(item_id)
                .bind(surface.as_str())
                .bind(started_at.to_rfc3339())
                .bind(now.to_rfc3339())
                .bind(active_seconds)
                .execute(&self.pool)
                .await
                .map_err(|e| {
                    IncrementumError::Internal(format!("Failed to open activity row: {}", e))
                })?;
            }
        }

        Ok(())
    }

    /// Apply a heartbeat to an open reading session: add the observed seconds
    /// to its duration and stamp the flush time.
    ///
    /// `ended_at IS NULL` in the predicate keeps a late flush from reopening a
    /// session that was already closed. Returns whether a row was updated.
    pub async fn heartbeat_reading_session(
        &self,
        session_id: &str,
        active_seconds: i64,
    ) -> Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE reading_sessions
            SET duration_seconds = duration_seconds + ?1,
                last_heartbeat_at = ?2
            WHERE id = ?3 AND ended_at IS NULL
            "#,
        )
        .bind(active_seconds.max(0))
        .bind(Utc::now().to_rfc3339())
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            IncrementumError::Internal(format!("Failed to heartbeat reading session: {}", e))
        })?;

        Ok(result.rows_affected() > 0)
    }

    /// Close every reading session left open by a previous run, ending it at
    /// its last recorded engagement.
    ///
    /// Idempotent: the `ended_at IS NULL` predicate means a second run matches
    /// nothing. `duration_seconds` is left exactly as the heartbeats built it
    /// — the gap between the last heartbeat and this startup was never
    /// observed, so it is not time anyone spent reading.
    ///
    /// Returns the number of sessions recovered.
    pub async fn close_stale_reading_sessions(&self) -> Result<u64> {
        let result = sqlx::query(
            r#"
            UPDATE reading_sessions
            SET ended_at = COALESCE(last_heartbeat_at, started_at)
            WHERE ended_at IS NULL
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| {
            IncrementumError::Internal(format!("Failed to close stale reading sessions: {}", e))
        })?;

        Ok(result.rows_affected())
    }

    /// Where the user was in this document at the end of their last recorded
    /// interaction, from either event source.
    ///
    /// This is what a rating's `progress_start` should be: the delta a review
    /// records is the ground covered since the previous interaction, not since
    /// the document was created. `None` when nothing was ever recorded.
    pub async fn last_known_document_progress(&self, document_id: &str) -> Result<Option<f64>> {
        let row: Option<(Option<f64>,)> = sqlx::query_as(
            r#"
            SELECT progress_end FROM (
                SELECT progress_end, COALESCE(ended_at, started_at) AS at
                FROM item_activity_log
                WHERE item_type = 'document' AND item_id = ?1 AND progress_end IS NOT NULL
                UNION ALL
                SELECT progress_end, COALESCE(ended_at, started_at) AS at
                FROM reading_sessions
                WHERE document_id = ?1
            )
            ORDER BY at DESC
            LIMIT 1
            "#,
        )
        .bind(document_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            IncrementumError::Internal(format!("Failed to read last document progress: {}", e))
        })?;

        Ok(row.and_then(|(progress,)| progress))
    }

    /// Read an item's cumulative total. `None` means never recorded, which the
    /// UI renders as "not recorded" rather than `0`.
    pub async fn get_item_total_time(
        &self,
        item_type: ActivityItemType,
        item_id: &str,
    ) -> Result<Option<i64>> {
        let sql = match item_type {
            ActivityItemType::Document => "SELECT total_time_spent FROM documents WHERE id = ?1",
            ActivityItemType::Extract => "SELECT total_time_spent FROM extracts WHERE id = ?1",
        };

        let row: Option<(Option<i64>,)> = sqlx::query_as(sql)
            .bind(item_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| {
                IncrementumError::Internal(format!("Failed to read item total time: {}", e))
            })?;

        Ok(row.and_then(|(total,)| total))
    }
}

/// Parse an RFC3339 timestamp stored in a TEXT column, tolerating the
/// `YYYY-MM-DD HH:MM:SS` form SQLite's own `datetime()` produces.
pub(crate) fn parse_stored_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|d| d.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|naive| naive.and_utc())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use std::path::PathBuf;

    async fn setup() -> ItemActivityRepository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        let pool = db.pool().clone();

        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified)
             VALUES ('doc-1', 'Doc', '/tmp/doc.pdf', 'pdf', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("seed document");

        sqlx::query(
            "INSERT INTO extracts (id, document_id, content, date_created, date_modified)
             VALUES ('ext-1', 'doc-1', 'Extract', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("seed extract");

        ItemActivityRepository::new(pool)
    }

    #[tokio::test]
    async fn accumulating_time_turns_a_never_recorded_total_into_a_real_one() {
        let repo = setup().await;

        assert_eq!(
            repo.get_item_total_time(ActivityItemType::Extract, "ext-1")
                .await
                .expect("read"),
            None,
            "a pre-change extract has no recorded total"
        );

        repo.accumulate_item_time(ActivityItemType::Extract, "ext-1", 45)
            .await
            .expect("accumulate");
        repo.accumulate_item_time(ActivityItemType::Extract, "ext-1", 30)
            .await
            .expect("accumulate again");

        assert_eq!(
            repo.get_item_total_time(ActivityItemType::Extract, "ext-1")
                .await
                .expect("read"),
            Some(75)
        );
    }

    #[tokio::test]
    async fn heartbeats_within_the_window_extend_one_row_instead_of_spawning_many() {
        let repo = setup().await;

        for _ in 0..3 {
            repo.record_heartbeat_activity(
                ActivityItemType::Document,
                "doc-1",
                ActivitySurface::Reader,
                30,
            )
            .await
            .expect("heartbeat");
        }

        let rows: Vec<(i64,)> =
            sqlx::query_as("SELECT active_seconds FROM item_activity_log WHERE item_id = 'doc-1'")
                .fetch_all(repo.pool())
                .await
                .expect("read rows");

        assert_eq!(rows.len(), 1, "contiguous flushes coalesce into one row");
        assert_eq!(rows[0].0, 90);
    }

    #[tokio::test]
    async fn a_heartbeat_past_the_window_starts_a_new_row() {
        let repo = setup().await;

        // A stale row whose last engagement is well outside the window.
        let stale_end =
            (Utc::now() - Duration::seconds(ACTIVITY_COALESCE_WINDOW_SECONDS + 60)).to_rfc3339();
        sqlx::query(
            "INSERT INTO item_activity_log (id, item_type, item_id, surface, started_at, ended_at, active_seconds)
             VALUES ('stale', 'document', 'doc-1', 'reader', ?1, ?1, 120)",
        )
        .bind(&stale_end)
        .execute(repo.pool())
        .await
        .expect("seed stale row");

        repo.record_heartbeat_activity(
            ActivityItemType::Document,
            "doc-1",
            ActivitySurface::Reader,
            30,
        )
        .await
        .expect("heartbeat");

        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM item_activity_log WHERE item_id = 'doc-1'")
                .fetch_one(repo.pool())
                .await
                .expect("count");
        assert_eq!(count, 2);

        let (stale_seconds,): (i64,) =
            sqlx::query_as("SELECT active_seconds FROM item_activity_log WHERE id = 'stale'")
                .fetch_one(repo.pool())
                .await
                .expect("read stale");
        assert_eq!(stale_seconds, 120, "the stale row is left alone");
    }

    #[tokio::test]
    async fn a_rated_row_is_never_extended_by_a_later_heartbeat() {
        let repo = setup().await;

        let event = ItemActivityEvent::review(
            ActivityItemType::Document,
            "doc-1".to_string(),
            ActivitySurface::Reader,
            60,
            3,
            4.0,
        );
        repo.record_event(&event).await.expect("record review");

        repo.record_heartbeat_activity(
            ActivityItemType::Document,
            "doc-1",
            ActivitySurface::Reader,
            30,
        )
        .await
        .expect("heartbeat");

        let (review_seconds,): (i64,) =
            sqlx::query_as("SELECT active_seconds FROM item_activity_log WHERE id = ?1")
                .bind(&event.id)
                .fetch_one(repo.pool())
                .await
                .expect("read review row");
        assert_eq!(review_seconds, 60, "the review row keeps its own duration");

        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM item_activity_log WHERE item_id = 'doc-1'")
                .fetch_one(repo.pool())
                .await
                .expect("count");
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn a_heartbeat_cannot_reopen_a_closed_session() {
        let repo = setup().await;

        sqlx::query(
            "INSERT INTO reading_sessions (id, document_id, started_at, ended_at, duration_seconds)
             VALUES ('sess-closed', 'doc-1', '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', 600)",
        )
        .execute(repo.pool())
        .await
        .expect("seed closed session");

        let applied = repo
            .heartbeat_reading_session("sess-closed", 30)
            .await
            .expect("heartbeat");

        assert!(!applied);
        let (duration,): (i64,) = sqlx::query_as(
            "SELECT duration_seconds FROM reading_sessions WHERE id = 'sess-closed'",
        )
        .fetch_one(repo.pool())
        .await
        .expect("read duration");
        assert_eq!(duration, 600);
    }

    #[tokio::test]
    async fn startup_recovery_closes_a_stale_session_at_its_last_heartbeat() {
        let repo = setup().await;

        sqlx::query(
            "INSERT INTO reading_sessions (id, document_id, started_at, duration_seconds, last_heartbeat_at)
             VALUES ('sess-stale', 'doc-1', '2026-01-01T00:00:00Z', 720, '2026-01-01T00:12:00Z')",
        )
        .execute(repo.pool())
        .await
        .expect("seed stale session");

        let recovered = repo.close_stale_reading_sessions().await.expect("recover");
        assert_eq!(recovered, 1);

        let (ended_at, duration): (String, i64) = sqlx::query_as(
            "SELECT ended_at, duration_seconds FROM reading_sessions WHERE id = 'sess-stale'",
        )
        .fetch_one(repo.pool())
        .await
        .expect("read recovered session");

        assert_eq!(ended_at, "2026-01-01T00:12:00Z");
        assert_eq!(
            duration, 720,
            "the unobserved gap after the last heartbeat adds nothing"
        );

        // Running again is a no-op — startup recovery runs on every launch.
        assert_eq!(
            repo.close_stale_reading_sessions().await.expect("recover"),
            0
        );
    }

    #[tokio::test]
    async fn a_session_that_never_heartbeat_is_closed_at_its_start() {
        let repo = setup().await;

        sqlx::query(
            "INSERT INTO reading_sessions (id, document_id, started_at, duration_seconds)
             VALUES ('sess-empty', 'doc-1', '2026-01-01T00:00:00Z', 0)",
        )
        .execute(repo.pool())
        .await
        .expect("seed session");

        repo.close_stale_reading_sessions().await.expect("recover");

        let (ended_at, duration): (String, i64) = sqlx::query_as(
            "SELECT ended_at, duration_seconds FROM reading_sessions WHERE id = 'sess-empty'",
        )
        .fetch_one(repo.pool())
        .await
        .expect("read session");

        assert_eq!(ended_at, "2026-01-01T00:00:00Z");
        assert_eq!(duration, 0);
    }

    #[test]
    fn stored_timestamps_parse_in_both_forms_the_schema_produces() {
        assert!(parse_stored_timestamp("2026-01-01T00:12:00Z").is_some());
        assert!(parse_stored_timestamp("2026-01-01 00:12:00").is_some());
        assert!(parse_stored_timestamp("not a date").is_none());
    }
}
