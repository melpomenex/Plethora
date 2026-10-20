//! Extract review commands

use crate::algorithms::document_scheduler::DocumentScheduler;
use crate::database::{ItemActivityRepository, Repository};
use crate::error::{PlethoraError, Result};
use crate::models::item_activity::{ActivityItemType, ActivitySurface, ItemActivityEvent};
use crate::models::{Extract, ItemType, LearningItem, ReviewRating};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractReviewResult {
    pub extract: Extract,
    pub next_review_date: String,
}

/// Submit a review for an extract using FSRS-7 scheduling.
#[tauri::command]
pub async fn submit_extract_review(
    extract_id: String,
    rating: i32, // 1=Again, 2=Hard, 3=Good, 4=Easy
    time_taken: i32,
    repo: State<'_, Repository>,
) -> Result<Extract> {
    let mut extract = repo
        .get_extract(&extract_id)
        .await?
        .ok_or_else(|| crate::error::PlethoraError::NotFound(format!("Extract {}", extract_id)))?;

    let now = Utc::now();
    let scheduler = DocumentScheduler::default_params();

    let elapsed_days = extract
        .last_review_date
        .map(|lr| (now - lr).num_seconds() as f64 / 86400.0)
        .unwrap_or_else(|| (now - extract.date_created).num_seconds() as f64 / 86400.0)
        .max(0.0);

    let current_stability = extract.memory_state.as_ref().map(|ms| ms.stability);
    let current_difficulty = extract.memory_state.as_ref().map(|ms| ms.difficulty);
    let current_stability_fast = extract
        .memory_state
        .as_ref()
        .and_then(|ms| ms.stability_fast);

    let result = scheduler.schedule_document_with_fast_stability(
        ReviewRating::from(rating),
        current_stability,
        current_difficulty,
        current_stability_fast,
        elapsed_days,
    )?;

    let new_interval_days = result.interval_days as f64;

    extract.memory_state = Some(crate::models::MemoryState {
        stability: result.stability,
        difficulty: result.difficulty,
        stability_fast: result.stability_fast,
    });

    repo.update_extract_scheduling(
        &extract.id,
        Some(result.next_review),
        Some(result.stability),
        Some(result.difficulty),
        Some(extract.review_count + 1),
        Some(extract.reps + 1),
        Some(now),
    )
    .await?;

    // Advance progressive disclosure level for Good/Easy ratings
    if (rating == 3 || rating == 4)
        && extract.max_disclosure_level > 0
        && extract.progressive_disclosure_level < extract.max_disclosure_level
    {
        repo.update_extract_disclosure_level(&extract.id, extract.progressive_disclosure_level + 1)
            .await?;
    }

    // Persist the measured time. Previously this value was bound and dropped,
    // which left extracts as the one reviewable type with no time story at all.
    //
    // The cumulative total propagates its errors — it is a number the user
    // reads — while the history row is best-effort, because the schedule is
    // already committed and failing here would report a successful review as
    // failed.
    let active_seconds = time_taken.max(0) as i64;
    let activity = ItemActivityRepository::new(repo.pool().clone());
    activity
        .accumulate_item_time(ActivityItemType::Extract, &extract.id, active_seconds)
        .await?;
    if let Err(e) = activity
        .record_event(&ItemActivityEvent::review(
            ActivityItemType::Extract,
            extract.id.clone(),
            ActivitySurface::Queue,
            active_seconds,
            rating,
            new_interval_days as f64,
        ))
        .await
    {
        tracing::warn!(
            "Failed to record activity for extract review {}: {}",
            extract.id,
            e
        );
    }

    // Refresh object to return
    extract.next_review_date = Some(result.next_review);
    extract.review_count += 1;
    extract.reps += 1;
    extract.last_review_date = Some(now);
    extract.total_time_spent = Some(extract.total_time_spent.unwrap_or(0) + active_seconds);

    Ok(extract)
}

