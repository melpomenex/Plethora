//! Per-item statistics commands — the time-tracking write path the frontend
//! calls on every heartbeat flush, and (below) the read path the Details
//! popover and the Item Stats modal consume.

use crate::database::{ItemActivityRepository, ItemStatsRepository, Repository};
use crate::error::{IncrementumError, Result};
use crate::models::item_activity::{ActivityItemType, ActivitySurface};
use crate::models::item_stats::{ItemStatsDetail, ItemStatsSummary, StatsItemType};
use tauri::State;

/// Matches the default in `get_leech_dashboard` and the frontend's
/// `settings.learning.leechThreshold` default, so an item flagged here is
/// flagged everywhere else too.
const DEFAULT_LEECH_THRESHOLD: i32 = 8;

fn parse_item_type(value: &str) -> Result<ActivityItemType> {
    ActivityItemType::from_str(value).ok_or_else(|| {
        IncrementumError::InvalidInput(format!(
            "Unsupported item type for time tracking: {value}. Flashcard time is recorded \
             through the review path, which writes review_results."
        ))
    })
}

fn parse_surface(value: &str) -> Result<ActivitySurface> {
    ActivitySurface::from_str(value)
        .ok_or_else(|| IncrementumError::InvalidInput(format!("Unknown surface: {value}")))
}

