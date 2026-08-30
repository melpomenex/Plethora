use crate::error::{PlethoraError, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

use super::journal::{journal_entity, notify_after_commit};
use super::outbox::count_pending;
use super::payload::{self, timestamp_revision};
use super::settings::is_syncable_setting_key;
use super::types::{EntityType, SyncOperation};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapProgress {
    pub phase: String,
    pub total_entities: u64,
    pub completed_entities: u64,
    pub cursor_entity: Option<String>,
    pub cursor_id: Option<String>,
}

const BOOTSTRAP_BATCH: i64 = 100;

fn table_id_column(table: &str) -> &'static str {
    if table == "settings" {
        "key"
    } else {
        "id"
    }
}

async fn load_bootstrap_state(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
) -> Result<(String, Option<String>, Option<String>, i64, i64)> {
    let row = sqlx::query_as::<_, (String, Option<String>, Option<String>, i64, i64)>(
        "SELECT phase, cursor_entity, cursor_id, total_entities, completed_entities FROM sync_bootstrap WHERE id = 1",
    )
    .fetch_optional(&mut **tx)
    .await?;

    Ok(row.unwrap_or_else(|| ("idle".to_string(), None, None, 0, 0)))
}

pub async fn bootstrap_upload_scan(pool: &Pool<Sqlite>) -> Result<BootstrapProgress> {
    let mut tx = pool.begin().await?;
    let (phase, cursor_entity, cursor_id, total_entities, mut completed) =
        load_bootstrap_state(&mut tx).await?;

    if phase == "complete" {
        tx.commit().await?;
        return Ok(BootstrapProgress {
            phase,
            total_entities: total_entities as u64,
            completed_entities: completed as u64,
            cursor_entity,
            cursor_id,
        });
    }

    // Parent/reference entities must be published before their children.
    // This keeps the initial log replay valid even on databases that enforce
    // collection/document foreign keys.
    let tables: [(&str, EntityType); 6] = [
        ("collections", EntityType::Collection),
        ("tags", EntityType::Tag),
        ("documents", EntityType::Document),
        ("extracts", EntityType::Extract),
        ("learning_items", EntityType::LearningItem),
        ("settings", EntityType::Setting),
    ];

    let mut next_entity = cursor_entity;
    let mut next_id = cursor_id;
    let mut scanned = 0i64;
    let mut total = if total_entities > 0 {
        total_entities
    } else {
        let mut sum = 0i64;
        for (table, _) in tables {
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&mut *tx)
                .await?;
            sum += count;
        }
        sum
    };

    'outer: for (table, entity_type) in tables {
        if let Some(ref cursor) = next_entity {
            if cursor.as_str() != table {
                continue;
            }
        }

        let id_column = table_id_column(table);
        let rows: Vec<(String,)> = if let Some(ref id) = next_id {
            sqlx::query_as(&format!(
                "SELECT {id_column} FROM {table} WHERE {id_column} > ?1 ORDER BY {id_column} ASC LIMIT ?2"
            ))
            .bind(id)
            .bind(BOOTSTRAP_BATCH - scanned)
            .fetch_all(&mut *tx)
            .await?
        } else {
            sqlx::query_as(&format!(
                "SELECT {id_column} FROM {table} ORDER BY {id_column} ASC LIMIT ?1"
            ))
            .bind(BOOTSTRAP_BATCH - scanned)
            .fetch_all(&mut *tx)
            .await?
        };

        for (entity_id,) in rows {
            let already_acked: Option<i64> = sqlx::query_scalar(
                r#"
                SELECT 1 FROM sync_outbox
                WHERE entity_type = ?1 AND entity_id = ?2 AND sync_status = 'acknowledged'
                LIMIT 1
                "#,
            )
            .bind(entity_type.as_str())
            .bind(&entity_id)
            .fetch_optional(&mut *tx)
            .await?;

            if already_acked.is_some() {
                completed += 1;
                next_entity = Some(table.to_string());
                next_id = Some(entity_id);
                continue;
            }

            let Some(payload) = build_bootstrap_payload(&mut tx, entity_type, &entity_id).await? else {
                completed += 1;
                next_entity = Some(table.to_string());
                next_id = Some(entity_id);
                continue;
            };
            journal_entity(
                &mut tx,
                entity_type,
                &entity_id,
                SyncOperation::Update,
                Some(0),
                payload,
            )
            .await?;
            completed += 1;
            scanned += 1;
            next_entity = Some(table.to_string());
            next_id = Some(entity_id);
            if scanned >= BOOTSTRAP_BATCH {
                break 'outer;
            }
        }

        next_entity = None;
        next_id = None;
    }

    let phase = if completed >= total {
        "complete".to_string()
    } else {
        "upload".to_string()
    };

    sqlx::query(
        r#"
        INSERT INTO sync_bootstrap (id, phase, cursor_entity, cursor_id, total_entities, completed_entities, updated_at)
        VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(id) DO UPDATE SET
            phase = excluded.phase,
            cursor_entity = excluded.cursor_entity,
            cursor_id = excluded.cursor_id,
            total_entities = excluded.total_entities,
            completed_entities = excluded.completed_entities,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&phase)
    .bind(&next_entity)
    .bind(&next_id)
    .bind(total)
    .bind(completed)
    .bind(chrono::Utc::now().timestamp_millis())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    notify_after_commit();

    Ok(BootstrapProgress {
        phase,
        total_entities: total as u64,
        completed_entities: completed as u64,
        cursor_entity: next_entity,
        cursor_id: next_id,
    })
}

