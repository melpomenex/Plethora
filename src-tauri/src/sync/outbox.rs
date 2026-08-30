use super::clock::next_hlc;
use super::device::ensure_device_id;
use super::registry::{is_syncable, operation_allowed};
use super::types::{EntityType, OutboxEntry, SyncOperation, SyncOutboxStatus};
use crate::error::{PlethoraError, Result};
use sqlx::{Pool, Sqlite, Transaction};
use uuid::Uuid;

/// Journal a syncable mutation inside the caller's open SQLite transaction.
pub async fn mark_dirty(
    tx: &mut Transaction<'_, Sqlite>,
    entity_type: EntityType,
    entity_id: &str,
    operation: SyncOperation,
    base_revision: Option<i64>,
    payload: Vec<u8>,
) -> Result<OutboxEntry> {
    if !is_syncable(entity_type) {
        return Err(PlethoraError::InvalidInput(format!(
            "Entity type {} is not syncable",
            entity_type.as_str()
        )));
    }
    if !operation_allowed(entity_type, operation) {
        return Err(PlethoraError::InvalidInput(format!(
            "Operation {} is not allowed for {}",
            operation.as_str(),
            entity_type.as_str()
        )));
    }

    let device_id = ensure_device_id(tx).await?;
    let hlc = next_hlc(tx).await?;
    let change_id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().timestamp_millis();

    // The current client merge model is deterministic whole-entity LWW.
    // Sending a server revision precondition for ordinary updates would turn
    // multiple legitimate offline edits from one device into false conflicts
    // (both were created from the same observed revision). Keep the server
    // revision locally for diagnostics/future field merges, but only assert
    // revision zero for a genuinely new entity.
    let observed_revision: Option<i64> = sqlx::query_scalar(
        "SELECT server_revision FROM sync_entity_state WHERE entity_type = ?1 AND entity_id = ?2",
    )
    .bind(entity_type.as_str())
    .bind(entity_id)
    .fetch_optional(&mut **tx)
    .await?
    .flatten();
    let effective_base_revision =
        if matches!(operation, SyncOperation::Create) && base_revision == Some(0) {
            Some(0)
        } else {
            None
        };

    sqlx::query(
        r#"
        INSERT INTO sync_outbox (
            change_id, entity_type, entity_id, operation, base_revision,
            payload, hlc, created_at, attempt_count, last_attempt_at, sync_status
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, NULL, 'pending')
        "#,
    )
    .bind(&change_id)
    .bind(entity_type.as_str())
    .bind(entity_id)
    .bind(operation.as_str())
    .bind(effective_base_revision)
    .bind(&payload)
    .bind(&hlc)
    .bind(created_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to write sync outbox: {e}")))?;

    sqlx::query(
        r#"
        INSERT INTO sync_entity_state (
            entity_type, entity_id, last_hlc, last_device_id,
            server_revision, tombstoned, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
            last_hlc = excluded.last_hlc,
            last_device_id = excluded.last_device_id,
            server_revision = COALESCE(sync_entity_state.server_revision, excluded.server_revision),
            tombstoned = excluded.tombstoned,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(entity_type.as_str())
    .bind(entity_id)
    .bind(&hlc)
    .bind(&device_id)
    .bind(observed_revision.or(effective_base_revision))
    .bind(i64::from(matches!(operation, SyncOperation::Delete)))
    .bind(created_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to update sync entity state: {e}")))?;

    Ok(OutboxEntry {
        change_id,
        entity_type,
        entity_id: entity_id.to_string(),
        operation,
        base_revision: effective_base_revision,
        payload,
        hlc,
        created_at,
        sync_status: SyncOutboxStatus::Pending,
    })
}

pub async fn count_pending(pool: &Pool<Sqlite>) -> Result<usize> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_outbox WHERE sync_status IN ('pending', 'failed', 'uploading')",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to count sync outbox: {e}")))?;
    Ok(count as usize)
}

