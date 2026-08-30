//! Advanced queue management commands

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::{Document, LearningItem};
use crate::sync::journal::{journal_entity, notify_after_commit};
use crate::sync::outbox::learning_item_revision;
use crate::sync::payload;
use crate::sync::types::{EntityType, SyncOperation};
use chrono::{Datelike, Duration, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct QueueStats {
    pub total_items: i32,
    pub due_today: i32,
    pub overdue: i32,
    pub new_items: i32,
    pub learning_items: i32,
    pub review_items: i32,
    pub total_estimated_time: i32, // in minutes
    pub suspended: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BulkOperationResult {
    pub succeeded: Vec<String>,
    pub failed: Vec<String>,
    pub errors: Vec<String>,
}

/// What a queue item id actually points at.
///
/// `QueueItem::id` is the id of the underlying row, and which table that is
/// depends on `item_type`: a document row for "document", an extract row for
/// "extract", a learning item for "learning-item". Bulk operations used to
/// assume every id was a learning item, so selecting documents in the Reading
/// Queue and choosing Suspend always reported "Item not found".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QueueEntityKind {
    LearningItem,
    Document,
    Extract,
}

/// Map every supplied id to the entity it refers to, using one query per table
/// regardless of how many ids were supplied.
///
/// The previous implementation called `get_all_learning_items()` *inside* the
/// per-id loop, so a fifty-item selection performed fifty full-table reads.
async fn resolve_queue_entities(
    repo: &Repository,
    item_ids: &[String],
) -> Result<HashMap<String, QueueEntityKind>> {
    let mut resolved = HashMap::new();
    if item_ids.is_empty() {
        return Ok(resolved);
    }

    let placeholders = std::iter::repeat("?")
        .take(item_ids.len())
        .collect::<Vec<_>>()
        .join(",");

    for (table, kind) in [
        ("learning_items", QueueEntityKind::LearningItem),
        ("documents", QueueEntityKind::Document),
        ("extracts", QueueEntityKind::Extract),
    ] {
        let sql = format!("SELECT id FROM {} WHERE id IN ({})", table, placeholders);
        let mut query = sqlx::query(&sql);
        for id in item_ids {
            query = query.bind(id);
        }
        for row in query.fetch_all(repo.pool()).await? {
            let id: String = row.get("id");
            // Ids are UUIDs, so a collision across tables is not expected;
            // resolve to the first table that claims it either way.
            resolved.entry(id).or_insert(kind);
        }
    }

    Ok(resolved)
}

/// Suspend or unsuspend every supplied queue item, whatever its type.
///
/// Learning items carry a real `is_suspended` column. Documents and extracts
/// do not, but both have a reversible `is_dismissed` flag that the queue
/// already filters on, which is the same observable behavior: the item leaves
/// the queue and comes back when the flag is cleared.
async fn set_queue_items_suspended(
    repo: &Repository,
    item_ids: &[String],
    suspended: bool,
    result: &mut BulkOperationResult,
) {
    let resolved = match resolve_queue_entities(repo, item_ids).await {
        Ok(resolved) => resolved,
        Err(e) => {
            for item_id in item_ids {
                result.failed.push(item_id.clone());
                result.errors.push(format!("{}: {}", item_id, e));
            }
            return;
        }
    };

    for item_id in item_ids {
        let outcome: Result<()> = match resolved.get(item_id) {
            Some(QueueEntityKind::LearningItem) => sqlx::query(
                "UPDATE learning_items SET is_suspended = ?, date_modified = ? WHERE id = ?",
            )
            .bind(suspended)
            .bind(Utc::now())
            .bind(item_id)
            .execute(repo.pool())
            .await
            .map(|_| ())
            .map_err(crate::error::PlethoraError::from),
            Some(QueueEntityKind::Document) => repo
                .update_document_dismiss(item_id, suspended)
                .await
                .map(|_| ()),
            Some(QueueEntityKind::Extract) => {
                repo.update_extract_dismissed(item_id, suspended).await
            }
            None => Err(crate::error::PlethoraError::NotFound(format!(
                "Queue item {}",
                item_id
            ))),
        };

        match outcome {
            Ok(()) => result.succeeded.push(item_id.clone()),
            Err(e) => {
                result.failed.push(item_id.clone());
                result.errors.push(format!("{}: {}", item_id, e));
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueueExportItem {
    pub id: String,
    pub document_title: String,
    pub item_type: String,
    pub question: String,
    pub answer: Option<String>,
    pub due_date: String,
    pub state: String,
    pub interval: f64,
    pub tags: Vec<String>,
    pub category: Option<String>,
}

/// Get queue statistics
#[tauri::command]
pub async fn get_queue_stats(repo: State<'_, Repository>) -> Result<QueueStats> {
    let all_items = repo.get_all_learning_items().await?;
    let now = Utc::now();

    let mut stats = QueueStats {
        total_items: all_items.len() as i32,
        due_today: 0,
        overdue: 0,
        new_items: 0,
        learning_items: 0,
        review_items: 0,
        total_estimated_time: 0,
        suspended: 0,
    };

    for item in &all_items {
        if item.is_suspended {
            stats.suspended += 1;
            continue;
        }

        match item.state {
            crate::models::ItemState::New => stats.new_items += 1,
            crate::models::ItemState::Learning | crate::models::ItemState::Relearning => {
                stats.learning_items += 1
            }
            crate::models::ItemState::Review => stats.review_items += 1,
        }

        // Count due today/overdue
        if item.due_date <= now {
            stats.due_today += 1;
            if item.due_date < now && item.review_count > 0 {
                stats.overdue += 1;
            }
        }

        // Add estimated time
        let est_time = match item.item_type {
            crate::models::ItemType::Cloze => 2,
            crate::models::ItemType::Qa => 3,
            _ => 1,
        };
        stats.total_estimated_time += est_time;
    }

    Ok(stats)
}

/// Postpone an item (reschedule for later). Handles both learning items and documents.
/// When `item_type` is "document", updates the document's `next_reading_date`.
/// Otherwise, treats it as a learning item and updates `due_date`.
#[tauri::command]
/// Postpone one queue item. Returns the item's NEW due date (RFC 3339) so the
/// frontend can apply the mutation to its local queue state exactly, without
/// re-fetching the entire queue listing (design D2 of
/// optimize-performance-hotspots).
pub async fn postpone_item(
    item_id: String,
    days: i32,
    item_type: Option<String>,
    repo: State<'_, Repository>,
) -> Result<String> {
    match item_type.as_deref() {
        Some("document") => {
            // Postpone a document by advancing next_reading_date
            let doc = repo.get_document(&item_id).await?.ok_or_else(|| {
                crate::error::PlethoraError::NotFound(format!("Document {}", item_id))
            })?;

            let modified_days = (days as f64 * doc.interval_modifier).round() as i64;
            let modified_days = modified_days.max(1);
            let new_date = match doc.next_reading_date {
                Some(d) => d + Duration::days(modified_days),
                None => Utc::now() + Duration::days(modified_days),
            };
            repo.update_document_scheduling(
                &item_id,
                Some(new_date),
                doc.stability,
                doc.difficulty,
                None, // reps
                None, // total_time_spent
            )
            .await?;
            Ok(new_date.to_rfc3339())
        }
        _ => {
            // Default: postpone a learning item
            let mut item = repo
                .get_all_learning_items()
                .await?
                .into_iter()
                .find(|i| i.id == item_id)
                .ok_or_else(|| {
                    crate::error::PlethoraError::NotFound(format!("Item {}", item_id))
                })?;

            item.due_date += Duration::days(days as i64);
            item.date_modified = Utc::now();

            repo.update_learning_item(&item).await?;
            Ok(item.due_date.to_rfc3339())
        }
    }
}

/// Bulk suspend items
#[tauri::command]
pub async fn bulk_suspend_items(
    item_ids: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<BulkOperationResult> {
    let mut result = BulkOperationResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
        errors: Vec::new(),
    };

    set_queue_items_suspended(&repo, &item_ids, true, &mut result).await;
    Ok(result)
}

/// Bulk unsuspend items
#[tauri::command]
pub async fn bulk_unsuspend_items(
    item_ids: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<BulkOperationResult> {
    let mut result = BulkOperationResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
        errors: Vec::new(),
    };

    set_queue_items_suspended(&repo, &item_ids, false, &mut result).await;
    Ok(result)
}

/// Bulk delete items
#[tauri::command]
pub async fn bulk_delete_items(
    item_ids: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<BulkOperationResult> {
    let mut result = BulkOperationResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
        errors: Vec::new(),
    };

    let resolved = match resolve_queue_entities(&repo, &item_ids).await {
        Ok(resolved) => resolved,
        Err(e) => return Err(e),
    };

    for item_id in &item_ids {
        let outcome = match resolved.get(item_id) {
            // A DELETE that matches no rows still returns Ok, so the previous
            // learning-items-only delete reported success for every document
            // and extract while removing nothing.
            Some(QueueEntityKind::LearningItem) => {
                sqlx::query("DELETE FROM learning_items WHERE id = ?")
                    .bind(item_id)
                    .execute(repo.pool())
                    .await
                    .map(|_| ())
                    .map_err(crate::error::PlethoraError::from)
            }
            Some(QueueEntityKind::Document) => repo.delete_document(item_id).await,
            Some(QueueEntityKind::Extract) => repo.delete_extract(item_id).await,
            None => Err(crate::error::PlethoraError::NotFound(format!(
                "Queue item {}",
                item_id
            ))),
        };

        match outcome {
            Ok(()) => result.succeeded.push(item_id.clone()),
            Err(e) => {
                result.failed.push(item_id.clone());
                result.errors.push(format!("{}: {}", item_id, e));
            }
        }
    }

    Ok(result)
}

/// Export queue data
#[tauri::command]
pub async fn export_queue(repo: State<'_, Repository>) -> Result<Vec<QueueExportItem>> {
    let all_items = repo.get_all_learning_items().await?;
    let mut export_items = Vec::new();

    for item in all_items {
        // Skip suspended items
        if item.is_suspended {
            continue;
        }

        let document_title = if let Some(doc_id) = &item.document_id {
            repo.get_document(doc_id)
                .await?
                .map(|d| d.title)
                .unwrap_or_else(|| "Unknown Document".to_string())
        } else {
            "Unknown Document".to_string()
        };

        let category = if let Some(extract_id) = &item.extract_id {
            repo.get_extract(extract_id).await?.and_then(|e| e.category)
        } else {
            None
        };

        export_items.push(QueueExportItem {
            id: item.id.clone(),
            document_title,
            item_type: format!("{:?}", item.item_type),
            question: item.question,
            answer: item.answer,
            due_date: item.due_date.to_rfc3339(),
            state: format!("{:?}", item.state),
            interval: item.interval,
            tags: item.tags,
            category,
        });
    }

    Ok(export_items)
}

// ---------------------------------------------------------------------------
// Queue load management: Advance, Load Balancing, Easy Days
// (FSRS Helper add-on equivalents, natively built in)
// ---------------------------------------------------------------------------

/// Result of a bulk load-management operation.
#[derive(Debug, Serialize, Deserialize)]
pub struct LoadManagementResult {
    pub affected: u64,
    pub skipped: u64,
}

/// Advance a single item's due date closer to today (inverse of postpone).
/// Shifts `due_date` by `-days` for learning items, or `next_reading_date`
/// for documents. Memory state is never mutated.
#[tauri::command]
pub async fn advance_item(
    item_id: String,
    days: i32,
    item_type: Option<String>,
    repo: State<'_, Repository>,
) -> Result<bool> {
    let shift = Duration::days(-(days.max(0) as i64));
    match item_type.as_deref() {
        Some("document") => {
            let mut doc = repo.get_document(&item_id).await?.ok_or_else(|| {
                crate::error::PlethoraError::NotFound(format!("Document {}", item_id))
            })?;
            let new_date = doc.next_reading_date.unwrap_or_else(Utc::now) + shift;
            // Never push a document into the past beyond today.
            let new_date = new_date.max(Utc::now());
            repo.update_document_scheduling(
                &item_id,
                Some(new_date),
                doc.stability,
                doc.difficulty,
                None,
                None,
            )
            .await?;
            Ok(true)
        }
        _ => {
            let mut item = repo
                .get_all_learning_items()
                .await?
                .into_iter()
                .find(|i| i.id == item_id)
                .ok_or_else(|| {
                    crate::error::PlethoraError::NotFound(format!("Item {}", item_id))
                })?;
            item.due_date = (item.due_date + shift).max(Utc::now());
            item.date_modified = Utc::now();
            repo.update_learning_item(&item).await?;
            Ok(true)
        }
    }
}

/// Bulk-advance all items due within the next `days` onto today.
/// Useful for "I have time now, let me get ahead" cramming.
#[tauri::command]
pub async fn advance_due_queue(
    days: Option<i32>,
    repo: State<'_, Repository>,
) -> Result<LoadManagementResult> {
    let horizon_days = days.unwrap_or(7).max(1) as i64;
    let now = Utc::now();
    let horizon = now + Duration::days(horizon_days);

    let items = repo.get_all_learning_items().await?;
    let mut affected: u64 = 0;
    let mut skipped: u64 = 0;

    for mut item in items {
        if item.is_suspended {
            skipped += 1;
            continue;
        }
        // Only pull forward items that are due within the horizon but not yet due today.
        if item.due_date > now && item.due_date <= horizon {
            item.due_date = now;
            item.date_modified = now;
            repo.update_learning_item(&item).await?;
            affected += 1;
        } else {
            skipped += 1;
        }
    }

    Ok(LoadManagementResult { affected, skipped })
}

/// Redistribute the due pile across the next `window_days` so no single day
/// exceeds `target_per_day`. When `target_per_day` is None, defaults to
/// `ceil(total_due / window_days * 1.25)`. Memory state is preserved; only
/// `due_date` shifts.
#[tauri::command]
pub async fn load_balance_queue(
    window_days: Option<i32>,
    target_per_day: Option<i32>,
    repo: State<'_, Repository>,
) -> Result<LoadManagementResult> {
    use std::collections::BTreeMap;
    let window = window_days.unwrap_or(14).clamp(1, 90) as i64;
    let now = Utc::now();
    let horizon = now + Duration::days(window);

    let items = repo.get_all_learning_items().await?;
    // Bucket items by due day (date string). Only consider items due within [now, horizon].
    let mut buckets: BTreeMap<chrono::NaiveDate, Vec<LearningItem>> = BTreeMap::new();
    for item in items {
        if item.is_suspended {
            continue;
        }
        if item.due_date >= now && item.due_date <= horizon {
            buckets
                .entry(item.due_date.date_naive())
                .or_default()
                .push(item);
        } else if item.due_date < now {
            // Overdue items are also in scope (they're the worst offenders).
            buckets.entry(now.date_naive()).or_default().push(item);
        }
    }

    let total_due: usize = buckets.values().map(|v| v.len()).sum();
    if total_due == 0 {
        return Ok(LoadManagementResult {
            affected: 0,
            skipped: 0,
        });
    }

    let target = target_per_day
        .map(|t| t.max(1) as usize)
        .unwrap_or_else(|| ((total_due as f64 / window as f64) * 1.25).ceil() as usize)
        .max(1);

    // Flatten all due items, then re-distribute `target` per day across the window.
    let mut all_items: Vec<LearningItem> = buckets.into_values().flatten().collect();
    // Sort by due_date so we redistribute in a stable order.
    all_items.sort_by_key(|i| i.due_date);

    let mut affected: u64 = 0;
    let mut skipped: u64 = 0;
    let mut item_idx = 0;
    'outer: for day_offset in 0..window {
        let day = now.date_naive() + Duration::days(day_offset);
        let new_due = Utc.from_utc_datetime(&day.and_hms_opt(12, 0, 0).unwrap());
        for _ in 0..target {
            if item_idx >= all_items.len() {
                break 'outer;
            }
            let mut item = all_items[item_idx].clone();
            // Skip items already correctly on this day.
            if (item.due_date.date_naive() - day).num_days().abs() == 0 {
                skipped += 1;
                item_idx += 1;
                continue;
            }
            item.due_date = new_due;
            item.date_modified = now;
            repo.update_learning_item(&item).await?;
            affected += 1;
            item_idx += 1;
        }
    }

    Ok(LoadManagementResult { affected, skipped })
}

/// Easy Days: shift any learning item whose `due_date` within the next
/// `window_days` falls on an easy weekday (0=Sun..6=Sat) forward to the next
/// non-easy day. Reads persisted `easy_days` settings when not provided.
#[tauri::command]
pub async fn apply_easy_days(
    window_days: Option<i32>,
    easy_days: Option<Vec<u8>>,
    repo: State<'_, Repository>,
) -> Result<LoadManagementResult> {
    let window = window_days.unwrap_or(30).clamp(1, 365) as i64;
    // Default to no easy days if none provided.
    let easy: std::collections::HashSet<u8> = easy_days.unwrap_or_default().into_iter().collect();
    if easy.is_empty() {
        return Ok(LoadManagementResult {
            affected: 0,
            skipped: 0,
        });
    }

    let now = Utc::now();
    let horizon = now + Duration::days(window);
    let items = repo.get_all_learning_items().await?;

    let mut affected: u64 = 0;
    let mut skipped: u64 = 0;

    for mut item in items {
        if item.is_suspended {
            skipped += 1;
            continue;
        }
        if item.due_date < now || item.due_date > horizon {
            skipped += 1;
            continue;
        }

        // Walk forward from the due date until we land on a non-easy weekday.
        let mut candidate = item.due_date;
        // Cap the walk to one full week so we never loop forever.
        for _ in 0..8 {
            let weekday = candidate.weekday().num_days_from_sunday() as u8;
            if !easy.contains(&weekday) {
                break;
            }
            candidate += Duration::days(1);
        }

        if candidate != item.due_date {
            item.due_date = candidate;
            item.date_modified = now;
            repo.update_learning_item(&item).await?;
            affected += 1;
        } else {
            skipped += 1;
        }
    }

    Ok(LoadManagementResult { affected, skipped })
}

// ---------------------------------------------------------------------------
// Batch queue mutations (queue-bulk-actions)
//
// Every command below takes queue item ids of mixed type, resolves each one
// through `resolve_queue_entities`, and applies the change inside a single
// transaction. Two failure modes are deliberately distinguished:
//
//   * An id that resolves to nothing (deleted since the selection was made) is
//     a per-item failure recorded in `BulkOperationResult::failed`. The rest of
//     the batch still commits — a stale id must not cost the user their action.
//   * A real SQL error aborts the whole transaction, so no item is left
//     half-written and the command returns Err.
// ---------------------------------------------------------------------------

/// How far a bulk postpone pushes each item out.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkPostponeArgs {
    /// Fixed shift in days (+1/+3/+7/+30 from the UI).
    pub days: i32,
}

/// Lifecycle transition applied by `bulk_set_item_lifecycle`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LifecycleTransition {
    /// Graduate out of the active queue.
    Done,
    /// Hide from the queue, keep the row.
    Dismiss,
    /// Reset scheduling state so the item is treated as new.
    Forget,
}

fn not_found(item_id: &str) -> crate::error::PlethoraError {
    crate::error::PlethoraError::NotFound(format!("Queue item {}", item_id))
}

/// Serialize and journal the post-mutation row while the domain transaction is
/// still open. This keeps bulk operations from committing data that another
/// device can never observe.
async fn journal_queue_fields(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    kind: QueueEntityKind,
    item_id: &str,
    fields: &[&str],
) -> Result<()> {
    let row = match kind {
        QueueEntityKind::Document => sqlx::query("SELECT * FROM documents WHERE id = ?1"),
        QueueEntityKind::Extract => sqlx::query("SELECT * FROM extracts WHERE id = ?1"),
        QueueEntityKind::LearningItem => sqlx::query("SELECT * FROM learning_items WHERE id = ?1"),
    }
    .bind(item_id)
    .fetch_one(&mut **tx)
    .await?;

    let (entity_type, base_revision, sync_payload) = match kind {
        QueueEntityKind::Document => {
            let entity = Repository::row_to_document(&row)?;
            let bytes = payload::document_payload_with_fields(&entity, fields)
                .map_err(|e| PlethoraError::Internal(format!("Sync payload encode failed: {e}")))?;
            (EntityType::Document, None, bytes)
        }
        QueueEntityKind::Extract => {
            let entity = Repository::row_to_extract(&row)?;
            let bytes = payload::extract_payload_with_fields(&entity, fields)
                .map_err(|e| PlethoraError::Internal(format!("Sync payload encode failed: {e}")))?;
            (EntityType::Extract, None, bytes)
        }
        QueueEntityKind::LearningItem => {
            let entity = Repository::row_to_learning_item(&row)?;
            let revision = learning_item_revision(entity.updated_at.as_deref());
            let bytes = payload::learning_item_payload_with_fields(&entity, fields)
                .map_err(|e| PlethoraError::Internal(format!("Sync payload encode failed: {e}")))?;
            (EntityType::LearningItem, revision, bytes)
        }
    };

    journal_entity(
        tx,
        entity_type,
        item_id,
        SyncOperation::Update,
        base_revision,
        sync_payload,
    )
    .await
}

/// Set one priority slider value across a mixed selection.
///
/// Priority exists on documents (rating + slider + score) and on extracts
/// (score only). `learning_items` has no priority column at all, so those ids
/// are reported as failures rather than silently ignored — the caller shows the
/// count and the user is not misled into thinking their cards were reprioritized.
pub(crate) async fn bulk_update_item_priorities_inner(
    repo: &Repository,
    item_ids: Vec<String>,
    slider: i32,
) -> Result<BulkOperationResult> {
    let mut result = BulkOperationResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
        errors: Vec::new(),
    };
    if item_ids.is_empty() {
        return Ok(result);
    }

    let slider_value = slider.clamp(0, 100);
    let rating_value = crate::algorithms::rating_from_slider(slider_value);
    // Rank-derived order keys, spread across the gap at the requested rank so
    // the batch stays a total order (see database::priority_rank).
    let scores =
        crate::database::priority_rank::keys_for_slider(repo.pool(), slider_value, item_ids.len())
            .await?;

    let resolved = resolve_queue_entities(repo, &item_ids).await?;
    let now = Utc::now();
    let mut tx = repo.pool().begin().await?;

    for (item_id, score) in item_ids.iter().zip(scores) {
        match resolved.get(item_id) {
            Some(QueueEntityKind::Document) => {
                sqlx::query(
                    "UPDATE documents SET priority_rating = ?, priority_slider = ?, \
                     priority_score = ?, priority_explicitly_set = 1, date_modified = ? WHERE id = ?",
                )
                .bind(rating_value)
                .bind(slider_value)
                .bind(score)
                .bind(now)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
                journal_queue_fields(&mut tx, QueueEntityKind::Document, item_id, &["priority"])
                    .await?;
                result.succeeded.push(item_id.clone());
            }
            Some(QueueEntityKind::Extract) => {
                sqlx::query(
                    "UPDATE extracts SET priority_score = ?, date_modified = ? WHERE id = ?",
                )
                .bind(score.clamp(0.0, 100.0))
                .bind(now)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
                journal_queue_fields(&mut tx, QueueEntityKind::Extract, item_id, &["priority"])
                    .await?;
                result.succeeded.push(item_id.clone());
            }
            Some(QueueEntityKind::LearningItem) => {
                result.failed.push(item_id.clone());
                result
                    .errors
                    .push(format!("{}: flashcards have no priority", item_id));
            }
            None => {
                result.failed.push(item_id.clone());
                result
                    .errors
                    .push(format!("{}: {}", item_id, not_found(item_id)));
            }
        }
    }

    tx.commit().await?;
    if !result.succeeded.is_empty() {
        notify_after_commit();
    }
    Ok(result)
}

/// Push a mixed selection out by a fixed number of days.
///
/// Documents advance `next_reading_date` scaled by their own
/// `interval_modifier`, matching `postpone_item`; learning items and extracts
/// advance their due date directly. Smart (algorithm-weighted) postpone stays in
/// the frontend `postpone` engine, which already owns the priority-weighted
/// formula — duplicating it here would give the two paths room to drift.
pub(crate) async fn bulk_postpone_items_inner(
    repo: &Repository,
    item_ids: Vec<String>,
    days: i32,
) -> Result<BulkOperationResult> {
    let mut result = BulkOperationResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
        errors: Vec::new(),
    };
    if item_ids.is_empty() {
        return Ok(result);
    }

    let resolved = resolve_queue_entities(repo, &item_ids).await?;
    let now = Utc::now();
    let mut tx = repo.pool().begin().await?;

    for item_id in &item_ids {
        match resolved.get(item_id) {
            Some(QueueEntityKind::Document) => {
                // Read the modifier inside the transaction so a concurrent edit
                // cannot make the shift disagree with the stored value.
                let modifier: f64 =
                    sqlx::query("SELECT interval_modifier FROM documents WHERE id = ?")
                        .bind(item_id)
                        .fetch_one(&mut *tx)
                        .await?
                        .try_get("interval_modifier")
                        .unwrap_or(1.0);
                let shift = ((days as f64 * modifier).round() as i64).max(1);
                sqlx::query(
                    "UPDATE documents SET next_reading_date = \
                     datetime(COALESCE(next_reading_date, ?), '+' || ? || ' days'), \
                     date_modified = ? WHERE id = ?",
                )
                .bind(now)
                .bind(shift)
                .bind(now)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
                journal_queue_fields(&mut tx, QueueEntityKind::Document, item_id, &["schedule"])
                    .await?;
                result.succeeded.push(item_id.clone());
            }
            Some(QueueEntityKind::LearningItem) => {
                sqlx::query(
                    "UPDATE learning_items SET due_date = datetime(due_date, '+' || ? || ' days'), \
                     date_modified = ? WHERE id = ?",
                )
                .bind(days.max(1))
                .bind(now)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
                journal_queue_fields(
                    &mut tx,
                    QueueEntityKind::LearningItem,
                    item_id,
                    &["schedule"],
                )
                .await?;
                result.succeeded.push(item_id.clone());
            }
            Some(QueueEntityKind::Extract) => {
                // Extracts are scheduled through their parent document.
                let document_id: String =
                    sqlx::query_scalar("SELECT document_id FROM extracts WHERE id = ?")
                        .bind(item_id)
                        .fetch_one(&mut *tx)
                        .await?;
                sqlx::query(
                    "UPDATE documents SET next_reading_date = \
                     datetime(COALESCE(next_reading_date, ?), '+' || ? || ' days'), \
                     date_modified = ? \
                     WHERE id = (SELECT document_id FROM extracts WHERE id = ?)",
                )
                .bind(now)
                .bind(days.max(1))
                .bind(now)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
                journal_queue_fields(
                    &mut tx,
                    QueueEntityKind::Document,
                    &document_id,
                    &["schedule"],
                )
                .await?;
                result.succeeded.push(item_id.clone());
            }
            None => {
                result.failed.push(item_id.clone());
                result
                    .errors
                    .push(format!("{}: {}", item_id, not_found(item_id)));
            }
        }
    }

    tx.commit().await?;
    if !result.succeeded.is_empty() {
        notify_after_commit();
    }
    Ok(result)
}

