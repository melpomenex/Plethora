//! Durable local journal primitives for progressive sync.
//!
//! These commands intentionally do not know about Yjs. They provide an
//! idempotent, bounded persistence boundary that the frontend scheduler can
//! drain and project without making startup depend on a provider or relay.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use tauri::State;

use crate::commands::Result;
use crate::database::Repository;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SyncOutboxRow {
    pub operation_id: String,
    pub domain: String,
    pub entity_key: String,
    pub operation: String,
    pub payload: Option<String>,
    pub clock: String,
    pub payload_hash: Option<String>,
    pub created_at: String,
    pub attempts: i64,
    pub status: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SyncInboxRow {
    pub operation_id: String,
    pub domain: String,
    pub entity_key: String,
    pub operation: String,
    pub payload: Option<String>,
    pub received_at: String,
    pub applied_at: Option<String>,
    pub status: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SyncCheckpoint {
    pub domain: String,
    pub cursor: Option<String>,
    pub shard: Option<String>,
    pub updated_at: String,
}

#[tauri::command]
pub async fn enqueue_sync_outbox(
    operation_id: String,
    domain: String,
    entity_key: String,
    operation: String,
    payload: Option<String>,
    clock: String,
    payload_hash: Option<String>,
    repo: State<'_, Repository>,
) -> Result<SyncOutboxRow> {
    let created_at = Utc::now().to_rfc3339();
    // Mutable rows are coalesced before insert; immutable review/event
    // operations retain every record. This keeps rapid position/setting/card
    // edits from ballooning the durable journal while preserving history.
    if operation != "append" && operation != "review" {
        sqlx::query("UPDATE sync_outbox SET status = 'coalesced' WHERE domain = ?1 AND entity_key = ?2 AND status = 'pending'")
            .bind(&domain).bind(&entity_key).execute(repo.pool()).await?;
    }
    sqlx::query(
        "INSERT INTO sync_outbox (operation_id, domain, entity_key, operation, payload, clock, payload_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(operation_id) DO NOTHING",
    )
    .bind(&operation_id)
    .bind(&domain)
    .bind(&entity_key)
    .bind(&operation)
    .bind(&payload)
    .bind(&clock)
    .bind(&payload_hash)
    .bind(&created_at)
    .execute(repo.pool())
    .await?;

    Ok(sqlx::query_as::<_, SyncOutboxRow>(
        "SELECT operation_id, domain, entity_key, operation, payload, clock, payload_hash, created_at, attempts, status, last_error FROM sync_outbox WHERE operation_id = ?1",
    )
    .bind(&operation_id)
    .fetch_one(repo.pool())
    .await?)
}

#[tauri::command]
pub async fn get_sync_outbox(limit: i64, repo: State<'_, Repository>) -> Result<Vec<SyncOutboxRow>> {
    let limit = limit.clamp(1, 500);
    Ok(sqlx::query_as::<_, SyncOutboxRow>(
        "SELECT operation_id, domain, entity_key, operation, payload, clock, payload_hash, created_at, attempts, status, last_error FROM sync_outbox WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?1",
    )
    .bind(limit)
    .fetch_all(repo.pool())
    .await?)
}

#[tauri::command]
pub async fn mark_sync_outbox_sent(operation_ids: Vec<String>, repo: State<'_, Repository>) -> Result<u64> {
    if operation_ids.is_empty() { return Ok(0); }
    let mut tx = repo.pool().begin().await?;
    let mut changed = 0;
    for id in operation_ids {
        changed += sqlx::query("UPDATE sync_outbox SET status = 'sent', attempts = attempts + 1 WHERE operation_id = ?1")
            .bind(id).execute(&mut *tx).await?.rows_affected();
    }
    tx.commit().await?;
    Ok(changed)
}

#[tauri::command]
pub async fn record_sync_inbox(
    operation_id: String,
    domain: String,
    entity_key: String,
    operation: String,
    payload: Option<String>,
    repo: State<'_, Repository>,
) -> Result<bool> {
    let result = sqlx::query(
        "INSERT INTO sync_inbox (operation_id, domain, entity_key, operation, payload, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(operation_id) DO NOTHING",
    )
    .bind(operation_id)
    .bind(domain)
    .bind(entity_key)
    .bind(operation)
    .bind(payload)
    .bind(Utc::now().to_rfc3339())
    .execute(repo.pool())
    .await?;
    Ok(result.rows_affected() > 0)
}

#[tauri::command]
pub async fn get_pending_sync_inbox(limit: i64, repo: State<'_, Repository>) -> Result<Vec<SyncInboxRow>> {
    let limit = limit.clamp(1, 500);
    Ok(sqlx::query_as::<_, SyncInboxRow>(
        "SELECT operation_id, domain, entity_key, operation, payload, received_at, applied_at, status, last_error FROM sync_inbox WHERE status = 'pending' ORDER BY received_at ASC LIMIT ?1",
    )
    .bind(limit)
    .fetch_all(repo.pool())
    .await?)
}

#[tauri::command]
pub async fn mark_sync_inbox_applied(
    operation_id: String,
    domain: String,
    entity_key: String,
    projection_hash: Option<String>,
    repo: State<'_, Repository>,
) -> Result<bool> {
    let mut tx = repo.pool().begin().await?;
    let applied_at = Utc::now().to_rfc3339();
    let inserted = sqlx::query(
        "INSERT OR IGNORE INTO sync_applied_operations (operation_id, domain, entity_key, projection_hash, applied_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&operation_id).bind(&domain).bind(&entity_key).bind(&projection_hash).bind(&applied_at)
    .execute(&mut *tx).await?.rows_affected() > 0;
    sqlx::query("UPDATE sync_inbox SET status = 'applied', applied_at = ?2, last_error = NULL WHERE operation_id = ?1")
        .bind(&operation_id).bind(&applied_at).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(inserted)
}

#[tauri::command]
pub async fn set_sync_checkpoint(
    domain: String,
    cursor: Option<String>,
    shard: Option<String>,
    repo: State<'_, Repository>,
) -> Result<SyncCheckpoint> {
    let updated_at = Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO sync_checkpoints (domain, cursor, shard, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(domain) DO UPDATE SET cursor = excluded.cursor, shard = excluded.shard, updated_at = excluded.updated_at")
        .bind(&domain).bind(&cursor).bind(&shard).bind(&updated_at).execute(repo.pool()).await?;
    Ok(sqlx::query_as::<_, SyncCheckpoint>("SELECT domain, cursor, shard, updated_at FROM sync_checkpoints WHERE domain = ?1")
        .bind(domain).fetch_one(repo.pool()).await?)
}

#[tauri::command]
pub async fn get_sync_checkpoint(domain: String, repo: State<'_, Repository>) -> Result<Option<SyncCheckpoint>> {
    Ok(sqlx::query_as::<_, SyncCheckpoint>("SELECT domain, cursor, shard, updated_at FROM sync_checkpoints WHERE domain = ?1")
        .bind(domain).fetch_optional(repo.pool()).await?)
}

#[tauri::command]
pub async fn dead_letter_sync_operation(
    operation_id: String,
    domain: String,
    payload: Option<String>,
    error: String,
    repo: State<'_, Repository>,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO sync_dead_letters (operation_id, domain, payload, error, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(operation_id).bind(domain).bind(payload).bind(error).bind(now).execute(repo.pool()).await?;
    Ok(())
}
