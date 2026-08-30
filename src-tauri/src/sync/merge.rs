use crate::error::{PlethoraError, Result};
use chrono::{DateTime, Utc};
use sqlx::{Sqlite, Transaction};

use super::settings::is_syncable_setting_key;
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

fn sync_order_gt(left_hlc: &str, left_device: &str, right_hlc: &str, right_device: &str) -> bool {
    let left = parse_hlc(left_hlc);
    let right = parse_hlc(right_hlc);
    left > right || (left == right && left_device > right_device)
}

async fn incoming_wins(
    tx: &mut Transaction<'_, Sqlite>,
    record: &RemoteSyncRecord,
) -> Result<bool> {
    let existing = sqlx::query_as::<_, (String, String)>(
        "SELECT last_hlc, last_device_id FROM sync_entity_state WHERE entity_type = ?1 AND entity_id = ?2",
    )
    .bind(record.entity_type.as_str())
    .bind(&record.record_id)
    .fetch_optional(&mut **tx)
    .await?;

    Ok(existing
        .map(|(hlc, device)| sync_order_gt(&record.hlc, &record.device_id, &hlc, &device))
        .unwrap_or(true))
}

async fn record_sync_state(
    tx: &mut Transaction<'_, Sqlite>,
    record: &RemoteSyncRecord,
    tombstoned: bool,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO sync_entity_state (
            entity_type, entity_id, last_hlc, last_device_id,
            server_revision, tombstoned, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
            last_hlc = excluded.last_hlc,
            last_device_id = excluded.last_device_id,
            server_revision = COALESCE(excluded.server_revision, sync_entity_state.server_revision),
            tombstoned = excluded.tombstoned,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(record.entity_type.as_str())
    .bind(&record.record_id)
    .bind(&record.hlc)
    .bind(&record.device_id)
    .bind(record.entity_revision)
    .bind(i64::from(tombstoned))
    .bind(chrono::Utc::now().timestamp_millis())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn apply_remote_record(
    tx: &mut Transaction<'_, Sqlite>,
    local_device_id: &str,
    record: &RemoteSyncRecord,
) -> Result<ApplyOutcome> {
    // Receiving any valid remote record advances the local logical clock,
    // even when the payload itself is stale or an echo of our own push.
    super::clock::observe_hlc(tx, &record.hlc).await?;

    if record.device_id == local_device_id {
        // Pulling our own accepted change is still useful: it teaches the
        // client the server-assigned revision for the next local mutation.
        if let Some(revision) = record.entity_revision {
            sqlx::query(
                "UPDATE sync_entity_state SET server_revision = ?3, updated_at = ?4 WHERE entity_type = ?1 AND entity_id = ?2",
            )
            .bind(record.entity_type.as_str())
            .bind(&record.record_id)
            .bind(revision)
            .bind(chrono::Utc::now().timestamp_millis())
            .execute(&mut **tx)
            .await?;
        }
        return Ok(ApplyOutcome::SkippedDuplicate);
    }

    // Review events are immutable set members: every distinct event is kept.
    if record.entity_type == EntityType::ReviewResult {
        return apply_review_result(tx, record).await;
    }

    // All mutable entities share one deterministic ordering rule. This is
    // independent of domain timestamps and leaves a durable tombstone marker,
    // preventing a stale offline update from resurrecting a deleted entity.
    if !incoming_wins(tx, record).await? {
        return Ok(ApplyOutcome::SkippedOlder);
    }

    let outcome = match record.entity_type {
        EntityType::ReviewResult => unreachable!(),
        EntityType::LearningItem => apply_learning_item(tx, record).await,
        EntityType::Document => apply_document(tx, record).await,
        EntityType::Extract => apply_extract(tx, record).await,
        EntityType::Collection => apply_collection(tx, record).await,
        EntityType::Tag => apply_tag(tx, record).await,
        EntityType::Setting => apply_setting(tx, record).await,
        EntityType::Tombstone => apply_tombstone(tx, record).await,
    }?;

    if outcome == ApplyOutcome::Applied {
        record_sync_state(
            tx,
            record,
            matches!(record.operation, Some(SyncOperation::Delete)),
        )
        .await?;
    }

    Ok(outcome)
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

fn remote_wins(record_hlc: &str, local_modified: DateTime<Utc>) -> bool {
    let (physical, _) = parse_hlc(record_hlc);
    physical > local_modified.timestamp_millis()
}

async fn apply_document(
    tx: &mut Transaction<'_, Sqlite>,
    record: &RemoteSyncRecord,
) -> Result<ApplyOutcome> {
    if matches!(record.operation, Some(SyncOperation::Delete)) {
        sqlx::query("DELETE FROM documents WHERE id = ?1")
            .bind(&record.record_id)
            .execute(&mut **tx)
            .await?;
        return Ok(ApplyOutcome::Applied);
    }

    #[derive(serde::Deserialize)]
    struct DocumentPayload {
        id: String,
        collection_id: String,
        title: String,
        category: Option<String>,
        tags: Vec<String>,
        position_json: Option<String>,
        progress_percent: Option<f64>,
        current_page: Option<i32>,
        current_scroll_percent: Option<f64>,
        current_cfi: Option<String>,
        is_archived: bool,
        is_favorite: bool,
        is_dismissed: bool,
        date_modified: String,
    }

    let parsed: DocumentPayload = match serde_json::from_slice(&record.payload) {
        Ok(full) => full,
        Err(_) => {
            #[derive(serde::Deserialize)]
            struct DocumentPositionPayload {
                id: String,
                position_json: Option<String>,
                progress_percent: Option<f64>,
                current_page: Option<i32>,
                current_scroll_percent: Option<f64>,
                current_cfi: Option<String>,
                date_modified: String,
            }

            let position: DocumentPositionPayload = serde_json::from_slice(&record.payload)
                .map_err(|e| PlethoraError::Internal(format!("Document payload decode failed: {e}")))?;

            let local_modified: Option<DateTime<Utc>> =
                sqlx::query_scalar("SELECT date_modified FROM documents WHERE id = ?1")
                    .bind(&position.id)
                    .fetch_optional(&mut **tx)
                    .await?;

            if let Some(local) = local_modified {
                if !remote_wins(&record.hlc, local) {
                    return Ok(ApplyOutcome::SkippedOlder);
                }
            }

            let date_modified = DateTime::parse_from_rfc3339(&position.date_modified)
                .map(|ts| ts.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());

            sqlx::query(
                r#"
                UPDATE documents SET
                    position_json = COALESCE(?1, position_json),
                    progress_percent = COALESCE(?2, progress_percent),
                    current_page = COALESCE(?3, current_page),
                    current_scroll_percent = COALESCE(?4, current_scroll_percent),
                    current_cfi = COALESCE(?5, current_cfi),
                    date_modified = ?6
                WHERE id = ?7
                "#,
            )
            .bind(&position.position_json)
            .bind(position.progress_percent)
            .bind(position.current_page)
            .bind(position.current_scroll_percent)
            .bind(&position.current_cfi)
            .bind(date_modified)
            .bind(&position.id)
            .execute(&mut **tx)
            .await?;

            return Ok(ApplyOutcome::Applied);
        }
    };

    let local_modified: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT date_modified FROM documents WHERE id = ?1")
            .bind(&parsed.id)
            .fetch_optional(&mut **tx)
            .await?;

    if let Some(local) = local_modified {
        if !remote_wins(&record.hlc, local) {
            return Ok(ApplyOutcome::SkippedOlder);
        }
    }

    let tags_json = serde_json::to_string(&parsed.tags).map_err(|e| {
        PlethoraError::Internal(format!("Document tags encode failed: {e}"))
    })?;
    let date_modified = DateTime::parse_from_rfc3339(&parsed.date_modified)
        .map(|ts| ts.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM documents WHERE id = ?1")
        .bind(&parsed.id)
        .fetch_optional(&mut **tx)
        .await?;

    if exists.is_some() {
        sqlx::query(
            r#"
            UPDATE documents SET
                collection_id = ?1,
                title = ?2,
                category = ?3,
                tags = ?4,
                position_json = COALESCE(?5, position_json),
                progress_percent = COALESCE(?6, progress_percent),
                current_page = COALESCE(?7, current_page),
                current_scroll_percent = COALESCE(?8, current_scroll_percent),
                current_cfi = COALESCE(?9, current_cfi),
                is_archived = ?10,
                is_favorite = ?11,
                is_dismissed = ?12,
                date_modified = ?13
            WHERE id = ?14
            "#,
        )
        .bind(&parsed.collection_id)
        .bind(&parsed.title)
        .bind(&parsed.category)
        .bind(&tags_json)
        .bind(&parsed.position_json)
        .bind(parsed.progress_percent)
        .bind(parsed.current_page)
        .bind(parsed.current_scroll_percent)
        .bind(&parsed.current_cfi)
        .bind(parsed.is_archived)
        .bind(parsed.is_favorite)
        .bind(parsed.is_dismissed)
        .bind(date_modified)
        .bind(&parsed.id)
        .execute(&mut **tx)
        .await?;
    } else if matches!(record.operation, Some(SyncOperation::Create)) {
        sqlx::query(
            r#"
            INSERT INTO documents (
                id, collection_id, title, file_path, file_type, category, tags,
                position_json, progress_percent, current_page, current_scroll_percent, current_cfi,
                is_archived, is_favorite, is_dismissed, date_added, date_modified,
                extract_count, learning_item_count, priority_rating, priority_slider, priority_score
            ) VALUES (
                ?1, ?2, ?3, '', 'other', ?4, ?5,
                ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15,
                0, 0, 0, 50, 0
            )
            "#,
        )
        .bind(&parsed.id)
        .bind(&parsed.collection_id)
        .bind(&parsed.title)
        .bind(&parsed.category)
        .bind(&tags_json)
        .bind(&parsed.position_json)
        .bind(parsed.progress_percent)
        .bind(parsed.current_page)
        .bind(parsed.current_scroll_percent)
        .bind(&parsed.current_cfi)
        .bind(parsed.is_archived)
        .bind(parsed.is_favorite)
        .bind(parsed.is_dismissed)
        .bind(date_modified)
        .bind(date_modified)
        .execute(&mut **tx)
        .await?;
    } else {
        return Ok(ApplyOutcome::SkippedOlder);
    }

    Ok(ApplyOutcome::Applied)
}

async fn apply_extract(
    tx: &mut Transaction<'_, Sqlite>,
    record: &RemoteSyncRecord,
) -> Result<ApplyOutcome> {
    if matches!(record.operation, Some(SyncOperation::Delete)) {
        sqlx::query("DELETE FROM extracts WHERE id = ?1")
            .bind(&record.record_id)
            .execute(&mut **tx)
            .await?;
        return Ok(ApplyOutcome::Applied);
    }

    #[derive(serde::Deserialize)]
    struct ExtractPayload {
        id: String,
        collection_id: String,
        document_id: String,
        content: String,
        html_content: Option<String>,
        notes: Option<String>,
        highlight_color: Option<String>,
        tags: Vec<String>,
        category: Option<String>,
        selection_context: Option<serde_json::Value>,
        date_modified: String,
    }

    let parsed: ExtractPayload = serde_json::from_slice(&record.payload)
        .map_err(|e| PlethoraError::Internal(format!("Extract payload decode failed: {e}")))?;

    let local_modified: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT date_modified FROM extracts WHERE id = ?1")
            .bind(&parsed.id)
            .fetch_optional(&mut **tx)
            .await?;

    if let Some(local) = local_modified {
        if !remote_wins(&record.hlc, local) {
            return Ok(ApplyOutcome::SkippedOlder);
        }
    }

    let tags_json = serde_json::to_string(&parsed.tags).map_err(|e| {
        PlethoraError::Internal(format!("Extract tags encode failed: {e}"))
    })?;
    let selection_context_json = parsed
        .selection_context
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| PlethoraError::Internal(format!("Extract selection encode failed: {e}")))?;
    let date_modified = DateTime::parse_from_rfc3339(&parsed.date_modified)
        .map(|ts| ts.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM extracts WHERE id = ?1")
        .bind(&parsed.id)
        .fetch_optional(&mut **tx)
        .await?;

    if exists.is_some() {
        sqlx::query(
            r#"
            UPDATE extracts SET
                collection_id = ?1,
                content = ?2,
                html_content = ?3,
                notes = ?4,
                highlight_color = ?5,
                tags = ?6,
                category = ?7,
                selection_context = ?8,
                date_modified = ?9
            WHERE id = ?10
            "#,
        )
        .bind(&parsed.collection_id)
        .bind(&parsed.content)
        .bind(&parsed.html_content)
        .bind(&parsed.notes)
        .bind(&parsed.highlight_color)
        .bind(&tags_json)
        .bind(&parsed.category)
        .bind(&selection_context_json)
        .bind(date_modified)
        .bind(&parsed.id)
        .execute(&mut **tx)
        .await?;
    } else if matches!(record.operation, Some(SyncOperation::Create)) {
        sqlx::query(
            r#"
            INSERT INTO extracts (
                id, collection_id, document_id, content, html_content, notes, highlight_color,
                tags, category, selection_context, date_created, date_modified,
                progressive_disclosure_level, max_disclosure_level, review_count, reps
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, ?11, ?12,
                0, 0, 0, 0
            )
            "#,
        )
        .bind(&parsed.id)
        .bind(&parsed.collection_id)
        .bind(&parsed.document_id)
        .bind(&parsed.content)
        .bind(&parsed.html_content)
        .bind(&parsed.notes)
        .bind(&parsed.highlight_color)
        .bind(&tags_json)
        .bind(&parsed.category)
        .bind(&selection_context_json)
        .bind(date_modified)
        .bind(date_modified)
        .execute(&mut **tx)
        .await?;
    } else {
        return Ok(ApplyOutcome::SkippedOlder);
    }

    Ok(ApplyOutcome::Applied)
}

async fn apply_collection(
    tx: &mut Transaction<'_, Sqlite>,
    record: &RemoteSyncRecord,
) -> Result<ApplyOutcome> {
    if matches!(record.operation, Some(SyncOperation::Delete)) {
        sqlx::query("DELETE FROM collections WHERE id = ?1 AND id != '00000000-0000-0000-0000-000000000001'")
            .bind(&record.record_id)
            .execute(&mut **tx)
            .await?;
        return Ok(ApplyOutcome::Applied);
    }

    #[derive(serde::Deserialize)]
    struct CollectionPayload {
        id: String,
        name: String,
        icon: Option<String>,
        color: Option<String>,
        date_modified: String,
    }

    let parsed: CollectionPayload = serde_json::from_slice(&record.payload).map_err(|e| {
        PlethoraError::Internal(format!("Collection payload decode failed: {e}"))
    })?;

    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM collections WHERE id = ?1")
        .bind(&parsed.id)
        .fetch_optional(&mut **tx)
        .await?;

    let modified = DateTime::parse_from_rfc3339(&parsed.date_modified)
        .map(|ts| ts.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    if exists.is_some() {
        sqlx::query(
            "UPDATE collections SET name = ?1, icon = ?2, color = ?3, modified_at = ?4 WHERE id = ?5",
        )
        .bind(&parsed.name)
        .bind(&parsed.icon)
        .bind(&parsed.color)
        .bind(modified)
        .bind(&parsed.id)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO collections (id, name, icon, color, created_at, modified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&parsed.id)
        .bind(&parsed.name)
        .bind(&parsed.icon)
        .bind(&parsed.color)
        .bind(modified)
        .bind(modified)
        .execute(&mut **tx)
        .await?;
    }

    Ok(ApplyOutcome::Applied)
}

async fn apply_tag(
    tx: &mut Transaction<'_, Sqlite>,
    record: &RemoteSyncRecord,
) -> Result<ApplyOutcome> {
    if matches!(record.operation, Some(SyncOperation::Delete)) {
        sqlx::query("DELETE FROM tags WHERE id = ?1")
            .bind(&record.record_id)
            .execute(&mut **tx)
            .await?;
        return Ok(ApplyOutcome::Applied);
    }

    #[derive(serde::Deserialize)]
    struct TagPayload {
        id: String,
        name: String,
        prerequisites: Vec<String>,
        maturity_threshold: f64,
        date_modified: String,
    }

    let parsed: TagPayload = serde_json::from_slice(&record.payload)
        .map_err(|e| PlethoraError::Internal(format!("Tag payload decode failed: {e}")))?;

    let prereqs_json = serde_json::to_string(&parsed.prerequisites).map_err(|e| {
        PlethoraError::Internal(format!("Tag prerequisites encode failed: {e}"))
    })?;

    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM tags WHERE id = ?1")
        .bind(&parsed.id)
        .fetch_optional(&mut **tx)
        .await?;

    if exists.is_some() {
        sqlx::query(
            "UPDATE tags SET name = ?1, prerequisites = ?2, maturity_threshold = ?3, date_modified = ?4 WHERE id = ?5",
        )
        .bind(&parsed.name)
        .bind(&prereqs_json)
        .bind(parsed.maturity_threshold)
        .bind(&parsed.date_modified)
        .bind(&parsed.id)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            r#"
            INSERT INTO tags (id, name, prerequisites, maturity_threshold, item_count, mature_count, date_created, date_modified)
            VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6)
            "#,
        )
        .bind(&parsed.id)
        .bind(&parsed.name)
        .bind(&prereqs_json)
        .bind(parsed.maturity_threshold)
        .bind(&parsed.date_modified)
        .bind(&parsed.date_modified)
        .execute(&mut **tx)
        .await?;
    }

    Ok(ApplyOutcome::Applied)
}

async fn apply_setting(
    tx: &mut Transaction<'_, Sqlite>,
    record: &RemoteSyncRecord,
) -> Result<ApplyOutcome> {
    if matches!(record.operation, Some(SyncOperation::Delete)) {
        #[derive(serde::Deserialize)]
        struct DeleteSetting {
            key: String,
        }
        if let Ok(parsed) = serde_json::from_slice::<DeleteSetting>(&record.payload) {
            sqlx::query("DELETE FROM settings WHERE key = ?1")
                .bind(&parsed.key)
                .execute(&mut **tx)
                .await?;
        }
        return Ok(ApplyOutcome::Applied);
    }

    #[derive(serde::Deserialize)]
    struct SettingPayload {
        key: String,
        value: String,
        date_modified: String,
    }

    let parsed: SettingPayload = serde_json::from_slice(&record.payload)
        .map_err(|e| PlethoraError::Internal(format!("Setting payload decode failed: {e}")))?;

    if !is_syncable_setting_key(&parsed.key) {
        return Ok(ApplyOutcome::SkippedOlder);
    }

    sqlx::query(
        r#"
        INSERT INTO settings (key, value, date_modified) VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, date_modified = excluded.date_modified
        "#,
    )
    .bind(&parsed.key)
    .bind(&parsed.value)
    .bind(&parsed.date_modified)
    .execute(&mut **tx)
    .await?;

    Ok(ApplyOutcome::Applied)
}

async fn apply_tombstone(
    tx: &mut Transaction<'_, Sqlite>,
    record: &RemoteSyncRecord,
) -> Result<ApplyOutcome> {
    #[derive(serde::Deserialize)]
    struct TombstonePayload {
        target_entity_type: String,
        target_entity_id: String,
    }

    let parsed: TombstonePayload = serde_json::from_slice(&record.payload).map_err(|e| {
        PlethoraError::Internal(format!("Tombstone payload decode failed: {e}"))
    })?;

    match parsed.target_entity_type.as_str() {
        "document" | "documents" => {
            sqlx::query("DELETE FROM documents WHERE id = ?1")
                .bind(&parsed.target_entity_id)
                .execute(&mut **tx)
                .await?;
        }
        "extract" | "extracts" => {
            sqlx::query("DELETE FROM extracts WHERE id = ?1")
                .bind(&parsed.target_entity_id)
                .execute(&mut **tx)
                .await?;
        }
        "learning_item" | "learning_items" => {
            sqlx::query("DELETE FROM learning_items WHERE id = ?1")
                .bind(&parsed.target_entity_id)
                .execute(&mut **tx)
                .await?;
        }
        "collection" | "collections" => {
            sqlx::query(
                "DELETE FROM collections WHERE id = ?1 AND id != '00000000-0000-0000-0000-000000000001'",
            )
            .bind(&parsed.target_entity_id)
            .execute(&mut **tx)
            .await?;
        }
        "tag" | "tags" => {
            sqlx::query("DELETE FROM tags WHERE id = ?1")
                .bind(&parsed.target_entity_id)
                .execute(&mut **tx)
                .await?;
        }
        _ => {}
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