/// Create a cloze deletion from an extract with selected text
#[tauri::command]
pub async fn create_cloze_from_extract(
    extract_id: String,
    cloze_text: String,
    cloze_ranges: Vec<(usize, usize)>,
    // Narrow retry-safe acceptance identity (agent learning proposals).
    acceptance_id: Option<String>,
    proposal_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    // Idempotent retry: the same acceptance pair returns the committed row.
    if let (Some(acceptance), Some(proposal)) = (&acceptance_id, &proposal_id) {
        if let Some(existing) =
            crate::commands::learning_item::find_learning_item_by_acceptance_key(
                acceptance, proposal, &repo,
            )
            .await?
        {
            return Ok(existing);
        }
        // Scoped text-proposal duplicate enforcement for the agent path. The
        // legacy Learn-this path (no proposal id) keeps its historical
        // behavior.
        let duplicate: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM learning_items WHERE extract_id = ?1 AND lower(COALESCE(cloze_text, '')) = lower(?2) LIMIT 1",
        )
        .bind(&extract_id)
        .bind(&cloze_text)
        .fetch_optional(repo.pool())
        .await?;
        if let Some((duplicate_id,)) = duplicate {
            return Err(PlethoraError::InvalidInput(format!(
                "Potential duplicate cloze detected ({duplicate_id})."
            )));
        }
    }

    let extract = repo
        .get_extract(&extract_id)
        .await?
        .ok_or_else(|| crate::error::PlethoraError::NotFound(format!("Extract {}", extract_id)))?;

    let mut item = LearningItem::from_extract(
        extract.id.clone(),
        extract.document_id.clone(),
        ItemType::Cloze,
        "Cloze Deletion".to_string(), // Placeholder question, real content is in cloze_text
        None,
    );

    item.cloze_text = Some(cloze_text);
    item.cloze_ranges = Some(cloze_ranges);
    item.acceptance_id = acceptance_id.filter(|value| !value.trim().is_empty());
    item.proposal_id = proposal_id.filter(|value| !value.trim().is_empty());
    item.tags = extract.tags.clone();

    // Add "cloze" tag if not present
    if !item.tags.iter().any(|t| t == "cloze") {
        item.tags.push("cloze".to_string());
    }

    match repo.create_learning_item(&item).await {
        Ok(created) => Ok(created),
        Err(error) => {
            // Concurrent retry: unique (acceptance_id, proposal_id) index.
            if let (Some(acceptance), Some(proposal)) = (&item.acceptance_id, &item.proposal_id) {
                if let Some(existing) =
                    crate::commands::learning_item::find_learning_item_by_acceptance_key(
                        acceptance, proposal, &repo,
                    )
                    .await?
                {
                    return Ok(existing);
                }
            }
            Err(error)
        }
    }
}

/// Get all extracts that are due for review or are new
/// Bounded recent-extract read for the learning agent (task 1.3). Filters to
/// the frozen documents and returns at most 50 rows; never lists the whole
/// extract table into the WebView.
#[tauri::command]
pub async fn get_recent_extracts_bounded(
    document_ids: Option<Vec<String>>,
    limit: Option<i64>,
    repo: State<'_, Repository>,
) -> Result<Vec<Extract>> {
    let limit = limit.unwrap_or(10).clamp(1, 50);
    let (sql, bindings) = match document_ids.filter(|ids| !ids.is_empty()) {
        Some(ids) => {
            let placeholders: Vec<String> = (0..ids.len()).map(|_| "?".to_string()).collect();
            (
                format!(
                    "SELECT * FROM extracts WHERE document_id IN ({}) ORDER BY date_modified DESC LIMIT {}",
                    placeholders.join(","),
                    limit
                ),
                ids,
            )
        }
        None => (
            format!(
                "SELECT * FROM extracts ORDER BY date_modified DESC LIMIT {}",
                limit
            ),
            Vec::new(),
        ),
    };
    let mut query = sqlx::query(&sql);
    for id in bindings {
        query = query.bind(id);
    }
    let rows = query.fetch_all(repo.pool()).await?;
    let mut extracts = Vec::with_capacity(rows.len());
    for row in &rows {
        extracts.push(Repository::row_to_extract(row)?);
    }
    Ok(extracts)
}

#[tauri::command]
pub async fn get_reviewable_extracts(repo: State<'_, Repository>) -> Result<Vec<Extract>> {
    let now = Utc::now();
    let due_extracts = repo.get_due_extracts(&now).await?;
    let new_extracts = repo.get_new_extracts().await?;

    // Combine and return
    let mut all_extracts = due_extracts;
    all_extracts.extend(new_extracts);

    Ok(all_extracts)
}

/// Forget an extract: reset its memory state and return it to the new queue.
#[tauri::command]
pub async fn forget_extract(extract_id: String, repo: State<'_, Repository>) -> Result<()> {
    repo.forget_extract(&extract_id).await
}

/// Dismiss (or undismiss) an extract: removes it from the review queue
/// without deleting it.
#[tauri::command]
pub async fn dismiss_extract(
    extract_id: String,
    dismissed: Option<bool>,
    repo: State<'_, Repository>,
) -> Result<()> {
    let dismissed = dismissed.unwrap_or(true);
    repo.update_extract_dismissed(&extract_id, dismissed).await
}

/// Graduate an extract: schedule it ~5 years in the future with high stability,
/// signalling mastered material that has left active rotation.
#[tauri::command]
pub async fn graduate_extract(extract_id: String, repo: State<'_, Repository>) -> Result<()> {
    let far_future = Utc::now() + Duration::days(365 * 5);
    repo.graduate_extract(&extract_id, far_future).await
}

/// Create a Q&A card from an extract
#[tauri::command]
pub async fn create_qa_from_extract(
    extract_id: String,
    question: String,
    answer: String,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let extract = repo
        .get_extract(&extract_id)
        .await?
        .ok_or_else(|| crate::error::PlethoraError::NotFound(format!("Extract {}", extract_id)))?;

    let mut item = LearningItem::from_extract(
        extract.id.clone(),
        extract.document_id.clone(),
        ItemType::Qa,
        question,
        Some(answer),
    );

    item.tags = extract.tags.clone();

    repo.create_learning_item(&item).await
}
