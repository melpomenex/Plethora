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
    let tables: [(&str, EntityType); 8] = [
        ("collections", EntityType::Collection),
        ("tags", EntityType::Tag),
        ("documents", EntityType::Document),
        ("image_assets", EntityType::ImageAsset),
        ("extracts", EntityType::Extract),
        ("learning_items", EntityType::LearningItem),
        ("review_results", EntityType::ReviewResult),
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
            // A record pulled from the cloud is already represented remotely.
            // Re-uploading it during bootstrap wastes bandwidth and, for
            // append-only histories, can manufacture avoidable duplicates.
            let already_remote: Option<i64> = sqlx::query_scalar(
                "SELECT 1 FROM sync_entity_state WHERE entity_type = ?1 AND entity_id = ?2 AND server_revision IS NOT NULL LIMIT 1",
            )
            .bind(entity_type.as_str())
            .bind(&entity_id)
            .fetch_optional(&mut *tx)
            .await?;
            if already_remote.is_some() {
                completed += 1;
                next_entity = Some(table.to_string());
                next_id = Some(entity_id);
                continue;
            }

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

            let Some(payload) = build_bootstrap_payload(&mut tx, entity_type, &entity_id).await?
            else {
                completed += 1;
                next_entity = Some(table.to_string());
                next_id = Some(entity_id);
                continue;
            };
            // Append-only histories (review results) must stage as appends;
            // everything else re-stages as a whole-entity update.
            let staging_op = super::registry::staging_operation(entity_type)
                .unwrap_or(SyncOperation::Update);
            journal_entity(
                &mut tx,
                entity_type,
                &entity_id,
                staging_op,
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
            let row = sqlx::query("SELECT * FROM documents WHERE id = ?1")
                .bind(entity_id)
                .fetch_one(&mut **tx)
                .await?;
            let document = crate::database::Repository::row_to_document(&row)?;
            Ok(Some(payload::document_payload(&document).map_err(|e| {
                PlethoraError::Internal(format!("Bootstrap document payload: {e}"))
            })?))
        }
        EntityType::ReviewResult => {
            let row = sqlx::query_as::<
                _,
                (
                    String,
                    String,
                    Option<String>,
                    String,
                    i32,
                    i32,
                    String,
                    f64,
                    f64,
                    i64,
                    String,
                ),
            >(
                r#"
                SELECT id, collection_id, session_id, item_id, rating, time_taken,
                       COALESCE(new_due_date, timestamp),
                       -- new_interval is declared INTEGER; whole-day FSRS
                       -- intervals are stored with integer affinity and sqlx
                       -- refuses to decode them as f64 without a cast.
                       CAST(new_interval AS REAL), CAST(new_ease_factor AS REAL),
                       COALESCE(reviewed_at_ms, CAST(strftime('%s', timestamp) AS INTEGER) * 1000),
                       COALESCE(device_id, 'legacy-bootstrap')
                FROM review_results WHERE id = ?1
                "#,
            )
            .bind(entity_id)
            .fetch_one(&mut **tx)
            .await?;
            let item_row = sqlx::query("SELECT * FROM learning_items WHERE id = ?1")
                .bind(&row.3)
                .fetch_optional(&mut **tx)
                .await?;
            let post_item = item_row
                .as_ref()
                .map(crate::database::Repository::row_to_learning_item)
                .transpose()?;
            Ok(Some(
                payload::review_result_payload_with_item(
                    &row.0,
                    &row.3,
                    &row.1,
                    row.4,
                    row.5,
                    &chrono::DateTime::parse_from_rfc3339(&row.6)
                        .map(|value| value.with_timezone(&chrono::Utc))
                        .unwrap_or_else(|_| chrono::Utc::now()),
                    row.7,
                    row.8,
                    row.9,
                    &row.10,
                    row.2.as_deref(),
                    post_item.as_ref(),
                )
                .map_err(|e| PlethoraError::Internal(format!("Bootstrap review payload: {e}")))?,
            ))
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
            Ok(Some(payload::setting_payload(&row.0, &row.1).map_err(
                |e| PlethoraError::Internal(format!("Bootstrap setting payload: {e}")),
            )?))
        }
        EntityType::ImageAsset => {
            let row = sqlx::query(
                r#"
                SELECT id, mime_type, file_name, content, byte_size, sha256,
                       width, height, created_at, updated_at, metadata
                FROM image_assets WHERE id = ?1
                "#,
            )
            .bind(entity_id)
            .fetch_one(&mut **tx)
            .await?;
            use sqlx::Row;
            let asset = crate::models::ImageAsset {
                id: row.try_get("id")?,
                mime_type: row.try_get("mime_type")?,
                file_name: row.try_get("file_name")?,
                content: row.try_get("content")?,
                byte_size: row.try_get("byte_size")?,
                sha256: row.try_get("sha256")?,
                width: row.try_get("width")?,
                height: row.try_get("height")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
                metadata: row.try_get("metadata")?,
            };
            Ok(Some(super::image_sync::local_payload(&asset)?))
        }
        EntityType::LearningItem => {
            let row = sqlx::query("SELECT * FROM learning_items WHERE id = ?1")
                .bind(entity_id)
                .fetch_one(&mut **tx)
                .await?;
            let item = crate::database::Repository::row_to_learning_item(&row)?;
            Ok(Some(payload::learning_item_payload(&item).map_err(
                |e| PlethoraError::Internal(format!("Bootstrap learning item payload: {e}")),
            )?))
        }
        EntityType::Extract => {
            let row = sqlx::query("SELECT * FROM extracts WHERE id = ?1")
                .bind(entity_id)
                .fetch_one(&mut **tx)
                .await?;
            let extract = crate::database::Repository::row_to_extract(&row)?;
            Ok(Some(payload::extract_payload(&extract).map_err(|e| {
                PlethoraError::Internal(format!("Bootstrap extract payload: {e}"))
            })?))
        }
        EntityType::Collection => {
            let row =
                sqlx::query_as::<_, (String, String, Option<String>, Option<String>, String)>(
                    "SELECT id, name, icon, color, modified_at FROM collections WHERE id = ?1",
                )
                .bind(entity_id)
                .fetch_one(&mut **tx)
                .await?;
            Ok(Some(
                serde_json::to_vec(&serde_json::json!({
                    "schema_version": 1,
                    "entity_type": "collection",
                    "id": row.0,
                    "name": row.1,
                    "icon": row.2,
                    "color": row.3,
                    "date_modified": row.4,
                }))
                .map_err(|e| {
                    PlethoraError::Internal(format!("Bootstrap collection payload: {e}"))
                })?,
            ))
        }
        EntityType::Tag => {
            let row = sqlx::query_as::<_, (String, String, String, f64, String)>(
                "SELECT id, name, prerequisites, maturity_threshold, date_modified FROM tags WHERE id = ?1",
            )
            .bind(entity_id)
            .fetch_one(&mut **tx)
            .await?;
            let prerequisites: Vec<String> = serde_json::from_str(&row.2).unwrap_or_default();
            Ok(Some(
                serde_json::to_vec(&serde_json::json!({
                    "schema_version": 1,
                    "entity_type": "tag",
                    "id": row.0,
                    "name": row.1,
                    "prerequisites": prerequisites,
                    "maturity_threshold": row.3,
                    "date_modified": row.4,
                }))
                .map_err(|e| PlethoraError::Internal(format!("Bootstrap tag payload: {e}")))?,
            ))
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
            .expect("memory database");
        run_migrations(&pool).await.expect("migrations");
        pool
    }

    // review_results.new_interval is declared INTEGER: whole-day FSRS
    // intervals are stored with integer affinity, and decoding the column as
    // f64 (sqlx is strict about storage classes) used to abort the whole
    // bootstrap with "mismatched types" on the first fresh-device scan.
    #[tokio::test]
    async fn review_payload_decodes_integer_stored_interval() {
        let pool = test_pool().await;
        seed_review_environment(&pool).await;

        // Bind 7 (not 7.0) so SQLite stores the INTEGER storage class.
        let storage: String = sqlx::query_scalar("SELECT typeof(new_interval) FROM review_results WHERE id = 'rev-1'")
            .fetch_one(&pool)
            .await
            .expect("storage class");
        assert_eq!(storage, "integer");

        let mut tx = pool.begin().await.expect("begin");
        let payload = build_bootstrap_payload(&mut tx, EntityType::ReviewResult, "rev-1")
            .await
            .expect("bootstrap payload");
        let payload = payload.expect("payload present");
        let parsed: serde_json::Value = serde_json::from_slice(&payload).expect("payload json");
        assert_eq!(parsed["new_interval"], serde_json::json!(7.0));
        assert_eq!(parsed["new_ease_factor"], serde_json::json!(2.5));
    }

    // A fresh device stages its whole local library through the bootstrap
    // scan. Review results are append-only: staging them as `Update` was
    // rejected by the outbox operation guard and aborted the first
    // "Sync Now" with "Operation update is not allowed for review_result".
    #[tokio::test]
    async fn bootstrap_scan_stages_review_results_as_append_events() {
        let pool = test_pool().await;
        seed_review_environment(&pool).await;

        let progress = bootstrap_upload_scan(&pool).await.expect("bootstrap scan");
        assert!(
            progress.phase != "error",
            "bootstrap scan must not fail on review results: {:?}",
            progress
        );

        let staged: Vec<(String, String)> =
            sqlx::query_as("SELECT entity_type, operation FROM sync_outbox")
                .fetch_all(&pool)
                .await
                .expect("outbox");
        let review = staged
            .iter()
            .find(|(entity_type, _)| entity_type == "review_result")
            .expect("review result staged");
        assert_eq!(review.1, "append_event");
    }

    async fn seed_review_environment(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            INSERT INTO learning_items (
                id, item_type, question, answer, due_date, algorithm_type,
                interval, ease_factor, date_created, date_modified
            ) VALUES (
                'item-1', 'basic', 'Q', 'A', '2026-01-01T00:00:00Z', 'fsrs',
                1.0, 2.5, datetime('now'), datetime('now')
            )
            "#,
        )
        .execute(pool)
        .await
        .expect("seed item");

        sqlx::query(
            r#"
            INSERT INTO review_results (
                id, session_id, item_id, rating, time_taken,
                new_due_date, new_interval, new_ease_factor, timestamp
            ) VALUES (
                'rev-1', NULL, 'item-1', 3, 5,
                '2026-01-02T00:00:00Z', 7, 2.5, '2026-01-01T00:00:00Z'
            )
            "#,
        )
        .execute(pool)
        .await
        .expect("seed review");
    }
}