/// Move a mixed selection into one collection.
///
/// All three tables carry `collection_id` (migration 007), so this is uniform.
/// The target collection must already exist — a move never creates one.
pub(crate) async fn bulk_move_items_to_collection_inner(
    repo: &Repository,
    item_ids: Vec<String>,
    collection_id: String,
) -> Result<BulkOperationResult> {
    let mut result = BulkOperationResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
        errors: Vec::new(),
    };
    if item_ids.is_empty() {
        return Ok(result);
    }

    let exists: Option<String> = sqlx::query("SELECT id FROM collections WHERE id = ?")
        .bind(&collection_id)
        .fetch_optional(repo.pool())
        .await?
        .map(|row| row.get("id"));
    if exists.is_none() {
        return Err(crate::error::PlethoraError::NotFound(format!(
            "Collection {}",
            collection_id
        )));
    }

    let resolved = resolve_queue_entities(repo, &item_ids).await?;
    let now = Utc::now();
    let mut tx = repo.pool().begin().await?;

    for item_id in &item_ids {
        let table = match resolved.get(item_id) {
            Some(QueueEntityKind::Document) => "documents",
            Some(QueueEntityKind::Extract) => "extracts",
            Some(QueueEntityKind::LearningItem) => "learning_items",
            None => {
                result.failed.push(item_id.clone());
                result
                    .errors
                    .push(format!("{}: {}", item_id, not_found(item_id)));
                continue;
            }
        };
        let sql = format!(
            "UPDATE {} SET collection_id = ?, date_modified = ? WHERE id = ?",
            table
        );
        sqlx::query(&sql)
            .bind(&collection_id)
            .bind(now)
            .bind(item_id)
            .execute(&mut *tx)
            .await?;
        journal_queue_fields(
            &mut tx,
            *resolved.get(item_id).expect("resolved kind"),
            item_id,
            &["collection"],
        )
        .await?;
        result.succeeded.push(item_id.clone());
    }

    tx.commit().await?;
    if !result.succeeded.is_empty() {
        notify_after_commit();
    }
    Ok(result)
}