/// Flush a batch of observed active seconds for one item.
///
/// Called on the tracker's cadence (and on blur, visibility loss, item change,
/// unmount, and `beforeunload`), so a crash loses at most one interval and can
/// never inflate a total: only seconds the frontend actually observed are ever
/// sent.
///
/// When `session_id` names an open reading session, that session carries the
/// history for this accrual — the reader's event source is `reading_sessions`,
/// and writing an activity row too would double-count the document's timeline.
/// If the session is already closed (or was never there), the accrual falls
/// back to an activity row so the time still shows up somewhere.
#[tauri::command]
pub async fn record_active_time(
    item_type: String,
    item_id: String,
    surface: String,
    active_seconds: i64,
    session_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<()> {
    if active_seconds <= 0 {
        return Ok(());
    }

    let item_type = parse_item_type(&item_type)?;
    let surface = parse_surface(&surface)?;
    let activity = ItemActivityRepository::new(repo.pool().clone());

    activity
        .accumulate_item_time(item_type, &item_id, active_seconds)
        .await?;

    let session_absorbed = match session_id.as_deref() {
        Some(id) => {
            activity
                .heartbeat_reading_session(id, active_seconds)
                .await?
        }
        None => false,
    };

    if !session_absorbed {
        activity
            .record_heartbeat_activity(item_type, &item_id, surface, active_seconds)
            .await?;
    }

    Ok(())
}

fn parse_stats_item_type(value: &str) -> Result<StatsItemType> {
    StatsItemType::from_wire(value).ok_or_else(|| {
        IncrementumError::InvalidInput(format!("Unknown item type for statistics: {value}"))
    })
}

/// The ≤6 values the Details popover shows above its scheduling grid.
///
/// Kept separate from [`get_item_stats_detail`] so the popover's open latency
/// is unchanged: this is indexed lookups on the item row plus two aggregates,
/// with no timeline scan and no rank query.
#[tauri::command]
pub async fn get_item_stats_summary(
    item_type: String,
    item_id: String,
    repo: State<'_, Repository>,
) -> Result<ItemStatsSummary> {
    let item_type = parse_stats_item_type(&item_type)?;
    ItemStatsRepository::new(repo.pool().clone())
        .summary(item_type, &item_id)
        .await
}

/// Everything the full Item Statistics modal renders, in one round trip.
///
/// `leech_threshold` comes from the caller's learning settings so the flag
/// here agrees with the Leech dashboard's.
#[tauri::command]
pub async fn get_item_stats_detail(
    item_type: String,
    item_id: String,
    leech_threshold: Option<i32>,
    repo: State<'_, Repository>,
) -> Result<ItemStatsDetail> {
    let item_type = parse_stats_item_type(&item_type)?;
    let threshold = leech_threshold.unwrap_or(DEFAULT_LEECH_THRESHOLD).max(1);

    ItemStatsRepository::new(repo.pool().clone())
        .detail(item_type, &item_id, threshold)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::services::PositionService;
    use std::path::PathBuf;

    /// A repository seeded the way a real install looks: one document, one
    /// extract on it.
    async fn setup() -> Repository {
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

        Repository::new(pool)
    }

    /// The body of `record_active_time` without the Tauri `State` wrapper,
    /// which cannot be constructed outside a running app.
    async fn flush(
        repo: &Repository,
        item_type: ActivityItemType,
        item_id: &str,
        surface: ActivitySurface,
        active_seconds: i64,
        session_id: Option<&str>,
    ) {
        let activity = ItemActivityRepository::new(repo.pool().clone());
        activity
            .accumulate_item_time(item_type, item_id, active_seconds)
            .await
            .expect("accumulate");

        let absorbed = match session_id {
            Some(id) => activity
                .heartbeat_reading_session(id, active_seconds)
                .await
                .expect("heartbeat"),
            None => false,
        };

        if !absorbed {
            activity
                .record_heartbeat_activity(item_type, item_id, surface, active_seconds)
                .await
                .expect("activity row");
        }
    }

    #[tokio::test]
    async fn extract_time_is_persisted_and_accumulates_across_two_reviews() {
        let repo = setup().await;
        let activity = ItemActivityRepository::new(repo.pool().clone());

        // Two reviews, the way `submit_extract_review` writes them.
        for (seconds, rating, interval) in [(45i64, 3i32, 2.5f64), (30, 4, 10.0)] {
            activity
                .accumulate_item_time(ActivityItemType::Extract, "ext-1", seconds)
                .await
                .expect("accumulate");
            activity
                .record_event(&crate::models::item_activity::ItemActivityEvent::review(
                    ActivityItemType::Extract,
                    "ext-1".to_string(),
                    ActivitySurface::Queue,
                    seconds,
                    rating,
                    interval,
                ))
                .await
                .expect("record review");
        }

        assert_eq!(
            activity
                .get_item_total_time(ActivityItemType::Extract, "ext-1")
                .await
                .expect("read total"),
            Some(75),
            "the second review adds to the first rather than replacing it"
        );

        let rows: Vec<(i64, Option<i32>, Option<f64>)> = sqlx::query_as(
            "SELECT active_seconds, rating, resulting_interval_days FROM item_activity_log
             WHERE item_type = 'extract' AND item_id = 'ext-1' ORDER BY started_at",
        )
        .fetch_all(repo.pool())
        .await
        .expect("read history");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].1, Some(3));
        assert_eq!(rows[1].1, Some(4));
        assert_eq!(rows[1].2, Some(10.0));
    }

    #[tokio::test]
    async fn a_heartbeat_flush_survives_a_crash_without_adding_the_gap() {
        let repo = setup().await;
        let service = PositionService::new(repo.pool().clone());
        let activity = ItemActivityRepository::new(repo.pool().clone());

        let session = service
            .start_reading_session("doc-1", 10.0)
            .await
            .expect("start session");

        // Twelve active minutes observed in flushes.
        for _ in 0..24 {
            flush(
                &repo,
                ActivityItemType::Document,
                "doc-1",
                ActivitySurface::Reader,
                30,
                Some(&session.id),
            )
            .await;
        }

        // Simulate the crash: the session is never ended, and an hour of
        // wall-clock passes before the next launch. Backdating the row's
        // timestamps is how we express "an hour ago" without waiting.
        sqlx::query(
            "UPDATE reading_sessions
             SET started_at = ?1, last_heartbeat_at = ?2
             WHERE id = ?3",
        )
        .bind((chrono::Utc::now() - chrono::Duration::minutes(72)).to_rfc3339())
        .bind((chrono::Utc::now() - chrono::Duration::minutes(60)).to_rfc3339())
        .bind(&session.id)
        .execute(repo.pool())
        .await
        .expect("backdate session");

        let recovered = activity
            .close_stale_reading_sessions()
            .await
            .expect("startup recovery");
        assert_eq!(recovered, 1);

        let (duration, ended_at, last_heartbeat): (i64, String, String) = sqlx::query_as(
            "SELECT duration_seconds, ended_at, last_heartbeat_at FROM reading_sessions WHERE id = ?1",
        )
        .bind(&session.id)
        .fetch_one(repo.pool())
        .await
        .expect("read recovered session");

        assert_eq!(
            duration, 720,
            "12 active minutes survive; the unobserved hour is not added"
        );
        assert_eq!(
            ended_at, last_heartbeat,
            "the session ends at its last observed engagement"
        );

        assert_eq!(
            activity
                .get_item_total_time(ActivityItemType::Document, "doc-1")
                .await
                .expect("read total"),
            Some(720),
            "the document's cumulative total matches what was observed"
        );
    }

    #[tokio::test]
    async fn ending_a_session_prefers_heartbeat_seconds_over_wall_clock() {
        let repo = setup().await;
        let service = PositionService::new(repo.pool().clone());

        let session = service
            .start_reading_session("doc-1", 0.0)
            .await
            .expect("start session");

        // Four active minutes, then the document sits open for three hours.
        flush(
            &repo,
            ActivityItemType::Document,
            "doc-1",
            ActivitySurface::Reader,
            240,
            Some(&session.id),
        )
        .await;
        sqlx::query("UPDATE reading_sessions SET started_at = ?1 WHERE id = ?2")
            .bind((chrono::Utc::now() - chrono::Duration::hours(3)).to_rfc3339())
            .bind(&session.id)
            .execute(repo.pool())
            .await
            .expect("backdate start");

        service
            .end_reading_session(&session.id, 25.0)
            .await
            .expect("end session");

        let (duration,): (i64,) =
            sqlx::query_as("SELECT duration_seconds FROM reading_sessions WHERE id = ?1")
                .bind(&session.id)
                .fetch_one(repo.pool())
                .await
                .expect("read duration");

        assert_eq!(
            duration, 240,
            "3 idle hours must not be reported as reading time"
        );
    }

    #[tokio::test]
    async fn a_session_that_never_heartbeat_still_falls_back_to_wall_clock() {
        let repo = setup().await;
        let service = PositionService::new(repo.pool().clone());

        let session = service
            .start_reading_session("doc-1", 0.0)
            .await
            .expect("start session");
        sqlx::query("UPDATE reading_sessions SET started_at = ?1 WHERE id = ?2")
            .bind((chrono::Utc::now() - chrono::Duration::seconds(90)).to_rfc3339())
            .bind(&session.id)
            .execute(repo.pool())
            .await
            .expect("backdate start");

        service
            .end_reading_session(&session.id, 5.0)
            .await
            .expect("end session");

        let (duration,): (i64,) =
            sqlx::query_as("SELECT duration_seconds FROM reading_sessions WHERE id = ?1")
                .bind(&session.id)
                .fetch_one(repo.pool())
                .await
                .expect("read duration");

        assert!(
            (85..=100).contains(&duration),
            "with no heartbeat the old wall-clock behaviour remains, got {duration}"
        );
    }

    #[tokio::test]
    async fn a_reader_flush_with_an_open_session_does_not_also_write_an_activity_row() {
        let repo = setup().await;
        let service = PositionService::new(repo.pool().clone());
        let session = service
            .start_reading_session("doc-1", 0.0)
            .await
            .expect("start session");

        flush(
            &repo,
            ActivityItemType::Document,
            "doc-1",
            ActivitySurface::Reader,
            30,
            Some(&session.id),
        )
        .await;

        let (rows,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM item_activity_log WHERE item_id = 'doc-1'")
                .fetch_one(repo.pool())
                .await
                .expect("count");
        assert_eq!(
            rows, 0,
            "the reading session is the history record; a second row would double the timeline"
        );
    }

    #[tokio::test]
    async fn a_flush_for_a_closed_session_falls_back_to_an_activity_row() {
        let repo = setup().await;
        let service = PositionService::new(repo.pool().clone());
        let session = service
            .start_reading_session("doc-1", 0.0)
            .await
            .expect("start session");
        service
            .end_reading_session(&session.id, 5.0)
            .await
            .expect("end session");

        flush(
            &repo,
            ActivityItemType::Document,
            "doc-1",
            ActivitySurface::Reader,
            30,
            Some(&session.id),
        )
        .await;

        let (rows,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM item_activity_log WHERE item_id = 'doc-1'")
                .fetch_one(repo.pool())
                .await
                .expect("count");
        assert_eq!(rows, 1, "late time is still recorded somewhere");
    }

    #[test]
    fn unsupported_item_types_are_rejected_with_a_reason() {
        let err = parse_item_type("flashcard").expect_err("flashcards are not tracked here");
        assert!(
            err.to_string().contains("review_results"),
            "the error should point at where flashcard time actually lives, got: {err}"
        );

        assert!(parse_item_type("document").is_ok());
        assert!(parse_item_type("extract").is_ok());
    }

    #[test]
    fn unknown_surfaces_are_rejected() {
        assert!(parse_surface("queue").is_ok());
        assert!(parse_surface("reader").is_ok());
        assert!(parse_surface("studio").is_err());
    }
}
