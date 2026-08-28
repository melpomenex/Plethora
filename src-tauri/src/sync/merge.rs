use crate::error::{PlethoraError, Result};
use chrono::{DateTime, Utc};
use sqlx::{Sqlite, Transaction};

use super::types::{EntityType, SyncOperation};
use super::wire::RemoteSyncRecord;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyOutcome {
    Applied,
    SkippedOlder,
    SkippedDuplicate,
}

pub fn hlc_gt(left: &str, right: &str) -> bool {
    parse_hlc(left) > parse_hlc(right)
}

fn parse_hlc(raw: &str) -> (i64, i64) {
    let mut parts = raw.split(':');
    let physical = parts
        .next()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let logical = parts
        .next()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    (physical, logical)
}

pub async fn apply_remote_record(
    tx: &mut Transaction<'_, Sqlite>,
    local_device_id: &str,
    record: &RemoteSyncRecord,
) -> Result<ApplyOutcome> {
    if record.device_id == local_device_id {
        return Ok(ApplyOutcome::SkippedDuplicate);
    }

    match record.entity_type {
        EntityType::ReviewResult => apply_review_result(tx, record).await,
        EntityType::LearningItem => apply_learning_item(tx, record).await,
    }
}

async fn apply_review_result(
    tx: &mut Transaction<'_, Sqlite>,
    record: &RemoteSyncRecord,
) -> Result<ApplyOutcome> {
    #[derive(serde::Deserialize)]
    struct ReviewPayload {
        id: String,
        item_id: String,
        collection_id: String,
        rating: i32,
        time_taken: i32,
        new_due_date: String,
        new_interval: f64,
        new_ease_factor: f64,
        reviewed_at_ms: i64,
        device_id: String,
        session_id: Option<String>,
    }

    let parsed: ReviewPayload = serde_json::from_slice(&record.payload)
        .map_err(|e| PlethoraError::Internal(format!("Review payload decode failed: {e}")))?;

    let due_date = DateTime::parse_from_rfc3339(&parsed.new_due_date)
        .map_err(|e| PlethoraError::Internal(format!("Invalid review due date: {e}")))?
        .with_timezone(&Utc);

    let inserted = sqlx::query(
        r#"
        INSERT OR IGNORE INTO review_results (
            id, collection_id, session_id, item_id, rating, time_taken,
            new_due_date, new_interval, new_ease_factor, timestamp,
            device_id, reviewed_at_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime(?10 / 1000.0, 'unixepoch'), ?11, ?12)
        "#,
    )
    .bind(&parsed.id)
    .bind(&parsed.collection_id)
    .bind(&parsed.session_id)
    .bind(&parsed.item_id)
    .bind(parsed.rating)
    .bind(parsed.time_taken)
    .bind(due_date)
    .bind(parsed.new_interval)
    .bind(parsed.new_ease_factor)
    .bind(parsed.reviewed_at_ms)
    .bind(&parsed.device_id)
    .bind(parsed.reviewed_at_ms)
    .execute(&mut **tx)
    .await?;

    if inserted.rows_affected() == 0 {
        return Ok(ApplyOutcome::SkippedDuplicate);
    }
    Ok(ApplyOutcome::Applied)
}

async fn apply_learning_item(
    tx: &mut Transaction<'_, Sqlite>,
    record: &RemoteSyncRecord,
) -> Result<ApplyOutcome> {
    if matches!(record.operation, Some(SyncOperation::Delete)) {
        sqlx::query("DELETE FROM learning_items WHERE id = ?1")
            .bind(&record.record_id)
            .execute(&mut **tx)
            .await?;
        return Ok(ApplyOutcome::Applied);
    }

    #[derive(serde::Deserialize)]
    struct ItemPayload {
        id: String,
        question: String,
        answer: Option<String>,
        due_date: String,
        algorithm_type: String,
    }

    let parsed: ItemPayload = serde_json::from_slice(&record.payload)
        .map_err(|e| PlethoraError::Internal(format!("Learning item payload decode failed: {e}")))?;

    let existing_hlc: Option<String> =
        sqlx::query_scalar("SELECT updated_at FROM learning_items WHERE id = ?1")
            .bind(&parsed.id)
            .fetch_optional(&mut **tx)
            .await?;

    if let Some(existing) = existing_hlc.as_deref() {
        if !hlc_gt(&record.hlc, existing) {
            return Ok(ApplyOutcome::SkippedOlder);
        }
    }

    let due_date = DateTime::parse_from_rfc3339(&parsed.due_date)
        .map_err(|e| PlethoraError::Internal(format!("Invalid item due date: {e}")))?
        .with_timezone(&Utc);

    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM learning_items WHERE id = ?1")
        .bind(&parsed.id)
        .fetch_optional(&mut **tx)
        .await?;

    if exists.is_some() {
        sqlx::query(
            r#"
            UPDATE learning_items
            SET question = ?1,
                answer = COALESCE(?2, answer),
                due_date = ?3,
                algorithm_type = ?4,
                updated_at = ?5,
                date_modified = datetime('now')
            WHERE id = ?6
            "#,
        )
        .bind(&parsed.question)
        .bind(&parsed.answer)
        .bind(due_date)
        .bind(&parsed.algorithm_type)
        .bind(record.hlc.as_str())
        .bind(&parsed.id)
        .execute(&mut **tx)
        .await?;
    } else if matches!(record.operation, Some(SyncOperation::Create)) {
        sqlx::query(
            r#"
            INSERT INTO learning_items (
                id, collection_id, item_type, question, answer, difficulty, interval,
                ease_factor, due_date, date_created, date_modified, review_count, lapses,
                state, is_suspended, tags, algorithm_type, updated_at
            ) VALUES (
                ?1, '00000000-0000-0000-0000-000000000001', 'flashcard', ?2, ?3, 3, 0,
                2.5, ?4, datetime('now'), datetime('now'), 0, 0,
                'new', 0, '[]', ?5, ?6
            )
            "#,
        )
        .bind(&parsed.id)
        .bind(&parsed.question)
        .bind(&parsed.answer)
        .bind(due_date)
        .bind(&parsed.algorithm_type)
        .bind(record.hlc.as_str())
        .execute(&mut **tx)
        .await?;
    } else {
        return Ok(ApplyOutcome::SkippedOlder);
    }

    Ok(ApplyOutcome::Applied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hlc_orders_by_physical_then_logical() {
        assert!(hlc_gt("200:1", "100:9"));
        assert!(hlc_gt("100:2", "100:1"));
        assert!(!hlc_gt("100:1", "100:2"));
    }
}