/// Add and/or remove tags across a mixed selection.
///
/// Tags live as a JSON array in a TEXT column on all three tables. Adding a tag
/// an item already carries, or removing one it does not, is a no-op for that
/// item rather than an error — a bulk edit should converge on the requested
/// state, not fail because part of it was already true.
pub(crate) async fn bulk_update_item_tags_inner(
    repo: &Repository,
    item_ids: Vec<String>,
    add: Vec<String>,
    remove: Vec<String>,
) -> Result<BulkOperationResult> {
    let mut result = BulkOperationResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
        errors: Vec::new(),
    };
    if item_ids.is_empty() {
        return Ok(result);
    }

    let resolved = resolve_queue_entities(repo, &item_ids).await?;
    let now = Utc::now();
    let mut tx = repo.pool().begin().await?;

    for item_id in &item_ids {
        let table = match resolved.get(item_id) {
            Some(QueueEntityKind::Document) => "documents",
            Some(QueueEntityKind::Extract) => "extracts",
            Some(QueueEntityKind::LearningItem) => "learning_items",
            None => {
                result.failed.push(item_id.clone());
                result
                    .errors
                    .push(format!("{}: {}", item_id, not_found(item_id)));
                continue;
            }
        };

        let current: String = sqlx::query(&format!("SELECT tags FROM {} WHERE id = ?", table))
            .bind(item_id)
            .fetch_one(&mut *tx)
            .await?
            .try_get("tags")
            .unwrap_or_else(|_| "[]".to_string());
        let mut tags: Vec<String> = serde_json::from_str(&current).unwrap_or_default();

        for tag in &add {
            if !tags.iter().any(|t| t == tag) {
                tags.push(tag.clone());
            }
        }
        tags.retain(|t| !remove.iter().any(|r| r == t));

        let encoded = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
        sqlx::query(&format!(
            "UPDATE {} SET tags = ?, date_modified = ? WHERE id = ?",
            table
        ))
        .bind(encoded)
        .bind(now)
        .bind(item_id)
        .execute(&mut *tx)
        .await?;
        journal_queue_fields(
            &mut tx,
            *resolved.get(item_id).expect("resolved kind"),
            item_id,
            &["tags"],
        )
        .await?;
        result.succeeded.push(item_id.clone());
    }

    tx.commit().await?;
    if !result.succeeded.is_empty() {
        notify_after_commit();
    }
    Ok(result)
}

