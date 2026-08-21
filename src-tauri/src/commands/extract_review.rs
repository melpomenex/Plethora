//! Extract review commands

use crate::database::{ItemActivityRepository, Repository};
use crate::error::Result;
use crate::models::item_activity::{ActivityItemType, ActivitySurface, ItemActivityEvent};
use crate::models::{Extract, ItemType, LearningItem, MemoryState};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractReviewResult {
    pub extract: Extract,
    pub next_review_date: String,
}

/// Submit a review for an extract
/// This schedules the next review using a simplified FSRS-like approach for extracts
///
/// `time_taken` is the *active* seconds the user spent on the extract, as
/// measured by the frontend tracker. It is accumulated into the extract's
/// cumulative total and recorded as one history row, giving extracts the same
/// time story documents and flashcards already had.
#[tauri::command]
pub async fn submit_extract_review(
    extract_id: String,
    rating: i32, // 1=Again, 2=Hard, 3=Good, 4=Easy
    time_taken: i32,
    repo: State<'_, Repository>,
) -> Result<Extract> {
    let mut extract = repo.get_extract(&extract_id).await?.ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Extract {}", extract_id))
    })?;

    let now = Utc::now();

    if extract.memory_state.is_none() {
        extract.memory_state = Some(MemoryState {
            stability: 0.5,  // Initial stability (in days)
            difficulty: 5.0, // Initial difficulty
        });
    }

    let mut memory = extract
        .memory_state
        .expect("memory_state must be set for review");

    // Simplified FSRS logic for extracts (prioritize reading over precise memory retention)
    // Extracts are usually "read and processed", not memorized verbatim
    let new_interval_days = match rating {
        1 => 1.0, // Again: Review tomorrow
        2 => {
            // Hard: maintain or slight increase
            memory.difficulty = (memory.difficulty + 1.0).min(10.0);
            (memory.stability * 1.2).max(1.0)
        }
        3 => {
            // Good: standard increase
            memory.stability = (memory.stability * 2.5).max(1.0);
            memory.stability
        }
        4 => {
            // Easy: large increase (processed well)
            memory.stability = (memory.stability * 4.0).max(1.0);
            memory.difficulty = (memory.difficulty - 1.0).max(1.0);
            memory.stability
        }
        _ => memory.stability,
    };

    memory.stability = new_interval_days;
    let memory_stability = memory.stability;
    let memory_difficulty = memory.difficulty;
    extract.memory_state = Some(memory);

    // Calculate new date
    let next_date = now + Duration::days(new_interval_days as i64);

    repo.update_extract_scheduling(
        &extract.id,
        Some(next_date),
        Some(memory_stability),
        Some(memory_difficulty),
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
    extract.next_review_date = Some(next_date);
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
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let extract = repo.get_extract(&extract_id).await?.ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Extract {}", extract_id))
    })?;

    let mut item = LearningItem::from_extract(
        extract.id.clone(),
        extract.document_id.clone(),
        ItemType::Cloze,
        "Cloze Deletion".to_string(), // Placeholder question, real content is in cloze_text
        None,
    );

    item.cloze_text = Some(cloze_text);
    item.cloze_ranges = Some(cloze_ranges);
    item.tags = extract.tags.clone();

    // Add "cloze" tag if not present
    if !item.tags.iter().any(|t| t == "cloze") {
        item.tags.push("cloze".to_string());
    }

    repo.create_learning_item(&item).await
}

/// Get all extracts that are due for review or are new
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
    let extract = repo.get_extract(&extract_id).await?.ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Extract {}", extract_id))
    })?;

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