pub async fn acknowledge_changes(pool: &Pool<Sqlite>, change_ids: &[String]) -> Result<usize> {
    if change_ids.is_empty() {
        return Ok(0);
    }

    let mut updated = 0usize;
    for change_id in change_ids {
        let rows = sqlx::query(
            "UPDATE sync_outbox SET sync_status = 'acknowledged' WHERE change_id = ?1",
        )
        .bind(change_id)
        .execute(pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to ack outbox row: {e}")))?
        .rows_affected();
        updated += rows as usize;
    }
    Ok(updated)
}

pub async fn drain_pending_batch(
    pool: &Pool<Sqlite>,
    max_batch: usize,
) -> Result<Vec<OutboxEntry>> {
    let rows = sqlx::query_as::<_, (String, String, String, String, Option<i64>, Vec<u8>, String, i64, String)>(
        r#"
        SELECT change_id, entity_type, entity_id, operation, base_revision,
               payload, hlc, created_at, sync_status
        FROM sync_outbox
        WHERE sync_status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?1
        "#,
    )
    .bind(max_batch as i64)
    .fetch_all(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to drain sync outbox: {e}")))?;

    let mut entries = Vec::with_capacity(rows.len());
    for row in rows {
        let entity_type = EntityType::parse(&row.1).ok_or_else(|| {
            PlethoraError::Internal(format!("Unknown entity_type in outbox: {}", row.1))
        })?;
        let operation = match row.3.as_str() {
            "create" => SyncOperation::Create,
            "update" => SyncOperation::Update,
            "delete" => SyncOperation::Delete,
            "append_event" => SyncOperation::AppendEvent,
            other => {
                return Err(PlethoraError::Internal(format!(
                    "Unknown operation in outbox: {other}"
                )))
            }
        };
        let sync_status = SyncOutboxStatus::parse(&row.8).unwrap_or(SyncOutboxStatus::Pending);
        entries.push(OutboxEntry {
            change_id: row.0,
            entity_type,
            entity_id: row.2,
            operation,
            base_revision: row.4,
            payload: row.5,
            hlc: row.6,
            created_at: row.7,
            sync_status,
        });
    }
    Ok(entries)
}

pub fn learning_item_revision(updated_at: Option<&str>) -> Option<i64> {
    updated_at.and_then(super::bootstrap::revision_from_rfc3339)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory pool");
        run_migrations(&pool).await.expect("migrations");
        pool
    }

    #[tokio::test]
    async fn mark_dirty_commits_with_domain_write() {
        let pool = test_pool().await;
        let mut tx = pool.begin().await.expect("begin");

        sqlx::query(
            "INSERT INTO collections (id, name, icon, color, created_at, modified_at) VALUES ('col-1', 'Test', '', '', datetime('now'), datetime('now'))",
        )
        .execute(&mut *tx)
        .await
        .expect("collection");

        sqlx::query(
            r#"
            INSERT INTO learning_items (
                id, collection_id, item_type, question, answer, difficulty, interval,
                ease_factor, due_date, date_created, date_modified, review_count, lapses,
                state, is_suspended, tags, algorithm_type, updated_at
            ) VALUES (
                'item-1', 'col-1', 'flashcard', 'Q', 'A', 3, 0,
                2.5, datetime('now'), datetime('now'), datetime('now'), 0, 0,
                'new', 0, '[]', 'fsrs', datetime('now')
            )
            "#,
        )
        .execute(&mut *tx)
        .await
        .expect("item");

        let entry = mark_dirty(
            &mut tx,
            EntityType::LearningItem,
            "item-1",
            SyncOperation::Create,
            Some(0),
            br#"{"id":"item-1"}"#.to_vec(),
        )
        .await
        .expect("mark dirty");

        tx.commit().await.expect("commit");

        assert_eq!(entry.entity_id, "item-1");
        assert_eq!(entry.sync_status, SyncOutboxStatus::Pending);

        let pending: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_outbox WHERE sync_status = 'pending'",
        )
        .fetch_one(&pool)
        .await
        .expect("count");
        assert_eq!(pending, 1);
    }

    #[tokio::test]
    async fn rollback_drops_outbox_row() {
        let pool = test_pool().await;
        let mut tx = pool.begin().await.expect("begin");

        mark_dirty(
            &mut tx,
            EntityType::ReviewResult,
            "rev-1",
            SyncOperation::AppendEvent,
            None,
            br#"{"id":"rev-1"}"#.to_vec(),
        )
        .await
        .expect("mark dirty");

        tx.rollback().await.expect("rollback");

        let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox")
            .fetch_one(&pool)
            .await
            .expect("count");
        assert_eq!(pending, 0);
    }

    #[tokio::test]
    async fn review_append_event_journals_deterministic_payload() {
        let pool = test_pool().await;
        let mut tx = pool.begin().await.expect("begin");

        let payload = br#"{"id":"rev-abc","item_id":"item-1","reviewed_at_ms":1234567890,"device_id":"dev-1"}"#.to_vec();
        let entry = mark_dirty(
            &mut tx,
            EntityType::ReviewResult,
            "rev-abc",
            SyncOperation::AppendEvent,
            None,
            payload.clone(),
        )
        .await
        .expect("mark dirty");

        tx.commit().await.expect("commit");

        assert_eq!(entry.operation, SyncOperation::AppendEvent);
        assert_eq!(entry.payload, payload);
        assert!(!entry.hlc.is_empty());
    }

    #[tokio::test]
    async fn acknowledge_moves_pending_to_acknowledged() {
        let pool = test_pool().await;
        let mut tx = pool.begin().await.expect("begin");
        let entry = mark_dirty(
            &mut tx,
            EntityType::LearningItem,
            "item-2",
            SyncOperation::Update,
            Some(42),
            br#"{}"#.to_vec(),
        )
        .await
        .expect("mark dirty");
        tx.commit().await.expect("commit");

        let updated = acknowledge_changes(&pool, &[entry.change_id.clone()])
            .await
            .expect("ack");
        assert_eq!(updated, 1);

        let status: String = sqlx::query_scalar(
            "SELECT sync_status FROM sync_outbox WHERE change_id = ?1",
        )
        .bind(&entry.change_id)
        .fetch_one(&pool)
        .await
        .expect("status");
        assert_eq!(status, "acknowledged");

        let pending = count_pending(&pool).await.expect("pending");
        assert_eq!(pending, 0);
    }

    #[tokio::test]
    async fn large_outbox_backlog_count_query_scales() {
        let pool = test_pool().await;
        for index in 0..500 {
            let mut tx = pool.begin().await.expect("begin");
            mark_dirty(
                &mut tx,
                EntityType::LearningItem,
                &format!("item-{index}"),
                SyncOperation::Update,
                Some(0),
                br#"{"id":"x"}"#.to_vec(),
            )
            .await
            .expect("mark dirty");
            tx.commit().await.expect("commit");
        }
        let count = count_pending(&pool).await.expect("count");
        assert_eq!(count, 500);
    }
}