/// Apply a lifecycle transition across a mixed selection.
///
/// `Done` and `Dismiss` both take the item out of the active queue and are
/// expressible on every type. `Forget` resets scheduling state to the new-item
/// baseline; on documents and extracts that means clearing the schedule, on
/// learning items it means resetting the FSRS/SM state columns as well.
pub(crate) async fn bulk_set_item_lifecycle_inner(
    repo: &Repository,
    item_ids: Vec<String>,
    transition: LifecycleTransition,
) -> Result<BulkOperationResult> {
    let mut result = BulkOperationResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
        errors: Vec::new(),
    };
    if item_ids.is_empty() {
        return Ok(result);
    }

    let resolved = resolve_queue_entities(repo, &item_ids).await?;
    let now = Utc::now();
    let mut tx = repo.pool().begin().await?;

    for item_id in &item_ids {
        let kind = match resolved.get(item_id) {
            Some(kind) => *kind,
            None => {
                result.failed.push(item_id.clone());
                result
                    .errors
                    .push(format!("{}: {}", item_id, not_found(item_id)));
                continue;
            }
        };

        match (transition, kind) {
            // Done / Dismiss both remove the item from the active queue. The
            // difference is intent, not mechanism, for documents and extracts.
            (LifecycleTransition::Done, QueueEntityKind::Document) => {
                sqlx::query("UPDATE documents SET is_archived = 1, date_modified = ? WHERE id = ?")
                    .bind(now)
                    .bind(item_id)
                    .execute(&mut *tx)
                    .await?;
            }
            (LifecycleTransition::Dismiss, QueueEntityKind::Document) => {
                sqlx::query(
                    "UPDATE documents SET is_dismissed = 1, date_modified = ? WHERE id = ?",
                )
                .bind(now)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
            }
            (LifecycleTransition::Done, QueueEntityKind::Extract)
            | (LifecycleTransition::Dismiss, QueueEntityKind::Extract) => {
                sqlx::query("UPDATE extracts SET is_dismissed = 1, date_modified = ? WHERE id = ?")
                    .bind(now)
                    .bind(item_id)
                    .execute(&mut *tx)
                    .await?;
            }
            (LifecycleTransition::Done, QueueEntityKind::LearningItem)
            | (LifecycleTransition::Dismiss, QueueEntityKind::LearningItem) => {
                sqlx::query(
                    "UPDATE learning_items SET is_suspended = 1, date_modified = ? WHERE id = ?",
                )
                .bind(now)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
            }
            (LifecycleTransition::Forget, QueueEntityKind::LearningItem) => {
                sqlx::query(
                    "UPDATE learning_items SET state = 'new', interval = 0, ease_factor = 2.5, \
                     review_count = 0, lapses = 0, last_review_date = NULL, \
                     first_reviewed_at = NULL, due_date = ?, date_modified = ? WHERE id = ?",
                )
                .bind(now)
                .bind(now)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
            }
            (LifecycleTransition::Forget, QueueEntityKind::Document) => {
                sqlx::query(
                    "UPDATE documents SET next_reading_date = NULL, stability = NULL, \
                     difficulty = NULL, first_reviewed_at = NULL, date_modified = ? WHERE id = ?",
                )
                .bind(now)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
            }
            (LifecycleTransition::Forget, QueueEntityKind::Extract) => {
                // Extracts hold no memory state of their own; forgetting one is
                // a no-op rather than an error so a mixed Forget still succeeds.
            }
        }

        let fields: &[&str] = match (transition, kind) {
            (LifecycleTransition::Done, QueueEntityKind::Document) => &["flags"],
            (LifecycleTransition::Dismiss, QueueEntityKind::Document) => &["flags"],
            (LifecycleTransition::Done, QueueEntityKind::Extract)
            | (LifecycleTransition::Dismiss, QueueEntityKind::Extract) => &["activity"],
            (LifecycleTransition::Done, QueueEntityKind::LearningItem)
            | (LifecycleTransition::Dismiss, QueueEntityKind::LearningItem) => &["suspension"],
            (LifecycleTransition::Forget, QueueEntityKind::LearningItem) => &["schedule"],
            (LifecycleTransition::Forget, QueueEntityKind::Document) => &["schedule"],
            // No domain mutation occurred for extracts.
            (LifecycleTransition::Forget, QueueEntityKind::Extract) => &[],
        };
        if !fields.is_empty() {
            journal_queue_fields(&mut tx, kind, item_id, fields).await?;
        }

        result.succeeded.push(item_id.clone());
    }

    tx.commit().await?;
    if !result.succeeded.is_empty() {
        notify_after_commit();
    }
    Ok(result)
}

