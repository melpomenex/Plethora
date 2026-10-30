//! Viewing and retry-safe review transactions for video segments.

use super::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::video_extract::{VideoExtractReviewReceipt, VideoExtractReviewResult};
use crate::models::{MemoryState, ReviewRating, VideoExtract};
use chrono::{DateTime, Duration, Utc};
use sqlx::{sqlite::SqliteRow, Row};

pub(crate) fn extract_from_row(row: &SqliteRow) -> Result<VideoExtract> {
    Ok(VideoExtract {
        id: row.try_get("id")?,
        document_id: row.try_get("document_id")?,
        collection_id: row
            .try_get("collection_id")
            .unwrap_or_else(|_| crate::models::collection::DEFAULT_COLLECTION_ID.to_string()),
        start_time: row.try_get("start_time")?,
        end_time: row.try_get("end_time")?,
        title: row.try_get("title")?,
        transcript_text: row.try_get("transcript_text")?,
        notes: row.try_get("notes")?,
        tags: serde_json::from_str(&row.try_get::<String, _>("tags")?)?,
        thumbnail_url: row.try_get("thumbnail_url")?,
        memory_state: row
            .try_get::<Option<String>, _>("memory_state")?
            .map(|json| serde_json::from_str(&json))
            .transpose()?,
        next_review_date: row.try_get("next_review_date")?,
        last_review_date: row.try_get("last_review_date")?,
        first_seen_at: row.try_get("first_seen_at")?,
        last_seen_at: row.try_get("last_seen_at")?,
        review_count: row.try_get("review_count")?,
        reps: row.try_get("reps")?,
        date_created: row.try_get("date_created")?,
        date_modified: row.try_get("date_modified")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::issue6_test_support::{issue6_repository, now, NEW_VIDEO_EXTRACT_ID, VIDEO_ID};

    #[tokio::test]
    async fn video_seen_preserves_history_and_legacy_payloads() {
        let repo = issue6_repository().await;
        let before = repo
            .get_video_extract(NEW_VIDEO_EXTRACT_ID)
            .await
            .unwrap()
            .unwrap();
        let seen = repo
            .mark_video_extract_seen(&before.id, now())
            .await
            .unwrap();
        assert_eq!(seen.first_seen_at, Some(now()));
        assert_eq!(seen.next_review_date, before.next_review_date);
        assert_eq!(seen.review_count, before.review_count);
        assert_eq!(seen.reps, before.reps);
        assert_eq!(
            serde_json::to_value(&seen.memory_state).unwrap(),
            serde_json::to_value(&before.memory_state).unwrap()
        );
        let seen = repo
            .mark_video_extract_seen(&before.id, now() + Duration::hours(1))
            .await
            .unwrap();
        assert_eq!(seen.first_seen_at, Some(now()));
        assert_eq!(seen.last_seen_at, Some(now() + Duration::hours(1)));
        assert!(repo
            .mark_video_extract_seen("missing", now())
            .await
            .is_err());
        let mut old = serde_json::to_value(&before).unwrap();
        old.as_object_mut().unwrap().remove("first_seen_at");
        old.as_object_mut().unwrap().remove("last_seen_at");
        let decoded: VideoExtract = serde_json::from_value(old).unwrap();
        assert!(decoded.first_seen_at.is_none());
    }

    #[tokio::test]
    async fn video_lifecycle_full_database_backup_reopens_with_receipts() {
        let dir = tempfile::tempdir().unwrap();
        let repo =
            crate::issue6_test_support::issue6_repository_at(dir.path().join("source.db")).await;
        repo.mark_video_extract_seen(NEW_VIDEO_EXTRACT_ID, now())
            .await
            .unwrap();
        let operation = uuid::Uuid::new_v4().to_string();
        let committed = repo
            .review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &operation, now())
            .await
            .unwrap();
        let path = dir.path().join("backup.db");
        // Same consistent SQLite snapshot primitive as BackupManager.
        let safe_path = path.to_string_lossy().replace('\'', "''");
        sqlx::query(&format!("VACUUM INTO '{}'", safe_path))
            .execute(repo.pool())
            .await
            .unwrap();
        assert!(path.exists(), "snapshot must exist before reopening");
        let restored = crate::database::Database::new(path).await.unwrap();
        restored.migrate().await.unwrap();
        let reopened = Repository::new(restored.pool().clone());
        let replay = reopened
            .review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &operation, now())
            .await
            .unwrap();
        assert_eq!(
            serde_json::to_value(&committed).unwrap(),
            serde_json::to_value(&replay).unwrap()
        );
        assert_eq!(replay.extract.unwrap().first_seen_at, Some(now()));
    }

    #[tokio::test]
    async fn video_lifecycle_collection_restore_keeps_receipts_and_rolls_back_invalid_archive() {
        let source = issue6_repository().await;
        source
            .mark_video_extract_seen(NEW_VIDEO_EXTRACT_ID, now())
            .await
            .unwrap();
        let operation = uuid::Uuid::new_v4().to_string();
        source
            .review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &operation, now())
            .await
            .unwrap();
        let archive = source.export_video_extract_lifecycle(None).await.unwrap();
        let target = issue6_repository().await;
        let mut tx = target.pool().begin().await.unwrap();
        sqlx::query("DELETE FROM video_extracts")
            .execute(&mut *tx)
            .await
            .unwrap();
        super::restore_video_lifecycle(&mut tx, &archive)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let reopened = Repository::new(target.pool().clone());
        assert_eq!(
            serde_json::to_value(&archive).unwrap(),
            serde_json::to_value(reopened.export_video_extract_lifecycle(None).await.unwrap())
                .unwrap()
        );
        let replay = reopened
            .review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &operation, now())
            .await
            .unwrap();
        assert_eq!(replay.extract.unwrap().review_count, 1);
        let mut invalid = archive.clone();
        invalid.extracts[0].id = "invalid-archive-row".into();
        invalid.extracts.truncate(1);
        invalid.review_receipts[0].operation_id = "invalid-operation".into();
        let mut tx = target.pool().begin().await.unwrap();
        assert!(super::restore_video_lifecycle(&mut tx, &invalid)
            .await
            .is_err());
        tx.rollback().await.unwrap();
        assert!(target
            .get_video_extract("invalid-archive-row")
            .await
            .unwrap()
            .is_none());
        let old: crate::models::video_extract::VideoExtractLifecycleArchive =
            serde_json::from_str("{}").unwrap();
        assert!(old.extracts.is_empty() && old.review_receipts.is_empty());
    }

    #[tokio::test]
    async fn video_review_replay_conflict_and_deleted_receipt() {
        let repo = issue6_repository().await;
        let child_before =
            serde_json::to_value(repo.get_video_extract(NEW_VIDEO_EXTRACT_ID).await.unwrap())
                .unwrap();
        repo.update_document_scheduling(
            VIDEO_ID,
            Some(now() + Duration::days(7)),
            Some(15.0),
            Some(3.0),
            Some(4),
            Some(60),
        )
        .await
        .unwrap();
        assert_eq!(
            child_before,
            serde_json::to_value(repo.get_video_extract(NEW_VIDEO_EXTRACT_ID).await.unwrap())
                .unwrap()
        );
        let parent = serde_json::to_value(repo.get_document(VIDEO_ID).await.unwrap()).unwrap();
        let op = uuid::Uuid::new_v4().to_string();
        let first = repo
            .review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &op, now())
            .await
            .unwrap();
        let replay = repo
            .review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &op, now() + Duration::days(2))
            .await
            .unwrap();
        assert_eq!(
            serde_json::to_value(&first.receipt).unwrap(),
            serde_json::to_value(&replay.receipt).unwrap()
        );
        assert_eq!(replay.extract.unwrap().review_count, 1);
        assert!(repo
            .review_video_extract(NEW_VIDEO_EXTRACT_ID, 2, &op, now())
            .await
            .is_err());
        assert_eq!(
            parent,
            serde_json::to_value(repo.get_document(VIDEO_ID).await.unwrap()).unwrap()
        );
        let mut stale_edit = first.receipt.before.clone();
        stale_edit.title = "Updated content".into();
        let edited = repo.update_video_extract(&stale_edit).await.unwrap();
        assert_eq!(edited.review_count, 1);
        assert_eq!(
            edited.next_review_date,
            first.receipt.after.next_review_date
        );
        repo.delete_video_extract(NEW_VIDEO_EXTRACT_ID)
            .await
            .unwrap();
        let deleted_replay = repo
            .review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &op, now())
            .await
            .unwrap();
        assert!(deleted_replay.extract.is_none());
        assert_eq!(deleted_replay.receipt.after.review_count, 1);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM video_extract_review_events")
            .fetch_one(repo.pool())
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn video_review_concurrent_intents_serialize_and_event_failure_rolls_back() {
        let repo = issue6_repository().await;
        sqlx::query("CREATE TRIGGER fail_video_receipt BEFORE INSERT ON video_extract_review_events BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END")
            .execute(repo.pool()).await.unwrap();
        let op = uuid::Uuid::new_v4().to_string();
        assert!(repo
            .review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &op, now())
            .await
            .is_err());
        assert_eq!(
            repo.get_video_extract(NEW_VIDEO_EXTRACT_ID)
                .await
                .unwrap()
                .unwrap()
                .review_count,
            0
        );
        sqlx::query("DROP TRIGGER fail_video_receipt")
            .execute(repo.pool())
            .await
            .unwrap();
        let other = uuid::Uuid::new_v4().to_string();
        let (a, b) = tokio::join!(
            repo.review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &op, now()),
            repo.review_video_extract(NEW_VIDEO_EXTRACT_ID, 4, &other, now()),
        );
        assert!(a.is_ok() && b.is_ok());
        assert_eq!(
            repo.get_video_extract(NEW_VIDEO_EXTRACT_ID)
                .await
                .unwrap()
                .unwrap()
                .review_count,
            2
        );
        let (a, b) = tokio::join!(
            repo.review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &op, now()),
            repo.review_video_extract(NEW_VIDEO_EXTRACT_ID, 3, &op, now()),
        );
        assert!(a.is_ok() && b.is_ok());
        assert_eq!(
            repo.get_video_extract(NEW_VIDEO_EXTRACT_ID)
                .await
                .unwrap()
                .unwrap()
                .review_count,
            2
        );
    }
}

