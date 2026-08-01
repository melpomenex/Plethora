//! Advanced queue management commands

use crate::database::Repository;
use crate::error::Result;
use crate::models::{Document, LearningItem};
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
            Some(QueueEntityKind::LearningItem) => {
                sqlx::query("UPDATE learning_items SET is_suspended = ?, date_modified = ? WHERE id = ?")
                    .bind(suspended)
                    .bind(Utc::now())
                    .bind(item_id)
                    .execute(repo.pool())
                    .await
                    .map(|_| ())
                    .map_err(crate::error::IncrementumError::from)
            }
            Some(QueueEntityKind::Document) => repo
                .update_document_dismiss(item_id, suspended)
                .await
                .map(|_| ()),
            Some(QueueEntityKind::Extract) => {
                repo.update_extract_dismissed(item_id, suspended).await
            }
            None => Err(crate::error::IncrementumError::NotFound(format!(
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
                crate::error::IncrementumError::NotFound(format!("Document {}", item_id))
            })?;

            let new_date = match doc.next_reading_date {
                Some(d) => d + Duration::days(days as i64),
                None => Utc::now() + Duration::days(days as i64),
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
                    crate::error::IncrementumError::NotFound(format!("Item {}", item_id))
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
                    .map_err(crate::error::IncrementumError::from)
            }
            Some(QueueEntityKind::Document) => repo.delete_document(item_id).await,
            Some(QueueEntityKind::Extract) => repo.delete_extract(item_id).await,
            None => Err(crate::error::IncrementumError::NotFound(format!(
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
                crate::error::IncrementumError::NotFound(format!("Document {}", item_id))
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
                    crate::error::IncrementumError::NotFound(format!("Item {}", item_id))
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
        let doc = Document::new(title.to_string(), format!("/tmp/{}.pdf", title), FileType::Pdf);
        repo.create_document(&doc).await.expect("create document").id
    }

    async fn make_extract(repo: &Repository, document_id: &str) -> String {
        let extract = Extract::new(document_id.to_string(), "extract body".to_string());
        repo.create_extract(&extract).await.expect("create extract").id
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

        assert_eq!(result.succeeded, vec![extract.clone()], "errors: {:?}", result.errors);
        assert!(repo.get_extract(&extract).await.unwrap().unwrap().is_dismissed);
    }

    #[tokio::test]
    async fn suspends_a_learning_item_only_selection() {
        let repo = setup_repo().await;
        let item = make_learning_item(&repo).await;

        let result = suspend(&repo, &[item.clone()], true).await;

        assert_eq!(result.succeeded, vec![item.clone()], "errors: {:?}", result.errors);
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
        assert!(!repo.get_extract(&extract).await.unwrap().unwrap().is_dismissed);
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
}