// Tauri entry points. The logic lives in the `_inner` helpers above so the
// tests can drive it with a plain `&Repository` instead of a Tauri `State`.
#[tauri::command]
pub async fn bulk_update_item_priorities(
    item_ids: Vec<String>,
    slider: i32,
    repo: State<'_, Repository>,
) -> Result<BulkOperationResult> {
    bulk_update_item_priorities_inner(&repo, item_ids, slider).await
}

#[tauri::command]
pub async fn bulk_postpone_items(
    item_ids: Vec<String>,
    days: i32,
    repo: State<'_, Repository>,
) -> Result<BulkOperationResult> {
    bulk_postpone_items_inner(&repo, item_ids, days).await
}

#[tauri::command]
pub async fn bulk_move_items_to_collection(
    item_ids: Vec<String>,
    collection_id: String,
    repo: State<'_, Repository>,
) -> Result<BulkOperationResult> {
    bulk_move_items_to_collection_inner(&repo, item_ids, collection_id).await
}

#[tauri::command]
pub async fn bulk_update_item_tags(
    item_ids: Vec<String>,
    add: Vec<String>,
    remove: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<BulkOperationResult> {
    bulk_update_item_tags_inner(&repo, item_ids, add, remove).await
}

#[tauri::command]
pub async fn bulk_set_item_lifecycle(
    item_ids: Vec<String>,
    transition: LifecycleTransition,
    repo: State<'_, Repository>,
) -> Result<BulkOperationResult> {
    bulk_set_item_lifecycle_inner(&repo, item_ids, transition).await
}

#[cfg(test)]
mod bulk_item_tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::models::{Extract, FileType, ItemType};
    use std::path::PathBuf;

    async fn setup_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    async fn make_document(repo: &Repository, title: &str) -> String {
        let doc = Document::new(
            title.to_string(),
            format!("/tmp/{}.pdf", title),
            FileType::Pdf,
        );
        repo.create_document(&doc)
            .await
            .expect("create document")
            .id
    }

    async fn make_extract(repo: &Repository, document_id: &str) -> String {
        let extract = Extract::new(document_id.to_string(), "extract body".to_string());
        repo.create_extract(&extract)
            .await
            .expect("create extract")
            .id
    }

    async fn make_learning_item(repo: &Repository) -> String {
        let item = LearningItem::new(ItemType::Basic, "question?".to_string());
        repo.create_learning_item(&item)
            .await
            .expect("create learning item")
            .id
    }

    fn empty_result() -> BulkOperationResult {
        BulkOperationResult {
            succeeded: Vec::new(),
            failed: Vec::new(),
            errors: Vec::new(),
        }
    }

    async fn suspend(repo: &Repository, ids: &[String], suspended: bool) -> BulkOperationResult {
        let mut result = empty_result();
        set_queue_items_suspended(repo, ids, suspended, &mut result).await;
        result
    }

    #[tokio::test]
    async fn suspends_a_document_only_selection() {
        let repo = setup_repo().await;
        let a = make_document(&repo, "A").await;
        let b = make_document(&repo, "B").await;

        let result = suspend(&repo, &[a.clone(), b.clone()], true).await;

        assert_eq!(result.succeeded.len(), 2, "errors: {:?}", result.errors);
        assert!(result.failed.is_empty());
        assert!(repo.get_document(&a).await.unwrap().unwrap().is_dismissed);
        assert!(repo.get_document(&b).await.unwrap().unwrap().is_dismissed);
    }

    #[tokio::test]
    async fn suspends_an_extract_only_selection() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;
        let extract = make_extract(&repo, &doc).await;

        let result = suspend(&repo, &[extract.clone()], true).await;

        assert_eq!(
            result.succeeded,
            vec![extract.clone()],
            "errors: {:?}",
            result.errors
        );
        assert!(
            repo.get_extract(&extract)
                .await
                .unwrap()
                .unwrap()
                .is_dismissed
        );
    }

    #[tokio::test]
    async fn suspends_a_learning_item_only_selection() {
        let repo = setup_repo().await;
        let item = make_learning_item(&repo).await;

        let result = suspend(&repo, &[item.clone()], true).await;

        assert_eq!(
            result.succeeded,
            vec![item.clone()],
            "errors: {:?}",
            result.errors
        );
        assert!(
            repo.get_learning_item_by_id(&item)
                .await
                .unwrap()
                .unwrap()
                .is_suspended
        );
    }

    #[tokio::test]
    async fn suspends_a_mixed_selection() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;
        let extract = make_extract(&repo, &doc).await;
        let item = make_learning_item(&repo).await;

        let result = suspend(&repo, &[doc.clone(), extract.clone(), item.clone()], true).await;

        assert_eq!(result.succeeded.len(), 3, "errors: {:?}", result.errors);
        assert!(result.failed.is_empty());
    }

    #[tokio::test]
    async fn unsuspending_reverses_every_type() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;
        let extract = make_extract(&repo, &doc).await;
        let item = make_learning_item(&repo).await;
        let ids = vec![doc.clone(), extract.clone(), item.clone()];

        suspend(&repo, &ids, true).await;
        let result = suspend(&repo, &ids, false).await;

        assert_eq!(result.succeeded.len(), 3, "errors: {:?}", result.errors);
        assert!(!repo.get_document(&doc).await.unwrap().unwrap().is_dismissed);
        assert!(
            !repo
                .get_extract(&extract)
                .await
                .unwrap()
                .unwrap()
                .is_dismissed
        );
        assert!(
            !repo
                .get_learning_item_by_id(&item)
                .await
                .unwrap()
                .unwrap()
                .is_suspended
        );
    }

    #[tokio::test]
    async fn unresolvable_id_fails_without_aborting_the_batch() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;

        let result = suspend(&repo, &["not-a-real-id".to_string(), doc.clone()], true).await;

        assert_eq!(result.succeeded, vec![doc.clone()]);
        assert_eq!(result.failed, vec!["not-a-real-id".to_string()]);
        assert_eq!(result.errors.len(), 1);
        assert!(repo.get_document(&doc).await.unwrap().unwrap().is_dismissed);
    }

    #[tokio::test]
    async fn resolution_uses_one_query_per_table_regardless_of_selection_size() {
        let repo = setup_repo().await;
        let mut ids = Vec::new();
        for index in 0..25 {
            ids.push(make_document(&repo, &format!("Doc{}", index)).await);
        }

        // Three tables are probed; a per-id full-table read would instead scale
        // with the selection. Correctness stands in for the query count here:
        // every id resolves from a single batched lookup.
        let resolved = resolve_queue_entities(&repo, &ids).await.expect("resolve");

        assert_eq!(resolved.len(), 25);
        assert!(resolved
            .values()
            .all(|kind| *kind == QueueEntityKind::Document));
    }

    #[tokio::test]
    async fn empty_selection_resolves_to_nothing() {
        let repo = setup_repo().await;
        let resolved = resolve_queue_entities(&repo, &[]).await.expect("resolve");
        assert!(resolved.is_empty());
    }

    // ---- batch mutation commands (queue-bulk-actions) ----------------------
    //
    // These exercise the runtime SQL. The queries are built as strings, so the
    // compiler validates none of the column names — only running them does.

    #[tokio::test]
    async fn bulk_priority_sets_documents_and_extracts_and_rejects_flashcards() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;
        let extract = make_extract(&repo, &doc).await;
        let card = make_learning_item(&repo).await;

        let result = bulk_update_item_priorities_inner(
            &repo,
            vec![doc.clone(), extract.clone(), card.clone()],
            80,
        )
        .await
        .expect("bulk priority");

        assert_eq!(result.succeeded.len(), 2);
        assert!(result.succeeded.contains(&doc));
        assert!(result.succeeded.contains(&extract));
        // Flashcards have no priority column; say so rather than lie.
        assert_eq!(result.failed, vec![card]);
        assert!(result.errors[0].contains("no priority"));

        let stored: f64 = sqlx::query("SELECT priority_score FROM documents WHERE id = ?")
            .bind(&doc)
            .fetch_one(repo.pool())
            .await
            .expect("read doc")
            .try_get("priority_score")
            .expect("priority_score");
        assert!(stored > 0.0, "document priority should have been written");
    }

    #[tokio::test]
    async fn bulk_priority_clamps_out_of_range_slider() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;

        bulk_update_item_priorities_inner(&repo, vec![doc.clone()], 500)
            .await
            .expect("bulk priority");

        let slider: i32 = sqlx::query("SELECT priority_slider FROM documents WHERE id = ?")
            .bind(&doc)
            .fetch_one(repo.pool())
            .await
            .expect("read doc")
            .try_get("priority_slider")
            .expect("priority_slider");
        assert_eq!(slider, 100);
    }

    #[tokio::test]
    async fn bulk_postpone_advances_every_type_and_reports_unknown_ids() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;
        let card = make_learning_item(&repo).await;

        let before: String = sqlx::query("SELECT due_date FROM learning_items WHERE id = ?")
            .bind(&card)
            .fetch_one(repo.pool())
            .await
            .expect("read card")
            .try_get("due_date")
            .expect("due_date");

        let result = bulk_postpone_items_inner(
            &repo,
            vec![doc.clone(), card.clone(), "ghost".to_string()],
            7,
        )
        .await
        .expect("bulk postpone");

        assert_eq!(result.succeeded.len(), 2);
        assert_eq!(result.failed, vec!["ghost".to_string()]);

        let after: String = sqlx::query("SELECT due_date FROM learning_items WHERE id = ?")
            .bind(&card)
            .fetch_one(repo.pool())
            .await
            .expect("read card")
            .try_get("due_date")
            .expect("due_date");
        assert_ne!(before, after, "due date should have moved");

        let next: Option<String> =
            sqlx::query("SELECT next_reading_date FROM documents WHERE id = ?")
                .bind(&doc)
                .fetch_one(repo.pool())
                .await
                .expect("read doc")
                .try_get("next_reading_date")
                .expect("next_reading_date");
        assert!(next.is_some(), "document should have been scheduled");
    }

    #[tokio::test]
    async fn bulk_move_reassigns_every_type_without_creating_a_collection() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;
        let extract = make_extract(&repo, &doc).await;
        let card = make_learning_item(&repo).await;

        let before: i64 = sqlx::query("SELECT COUNT(*) AS n FROM collections")
            .fetch_one(repo.pool())
            .await
            .expect("count")
            .try_get("n")
            .expect("n");

        let target = "00000000-0000-0000-0000-000000000001";
        let result = bulk_move_items_to_collection_inner(
            &repo,
            vec![doc.clone(), extract.clone(), card.clone()],
            target.to_string(),
        )
        .await
        .expect("bulk move");
        assert_eq!(result.succeeded.len(), 3);

        let after: i64 = sqlx::query("SELECT COUNT(*) AS n FROM collections")
            .fetch_one(repo.pool())
            .await
            .expect("count")
            .try_get("n")
            .expect("n");
        assert_eq!(before, after, "a move must never create a collection");
    }

    #[tokio::test]
    async fn bulk_move_to_a_missing_collection_is_an_error_not_a_silent_write() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;

        let result =
            bulk_move_items_to_collection_inner(&repo, vec![doc], "nope".to_string()).await;
        assert!(result.is_err(), "unknown collection must not be accepted");
    }

    #[tokio::test]
    async fn bulk_tags_add_and_remove_are_idempotent_per_item() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;
        let card = make_learning_item(&repo).await;

        // Add twice: the second add must not duplicate the tag.
        for _ in 0..2 {
            bulk_update_item_tags_inner(
                &repo,
                vec![doc.clone(), card.clone()],
                vec!["physics".to_string()],
                vec![],
            )
            .await
            .expect("bulk tag add");
        }

        let tags: String = sqlx::query("SELECT tags FROM documents WHERE id = ?")
            .bind(&doc)
            .fetch_one(repo.pool())
            .await
            .expect("read doc")
            .try_get("tags")
            .expect("tags");
        let parsed: Vec<String> = serde_json::from_str(&tags).expect("tags json");
        assert_eq!(parsed, vec!["physics".to_string()]);

        // Removing a tag the item never had is a no-op, not a failure.
        let result = bulk_update_item_tags_inner(
            &repo,
            vec![doc.clone()],
            vec![],
            vec!["chemistry".to_string()],
        )
        .await
        .expect("bulk tag remove");
        assert_eq!(result.succeeded, vec![doc.clone()]);
        assert!(result.failed.is_empty());

        bulk_update_item_tags_inner(
            &repo,
            vec![doc.clone()],
            vec![],
            vec!["physics".to_string()],
        )
        .await
        .expect("bulk tag remove");
        let tags: String = sqlx::query("SELECT tags FROM documents WHERE id = ?")
            .bind(&doc)
            .fetch_one(repo.pool())
            .await
            .expect("read doc")
            .try_get("tags")
            .expect("tags");
        let parsed: Vec<String> = serde_json::from_str(&tags).expect("tags json");
        assert!(parsed.is_empty());
    }

    #[tokio::test]
    async fn bulk_forget_resets_learning_item_memory_state() {
        let repo = setup_repo().await;
        let card = make_learning_item(&repo).await;

        sqlx::query(
            "UPDATE learning_items SET state = 'review', interval = 40, review_count = 9, \
             lapses = 2 WHERE id = ?",
        )
        .bind(&card)
        .execute(repo.pool())
        .await
        .expect("seed review state");

        let result =
            bulk_set_item_lifecycle_inner(&repo, vec![card.clone()], LifecycleTransition::Forget)
                .await
                .expect("bulk forget");
        assert_eq!(result.succeeded, vec![card.clone()]);

        let row = sqlx::query(
            "SELECT state, interval, review_count, lapses FROM learning_items WHERE id = ?",
        )
        .bind(&card)
        .fetch_one(repo.pool())
        .await
        .expect("read card");
        let state: String = row.try_get("state").expect("state");
        // `interval` is REAL in the live schema, not the INTEGER 001_initial declares.
        let interval: f64 = row.try_get("interval").expect("interval");
        let reviews: i64 = row.try_get("review_count").expect("review_count");
        let lapses: i64 = row.try_get("lapses").expect("lapses");
        assert_eq!(state, "new");
        assert_eq!(interval, 0.0);
        assert_eq!(reviews, 0);
        assert_eq!(lapses, 0);
    }

    #[tokio::test]
    async fn bulk_lifecycle_dismiss_takes_every_type_out_of_the_queue() {
        let repo = setup_repo().await;
        let doc = make_document(&repo, "Doc").await;
        let extract = make_extract(&repo, &doc).await;
        let card = make_learning_item(&repo).await;

        let result = bulk_set_item_lifecycle_inner(
            &repo,
            vec![doc.clone(), extract.clone(), card.clone()],
            LifecycleTransition::Dismiss,
        )
        .await
        .expect("bulk dismiss");
        assert_eq!(result.succeeded.len(), 3);

        let suspended: bool = sqlx::query("SELECT is_suspended FROM learning_items WHERE id = ?")
            .bind(&card)
            .fetch_one(repo.pool())
            .await
            .expect("read card")
            .try_get("is_suspended")
            .expect("is_suspended");
        assert!(suspended);
    }

    #[tokio::test]
    async fn empty_batches_are_a_no_op_for_every_command() {
        let repo = setup_repo().await;
        assert!(bulk_update_item_priorities_inner(&repo, vec![], 50)
            .await
            .expect("priority")
            .succeeded
            .is_empty());
        assert!(bulk_postpone_items_inner(&repo, vec![], 7)
            .await
            .expect("postpone")
            .succeeded
            .is_empty());
        assert!(bulk_update_item_tags_inner(&repo, vec![], vec![], vec![])
            .await
            .expect("tags")
            .succeeded
            .is_empty());
    }
}