impl Repository {
    /// Call only after the media player confirms the selected segment opened.
    pub async fn mark_video_extract_seen(
        &self,
        id: &str,
        now: DateTime<Utc>,
    ) -> Result<VideoExtract> {
        let row = sqlx::query(
            "UPDATE video_extracts SET first_seen_at = COALESCE(first_seen_at, ?1), \
             last_seen_at = ?1, date_modified = ?1 WHERE id = ?2 RETURNING *",
        )
        .bind(now)
        .bind(id)
        .fetch_optional(self.pool())
        .await?
        .ok_or_else(|| PlethoraError::NotFound("Video extract not found".into()))?;
        extract_from_row(&row)
    }

    /// Serialize at the SQLite writer boundary, including receipt lookup. No
    /// read/compute/write window can lose a concurrent review or duplicate retry.
    pub async fn review_video_extract(
        &self,
        id: &str,
        rating: i32,
        operation_id: &str,
        now: DateTime<Utc>,
    ) -> Result<VideoExtractReviewResult> {
        if !(1..=4).contains(&rating) || uuid::Uuid::parse_str(operation_id).is_err() {
            return Err(PlethoraError::Internal(
                "A rating from 1 to 4 and a valid operation ID are required".into(),
            ));
        }
        let mut tx = self.pool().begin().await?;
        // Acquire the write reservation before any reads, even for a deleted row.
        sqlx::query("UPDATE video_extracts SET id = id WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let stored: Option<String> = sqlx::query_scalar(
            "SELECT receipt_json FROM video_extract_review_events WHERE operation_id = ?",
        )
        .bind(operation_id)
        .fetch_optional(&mut *tx)
        .await?;
        let row = sqlx::query("SELECT * FROM video_extracts WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
        let current = row.as_ref().map(extract_from_row).transpose()?;
        if let Some(json) = stored {
            let receipt: VideoExtractReviewReceipt = serde_json::from_str(&json)?;
            if receipt.extract_id != id || receipt.rating != rating {
                return Err(PlethoraError::Internal(
                    "This rating operation was already used for a different review".into(),
                ));
            }
            tx.commit().await?;
            return Ok(VideoExtractReviewResult {
                extract: current,
                receipt,
            });
        }
        let before =
            current.ok_or_else(|| PlethoraError::NotFound("Video extract not found".into()))?;
        let mut after = before.clone();
        let elapsed = (now - before.last_review_date.unwrap_or(before.date_created))
            .num_seconds()
            .max(0) as f64
            / 86400.0;
        let schedule = crate::algorithms::DocumentScheduler::default_params().schedule_document(
            ReviewRating::from(rating),
            before.memory_state.as_ref().map(|m| m.stability),
            before.memory_state.as_ref().map(|m| m.difficulty),
            elapsed,
        )?;
        after.memory_state = Some(MemoryState {
            stability: schedule.stability,
            difficulty: schedule.difficulty,
            stability_fast: None,
        });
        after.next_review_date = Some(now + Duration::days(schedule.interval_days));
        after.last_review_date = Some(now);
        after.date_modified = now;
        after.review_count = before
            .review_count
            .checked_add(1)
            .ok_or_else(|| PlethoraError::Internal("Review counter overflow".into()))?;
        after.reps = before
            .reps
            .checked_add(1)
            .ok_or_else(|| PlethoraError::Internal("Review counter overflow".into()))?;
        let receipt = VideoExtractReviewReceipt {
            operation_id: operation_id.into(),
            extract_id: id.into(),
            document_id: before.document_id.clone(),
            rating,
            reviewed_at: now,
            before,
            after: after.clone(),
        };
        sqlx::query(
            "UPDATE video_extracts SET memory_state = ?, next_review_date = ?, \
            last_review_date = ?, review_count = ?, reps = ?, date_modified = ? WHERE id = ?",
        )
        .bind(serde_json::to_string(&after.memory_state)?)
        .bind(after.next_review_date)
        .bind(now)
        .bind(after.review_count)
        .bind(after.reps)
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        insert_video_review_receipt(&mut tx, &receipt).await?;
        tx.commit().await?;
        Ok(VideoExtractReviewResult {
            extract: Some(after),
            receipt,
        })
    }
}

/// Shared insertion for canonical creation and atomic local archive restoration.
pub(crate) async fn insert_video_extract(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    extract: &VideoExtract,
) -> Result<()> {
    let tags_json = serde_json::to_string(&extract.tags)?;
    let memory_state_json = extract
        .memory_state
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;

    sqlx::query(
            r#"
            INSERT INTO video_extracts (
                id, document_id, start_time, end_time, title,
                transcript_text, notes, tags, thumbnail_url,
                memory_state, next_review_date, last_review_date,
                review_count, reps, date_created, date_modified, first_seen_at, last_seen_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
            "#,
        )
        .bind(&extract.id)
        .bind(&extract.document_id)
        .bind(extract.start_time)
        .bind(extract.end_time)
        .bind(&extract.title)
        .bind(&extract.transcript_text)
        .bind(&extract.notes)
        .bind(&tags_json)
        .bind(&extract.thumbnail_url)
        .bind(&memory_state_json)
        .bind(extract.next_review_date)
        .bind(extract.last_review_date)
        .bind(extract.review_count)
        .bind(extract.reps)
        .bind(extract.date_created)
        .bind(extract.date_modified)
        .bind(extract.first_seen_at)
        .bind(extract.last_seen_at)
        .execute(&mut **tx)
        .await?;

    Ok(())
}

pub(crate) async fn restore_video_lifecycle(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    archive: &crate::models::video_extract::VideoExtractLifecycleArchive,
) -> Result<()> {
    for extract in &archive.extracts {
        insert_video_extract(tx, extract).await?;
    }
    for receipt in &archive.review_receipts {
        insert_video_review_receipt(tx, receipt).await?;
    }

    Ok(())
}

impl Repository {
    pub async fn export_video_extract_lifecycle(
        &self,
        document_ids: Option<&[String]>,
    ) -> Result<crate::models::video_extract::VideoExtractLifecycleArchive> {
        let ids = document_ids.map(|ids| ids.iter().collect::<std::collections::HashSet<_>>());
        let extracts = self
            .get_all_video_extracts()
            .await?
            .into_iter()
            .filter(|e| {
                ids.as_ref()
                    .map(|ids| ids.contains(&e.document_id))
                    .unwrap_or(true)
            })
            .collect();
        let rows: Vec<String> = sqlx::query_scalar("SELECT receipt_json FROM video_extract_review_events ORDER BY reviewed_at, operation_id")
            .fetch_all(self.pool()).await?;
        let mut review_receipts = Vec::new();
        for json in rows {
            let receipt: VideoExtractReviewReceipt = serde_json::from_str(&json)?;
            if ids
                .as_ref()
                .map(|ids| ids.contains(&receipt.document_id))
                .unwrap_or(true)
            {
                review_receipts.push(receipt);
            }
        }
        Ok(crate::models::video_extract::VideoExtractLifecycleArchive {
            extracts,
            review_receipts,
        })
    }
}

async fn insert_video_review_receipt(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    receipt: &VideoExtractReviewReceipt,
) -> Result<()> {
    if receipt.extract_id != receipt.before.id
        || receipt.extract_id != receipt.after.id
        || receipt.document_id != receipt.before.document_id
        || receipt.document_id != receipt.after.document_id
        || !(1..=4).contains(&receipt.rating)
        || uuid::Uuid::parse_str(&receipt.operation_id).is_err()
    {
        return Err(PlethoraError::InvalidInput(
            "Invalid video review receipt".into(),
        ));
    }
    sqlx::query("INSERT INTO video_extract_review_events (operation_id, extract_id, document_id, rating, reviewed_at, receipt_json) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&receipt.operation_id).bind(&receipt.extract_id).bind(&receipt.document_id).bind(receipt.rating)
            .bind(receipt.reviewed_at).bind(serde_json::to_string(receipt)?).execute(&mut **tx).await?;
    Ok(())
}