async fn build_bootstrap_payload(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    entity_type: EntityType,
    entity_id: &str,
) -> Result<Option<Vec<u8>>> {
    match entity_type {
        EntityType::Document => {
            let row = sqlx::query_as::<_, (String, String, String, Option<String>, String, Option<String>, Option<f64>, Option<i32>, Option<f64>, Option<String>, i64, i64, i64, String)>(
                r#"
                SELECT id, collection_id, title, category, tags, position_json, progress_percent,
                       current_page, current_scroll_percent, current_cfi,
                       is_archived, is_favorite, is_dismissed, date_modified
                FROM documents WHERE id = ?1
                "#,
            )
            .bind(entity_id)
            .fetch_one(&mut **tx)
            .await?;
            let tags: Vec<String> = serde_json::from_str(&row.4).unwrap_or_default();
            Ok(Some(serde_json::to_vec(&serde_json::json!({
                "schema_version": 1,
                "entity_type": "document",
                "id": row.0,
                "collection_id": row.1,
                "title": row.2,
                "category": row.3,
                "tags": tags,
                "position_json": row.5,
                "progress_percent": row.6,
                "current_page": row.7,
                "current_scroll_percent": row.8,
                "current_cfi": row.9,
                "is_archived": row.10 != 0,
                "is_favorite": row.11 != 0,
                "is_dismissed": row.12 != 0,
                "date_modified": row.13,
            })).map_err(|e| PlethoraError::Internal(format!("Bootstrap document payload: {e}")))?))
        }
        EntityType::Setting => {
            let row = sqlx::query_as::<_, (String, String)>(
                "SELECT key, value FROM settings WHERE key = ?1",
            )
            .bind(entity_id)
            .fetch_one(&mut **tx)
            .await?;
            if !is_syncable_setting_key(&row.0) {
                return Ok(None);
            }
            Ok(Some(
                payload::setting_payload(&row.0, &row.1)
                    .map_err(|e| PlethoraError::Internal(format!("Bootstrap setting payload: {e}")))?,
            ))
        }
        EntityType::LearningItem => {
            let row = sqlx::query_as::<_, (String, String, String, Option<String>, String, String, Option<String>)>(
                "SELECT id, collection_id, question, answer, due_date, algorithm_type, updated_at FROM learning_items WHERE id = ?1",
            )
            .bind(entity_id)
            .fetch_one(&mut **tx)
            .await?;
            Ok(Some(serde_json::to_vec(&serde_json::json!({
                "schema_version": 1,
                "entity_type": "learning_item",
                "id": row.0,
                "collection_id": row.1,
                "question": row.2,
                "answer": row.3,
                "due_date": row.4,
                "algorithm_type": row.5,
                "updated_at": row.6,
            })).map_err(|e| PlethoraError::Internal(format!("Bootstrap learning item payload: {e}")))?))
        }
        EntityType::Extract => {
            let row = sqlx::query_as::<_, (String, String, String, String, Option<String>, Option<String>, Option<String>, String, Option<String>, Option<String>, String)>(
                "SELECT id, collection_id, document_id, content, html_content, notes, highlight_color, tags, category, selection_context, date_modified FROM extracts WHERE id = ?1",
            )
            .bind(entity_id)
            .fetch_one(&mut **tx)
            .await?;
            let tags: Vec<String> = serde_json::from_str(&row.7).unwrap_or_default();
            Ok(Some(serde_json::to_vec(&serde_json::json!({
                "schema_version": 1,
                "entity_type": "extract",
                "id": row.0,
                "collection_id": row.1,
                "document_id": row.2,
                "content": row.3,
                "html_content": row.4,
                "notes": row.5,
                "highlight_color": row.6,
                "tags": tags,
                "category": row.8,
                "selection_context": row.9.as_ref().and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok()),
                "date_modified": row.10,
            })).map_err(|e| PlethoraError::Internal(format!("Bootstrap extract payload: {e}")))?))
        }
        EntityType::Collection => {
            let row = sqlx::query_as::<_, (String, String, Option<String>, Option<String>, String)>(
                "SELECT id, name, icon, color, modified_at FROM collections WHERE id = ?1",
            )
            .bind(entity_id)
            .fetch_one(&mut **tx)
            .await?;
            Ok(Some(serde_json::to_vec(&serde_json::json!({
                "schema_version": 1,
                "entity_type": "collection",
                "id": row.0,
                "name": row.1,
                "icon": row.2,
                "color": row.3,
                "date_modified": row.4,
            })).map_err(|e| PlethoraError::Internal(format!("Bootstrap collection payload: {e}")))?))
        }
        EntityType::Tag => {
            let row = sqlx::query_as::<_, (String, String, String, f64, String)>(
                "SELECT id, name, prerequisites, maturity_threshold, date_modified FROM tags WHERE id = ?1",
            )
            .bind(entity_id)
            .fetch_one(&mut **tx)
            .await?;
            let prerequisites: Vec<String> = serde_json::from_str(&row.2).unwrap_or_default();
            Ok(Some(serde_json::to_vec(&serde_json::json!({
                "schema_version": 1,
                "entity_type": "tag",
                "id": row.0,
                "name": row.1,
                "prerequisites": prerequisites,
                "maturity_threshold": row.3,
                "date_modified": row.4,
            })).map_err(|e| PlethoraError::Internal(format!("Bootstrap tag payload: {e}")))?))
        }
        _ => Ok(None),
    }
}

pub async fn bootstrap_download_ready(pool: &Pool<Sqlite>) -> Result<bool> {
    let cursor: i64 = sqlx::query_scalar("SELECT last_server_cursor FROM sync_cursor WHERE id = 1")
        .fetch_optional(pool)
        .await?
        .unwrap_or(0);
    let pending = count_pending(pool).await?;
    Ok(cursor == 0 && pending == 0)
}

pub fn revision_from_rfc3339(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|ts| timestamp_revision(ts.with_timezone(&chrono::Utc)))
}
