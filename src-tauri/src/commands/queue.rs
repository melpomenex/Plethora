//! Queue commands

use crate::algorithms::{calculate_fsrs_document_priority, QueueSelector};
use crate::database::Repository;
use crate::error::Result;
use crate::models::QueueItem;
use chrono::Utc;
use std::collections::{HashMap, HashSet};
use tauri::State;

fn preview_text(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let preview: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}...", preview)
    } else {
        preview
    }
}

/// Configuration for interspersing playlist videos in the queue
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistInterspersionConfig {
    /// Whether playlist video interspersion is enabled
    pub enabled: bool,
    /// Default interval for playlist videos (every N items)
    pub default_interval: i32,
    /// Maximum consecutive playlist videos
    pub max_consecutive: i32,
}

/// Get the next queue item
///
/// This uses the QueueSelector with weighted randomization to select the next item
/// from the queue, similar to the Incrementum-CPP implementation.
#[tauri::command]
pub async fn get_next_queue_item(
    randomness: Option<f32>,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Option<QueueItem>> {
    let queue = get_queue_with_collection(repo, collection_id.as_deref()).await?;
    if queue.is_empty() {
        return Ok(None);
    }

    let selector = QueueSelector::new(randomness.unwrap_or(0.3));
    Ok(selector.get_next_item(&queue).cloned())
}

/// Get multiple queue items
#[tauri::command]
pub async fn get_queue_items(
    count: Option<usize>,
    randomness: Option<f32>,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<QueueItem>> {
    let queue = get_queue_with_collection(repo, collection_id.as_deref()).await?;
    let count = count.unwrap_or(10).min(queue.len());

    let selector = QueueSelector::new(randomness.unwrap_or(0.3));
    Ok(selector
        .get_next_items(&queue, count)
        .into_iter()
        .cloned()
        .collect())
}

/// Internal function to get queue items from a repo reference
/// Used by other commands that already have State extracted
async fn get_queue_items_from_repo(
    repo: &Repository,
    collection_id: Option<&str>,
) -> Result<Vec<QueueItem>> {
    let mut queue_items = Vec::new();
    let now = Utc::now();

    let learning_items = repo.get_all_learning_items().await?;

    // Collect all unique document IDs upfront for batch lookup
    let mut all_doc_ids: HashSet<String> = HashSet::new();
    for item in &learning_items {
        if let Some(doc_id) = &item.document_id {
            all_doc_ids.insert(doc_id.clone());
        }
    }

    let due_extracts = repo.get_due_extracts(&now).await?;
    let new_extracts = repo.get_new_extracts().await?;
    let extracts: Vec<_> = due_extracts
        .into_iter()
        .chain(new_extracts.into_iter())
        .collect();
    for extract in &extracts {
        all_doc_ids.insert(extract.document_id.clone());
    }

    let due_video_extracts = repo.get_due_video_extracts(&now).await?;
    let new_video_extracts = repo.get_new_video_extracts().await.unwrap_or_default();
    let video_extracts: Vec<_> = due_video_extracts
        .into_iter()
        .chain(new_video_extracts.into_iter())
        .collect();
    for extract in &video_extracts {
        all_doc_ids.insert(extract.document_id.clone());
    }

    // Single batch query for all document titles
    let doc_ids: Vec<String> = all_doc_ids.into_iter().collect();
    let doc_titles = repo.get_document_titles(&doc_ids).await?;

    for item in learning_items {
        // Skip suspended items
        if item.is_suspended {
            continue;
        }

        // Filter by collection if specified
        if let Some(cid) = collection_id {
            if item.collection_id != cid {
                continue;
            }
        }

        let is_due = item.due_date <= now;
        let days_until_due = (item.due_date - now).num_days();

        let priority = if is_due {
            10.0 - (item.interval / 10.0)
        } else if days_until_due <= 1 {
            8.0
        } else if days_until_due <= 3 {
            6.0
        } else if days_until_due <= 7 {
            4.0
        } else {
            2.0
        };

        let estimated_time = match item.item_type {
            crate::models::ItemType::Cloze => 2,
            crate::models::ItemType::Qa => 3,
            _ => 1,
        };

        let progress = if item.review_count == 0 {
            0
        } else if item.interval >= 21.0 {
            100
        } else {
            ((item.interval) / 21.0 * 100.0) as i32
        };

        let document_title = item
            .document_id
            .as_ref()
            .and_then(|id| doc_titles.get(id))
            .cloned()
            .unwrap_or_else(|| "Unknown Document".to_string());

        queue_items.push(QueueItem {
            id: item.id.clone(),
            document_id: item.document_id.unwrap_or_default(),
            document_title,
            extract_id: item.extract_id.clone(),
            learning_item_id: Some(item.id.clone()),
            question: Some(item.question.clone()),
            answer: item.answer.clone(),
            cloze_text: item.cloze_text.clone(),
            learning_hint: None,
            item_type: "learning-item".to_string(),
            priority_rating: None,
            priority_slider: None,
            priority,
            due_date: Some(item.due_date.to_rfc3339()),
            estimated_time,
            tags: item.tags.clone(),
            category: None,
            progress,
            source: None,
            position: None,
            stability: item.memory_state.as_ref().map(|m| m.stability),
            difficulty: Some(item.difficulty as f64),
            interval: Some(item.interval),
            retrievability: None,
            lapses: Some(item.lapses),
            reps: Some(item.review_count),
        });
    }

    for extract in extracts {
        // Filter by collection if specified
        if let Some(cid) = collection_id {
            if extract.collection_id != cid {
                continue;
            }
        }

        let document_title = doc_titles
            .get(&extract.document_id)
            .cloned()
            .unwrap_or_else(|| "Unknown Document".to_string());

        // Blend inherited priority with review state. New extracts still get
        // a small boost over reviewed ones, but higher-priority documents
        // surface their extracts earlier (SuperMemo-style IR priority chain).
        const PRIORITY_SPAN: f64 = 2.0;
        let base_weight = if extract.review_count == 0 { 9.0 } else { 7.0 };
        let priority = base_weight + (extract.priority_score / 100.0) * PRIORITY_SPAN;

        let _content_preview = preview_text(&extract.content, 100);

        queue_items.push(QueueItem {
            id: extract.id.clone(),
            document_id: extract.document_id.clone(),
            document_title: format!("{} - Extract", document_title),
            extract_id: Some(extract.id.clone()),
            learning_item_id: None,
            question: None,
            answer: None,
            cloze_text: None,
            learning_hint: None,
            item_type: "extract".to_string(),
            priority_rating: None,
            priority_slider: None,
            priority,
            due_date: extract.next_review_date.map(|d| d.to_rfc3339()),
            estimated_time: 3,
            tags: extract.tags.clone(),
            category: extract.category.clone(),
            progress: 0,
            source: None,
            position: None,
            stability: None,
            difficulty: None,
            interval: None, // Extracts don't have interval
            retrievability: None,
            lapses: None,
            reps: Some(extract.review_count),
        });
    }

    for extract in video_extracts {
        // Filter by collection if specified
        if let Some(cid) = collection_id {
            if extract.collection_id != cid {
                continue;
            }
        }

        let document_title = doc_titles
            .get(&extract.document_id)
            .cloned()
            .unwrap_or_else(|| "Unknown Video".to_string());

        let priority = if extract.review_count == 0 { 8.5 } else { 6.5 };

        let duration_minutes = ((extract.end_time - extract.start_time) / 60.0).ceil() as i32;
        let estimated_time = duration_minutes.clamp(1, 10);

        let transcript_preview = extract
            .transcript_text
            .as_ref()
            .map(|t| preview_text(t, 100));

        queue_items.push(QueueItem {
            id: extract.id.clone(),
            document_id: extract.document_id.clone(),
            document_title: format!("{} - {}", document_title, extract.title),
            extract_id: None,
            learning_item_id: None,
            question: Some(format!(
                "Watch segment: {}",
                format_time_range(extract.start_time, extract.end_time)
            )),
            answer: transcript_preview,
            cloze_text: None,
            learning_hint: None,
            item_type: "video-extract".to_string(),
            priority_rating: None,
            priority_slider: None,
            priority,
            due_date: extract.next_review_date.map(|d| d.to_rfc3339()),
            estimated_time,
            tags: extract.tags.clone(),
            category: None,
            progress: 0,
            source: None,
            position: None,
            stability: None,
            difficulty: None,
            interval: None,
            retrievability: None,
            lapses: None,
            reps: Some(extract.review_count),
        });
    }

    // Get documents for incremental reading (without content column)
    let documents = repo.list_documents_for_queue().await?;
    for document in documents {
        if document.is_archived || document.is_dismissed {
            continue;
        }

        // Filter by collection if specified
        if let Some(cid) = collection_id {
            if document.collection_id != cid {
                continue;
            }
        }

        let progress = match (document.current_page, document.total_pages) {
            (Some(current), Some(total)) if total > 0 => {
                ((current as f64 / total as f64) * 100.0).round() as i32
            }
            _ => 0,
        };

        // Calculate FSRS-based priority for documents
        // This uses next_reading_date as the primary factor, with stability and
        // difficulty as secondary factors. The user's priority_rating acts as a multiplier.
        let priority = calculate_fsrs_document_priority(
            document.next_reading_date,
            document.stability,
            document.difficulty,
            document.priority_rating,
        );

        queue_items.push(QueueItem {
            id: document.id.clone(),
            document_id: document.id.clone(),
            document_title: document.title.clone(),
            extract_id: None,
            learning_item_id: None,
            question: None,
            answer: None,
            cloze_text: None,
            learning_hint: None,
            item_type: "document".to_string(),
            priority_rating: Some(document.priority_rating),
            priority_slider: Some(document.priority_slider),
            priority,
            due_date: document.next_reading_date.map(|d| d.to_rfc3339()),
            estimated_time: 5,
            tags: document.tags.clone(),
            category: document.category.clone(),
            progress,
            source: None,
            position: None,
            stability: document.stability,
            difficulty: document.difficulty,
            interval: None,
            retrievability: None,
            lapses: None,
            reps: document.reps,
        });
    }

    // Sort by priority (descending) then by due date (ascending)
    queue_items.sort_by(|a, b| {
        match b.priority.partial_cmp(&a.priority) {
            Some(std::cmp::Ordering::Equal) => {}
            Some(ord) => return ord,
            None => {}
        }

        match (&a.due_date, &b.due_date) {
            (Some(a_date), Some(b_date)) => a_date
                .partial_cmp(b_date)
                .unwrap_or(std::cmp::Ordering::Equal),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
    });

    tracing::info!(
        "[queue] get_queue_items_from_repo collection_id={:?} returned {} items",
        collection_id,
        queue_items.len()
    );
    Ok(queue_items)
}

/// Build only the bounded response needed for the first queue render. The
/// existing queue builder remains the source of truth for ordering and item
/// semantics; this helper prevents the large queue from crossing IPC and keeps
/// the startup contract explicit while the queue screen is visible.
pub(crate) async fn get_startup_queue_preview_from_repo(
    repo: &Repository,
    collection_id: Option<&str>,
    limit: u32,
    mode: Option<&str>,
) -> Result<(Vec<QueueItem>, i64)> {
    let mut queue = if mode == Some("due-today") {
        get_due_documents_only_from_repo(repo, collection_id).await?
    } else {
        get_due_queue_items_from_repo(repo, collection_id, None).await?
    };
    let total = queue.len() as i64;
    queue.truncate(limit.min(50) as usize);
    Ok((queue, total))
}

/// Helper to get queue with collection filtering (for commands that have State)
async fn get_queue_with_collection(
    repo: State<'_, Repository>,
    collection_id: Option<&str>,
) -> Result<Vec<QueueItem>> {
    get_queue_items_from_repo(repo.inner(), collection_id).await
}

/// Maximum length (in chars) of the pre-computed listing hint.
const LEARNING_HINT_MAX_CHARS: usize = 80;

/// Derive the short listing preview shown under a learning item's title in
/// queue views: cloze markers unwrapped, HTML stripped, whitespace collapsed,
/// truncated. Mirrors the old client-side `getLearningHint` logic so slim
/// listings keep the exact same hint UX without shipping full card content.
fn derive_learning_hint(cloze_text: Option<&str>, question: Option<&str>) -> Option<String> {
    let raw = match cloze_text.filter(|s| !s.is_empty()).or(question) {
        Some(raw) if !raw.is_empty() => raw,
        _ => return None,
    };
    lazy_static::lazy_static! {
        static ref CLOZE_RE: regex::Regex = regex::Regex::new(r"\[\[c\d+::(.*?)\]\]").unwrap();
        static ref TAG_RE: regex::Regex = regex::Regex::new(r"<[^>]*>").unwrap();
    }
    let no_cloze = CLOZE_RE.replace_all(raw, "$1");
    let no_html = TAG_RE.replace_all(&no_cloze, " ");
    let collapsed = no_html.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut hint: String = trimmed.chars().take(LEARNING_HINT_MAX_CHARS).collect();
    if trimmed.chars().count() > LEARNING_HINT_MAX_CHARS {
        hint.push('…');
    }
    Some(hint)
}

/// Slim a queue LISTING payload (design D2 of optimize-performance-hotspots):
/// drop per-item card content (`question`/`answer`/`cloze_text`) and replace it
/// with the bounded `learning_hint` preview. Applied only when a caller opts in
/// via `slim: true` — see [`apply_slim`] for why it is NOT the default.
fn strip_content_for_listing(items: &mut [QueueItem]) {
    for item in items.iter_mut() {
        if item.item_type == "learning-item" {
            item.learning_hint =
                derive_learning_hint(item.cloze_text.as_deref(), item.question.as_deref());
        }
        item.question = None;
        item.answer = None;
        item.cloze_text = None;
    }
}

/// Apply listing-slim iff explicitly requested. The default (`None`) is FALSE —
/// full content is retained — because the frontend stores a queue listing as
/// the shared `state.items`, which backs content-dependent features
/// (semantic-study focal-topic filtering, the semantic graph, schedule titles)
/// that read question/answer/cloze_text. Stripping by default silently degraded
/// those (the optimize-performance-hotspots review caught it), and the
/// truncated `learning_hint` is lossy for topic matching. Slim is opt-in infra
/// for a future dedicated listing that does not back those features.
fn apply_slim(items: &mut [QueueItem], slim: Option<bool>) {
    if slim.unwrap_or(false) {
        strip_content_for_listing(items);
    }
}

/// Get all queue items
///
/// This returns all items that should be in the queue, including:
/// - Learning items that are due
/// - Documents scheduled for reading (based on next_reading_date)
/// - Documents without scheduled dates (for initial reading)
///
/// `slim` (default FALSE) omits card content fields from the payload and
/// populates `learning_hint` instead. It defaults OFF because the frontend
/// stores this result as the shared queue `state.items`, which backs
/// content-dependent features — semantic-study focal-topic filtering, the
/// semantic graph, and schedule titles all read question/answer/cloze_text
/// from it. Stripping by default silently degraded those features (see the
/// optimize-performance-hotspots review), and `learning_hint` (an ~80-char
/// truncated preview) is lossy for topic matching / similarity. Slimming is
/// kept as explicit opt-in for a future dedicated listing that does NOT back
/// those features; today no caller passes it. The realized queue win is the
/// per-mutation local delta application, not listing slimming.
#[tauri::command]
pub async fn get_queue(
    collection_id: Option<String>,
    slim: Option<bool>,
    repo: State<'_, Repository>,
) -> Result<Vec<QueueItem>> {
    let mut items = get_queue_items_from_repo(repo.inner(), collection_id.as_deref()).await?;
    apply_slim(&mut items, slim);
    Ok(items)
}

/// Get queued items (items that are due or should be in the reading queue)
///
/// `slim` behaves as in [`get_queue`] (default FALSE — see that doc comment).
#[tauri::command]
pub async fn get_queued_items(
    randomness: Option<f32>,
    collection_id: Option<String>,
    slim: Option<bool>,
    repo: State<'_, Repository>,
) -> Result<Vec<QueueItem>> {
    let queue = get_queue_with_collection(repo, collection_id.as_deref()).await?;
    let selector = QueueSelector::new(randomness.unwrap_or(0.3));

    // Filter and sort using the queue selector
    let mut queued_items: Vec<QueueItem> = selector
        .get_queued_items(&queue)
        .into_iter()
        .cloned()
        .collect();

    selector.sort_queue_items(&mut queued_items);
    apply_slim(&mut queued_items, slim);
    Ok(queued_items)
}

async fn get_due_queue_items_from_repo(
    repo: &Repository,
    collection_id: Option<&str>,
    randomness: Option<f32>,
) -> Result<Vec<QueueItem>> {
    let mut queue_items = Vec::new();
    let now = Utc::now();

    let learning_items = repo.get_due_learning_items(&now, collection_id).await?;
    let due_extracts = repo.get_due_extracts(&now).await?;
    let new_extracts = repo.get_new_extracts().await?;
    let extracts: Vec<_> = due_extracts
        .into_iter()
        .chain(new_extracts.into_iter())
        .collect();
    let due_video_extracts = repo.get_due_video_extracts(&now).await?;
    let new_video_extracts = repo.get_new_video_extracts().await.unwrap_or_default();
    let video_extracts: Vec<_> = due_video_extracts
        .into_iter()
        .chain(new_video_extracts.into_iter())
        .collect();
    let documents = repo
        .list_due_documents_for_queue(&now, collection_id)
        .await?;

    let mut all_doc_ids: HashSet<String> = HashSet::new();
    for item in &learning_items {
        if let Some(doc_id) = &item.document_id {
            all_doc_ids.insert(doc_id.clone());
        }
    }
    for extract in &extracts {
        if collection_id.is_none_or(|cid| extract.collection_id == cid) {
            all_doc_ids.insert(extract.document_id.clone());
        }
    }
    for extract in &video_extracts {
        if collection_id.is_none_or(|cid| extract.collection_id == cid) {
            all_doc_ids.insert(extract.document_id.clone());
        }
    }

    let doc_ids: Vec<String> = all_doc_ids.into_iter().collect();
    let doc_titles = repo.get_document_titles(&doc_ids).await?;

    for item in learning_items {
        let priority = 10.0 - (item.interval / 10.0);
        let estimated_time = match item.item_type {
            crate::models::ItemType::Cloze => 2,
            crate::models::ItemType::Qa => 3,
            _ => 1,
        };
        let progress = if item.review_count == 0 {
            0
        } else if item.interval >= 21.0 {
            100
        } else {
            ((item.interval) / 21.0 * 100.0) as i32
        };
        let document_title = item
            .document_id
            .as_ref()
            .and_then(|id| doc_titles.get(id))
            .cloned()
            .unwrap_or_else(|| "Unknown Document".to_string());

        queue_items.push(QueueItem {
            id: item.id.clone(),
            document_id: item.document_id.unwrap_or_default(),
            document_title,
            extract_id: item.extract_id.clone(),
            learning_item_id: Some(item.id.clone()),
            question: Some(item.question.clone()),
            answer: item.answer.clone(),
            cloze_text: item.cloze_text.clone(),
            learning_hint: None,
            item_type: "learning-item".to_string(),
            priority_rating: None,
            priority_slider: None,
            priority,
            due_date: Some(item.due_date.to_rfc3339()),
            estimated_time,
            tags: item.tags.clone(),
            category: None,
            progress,
            source: None,
            position: None,
            stability: item.memory_state.as_ref().map(|m| m.stability),
            difficulty: Some(item.difficulty as f64),
            interval: Some(item.interval),
            retrievability: None,
            lapses: Some(item.lapses),
            reps: Some(item.review_count),
        });
    }

    for extract in extracts {
        if let Some(cid) = collection_id {
            if extract.collection_id != cid {
                continue;
            }
        }

        let document_title = doc_titles
            .get(&extract.document_id)
            .cloned()
            .unwrap_or_else(|| "Unknown Document".to_string());
        const PRIORITY_SPAN: f64 = 2.0;
        let base_weight = if extract.review_count == 0 { 9.0 } else { 7.0 };
        let priority = base_weight + (extract.priority_score / 100.0) * PRIORITY_SPAN;

        queue_items.push(QueueItem {
            id: extract.id.clone(),
            document_id: extract.document_id.clone(),
            document_title: format!("{} - Extract", document_title),
            extract_id: Some(extract.id.clone()),
            learning_item_id: None,
            question: None,
            answer: None,
            cloze_text: None,
            learning_hint: None,
            item_type: "extract".to_string(),
            priority_rating: None,
            priority_slider: None,
            priority,
            due_date: extract.next_review_date.map(|d| d.to_rfc3339()),
            estimated_time: 3,
            tags: extract.tags.clone(),
            category: extract.category.clone(),
            progress: 0,
            source: None,
            position: None,
            stability: None,
            difficulty: None,
            interval: None,
            retrievability: None,
            lapses: None,
            reps: Some(extract.review_count),
        });
    }

    for extract in video_extracts {
        if let Some(cid) = collection_id {
            if extract.collection_id != cid {
                continue;
            }
        }

        let document_title = doc_titles
            .get(&extract.document_id)
            .cloned()
            .unwrap_or_else(|| "Unknown Video".to_string());
        let priority = if extract.review_count == 0 { 8.5 } else { 6.5 };
        let duration_minutes = ((extract.end_time - extract.start_time) / 60.0).ceil() as i32;
        let estimated_time = duration_minutes.clamp(1, 10);
        let transcript_preview = extract
            .transcript_text
            .as_ref()
            .map(|t| preview_text(t, 100));

        queue_items.push(QueueItem {
            id: extract.id.clone(),
            document_id: extract.document_id.clone(),
            document_title: format!("{} - {}", document_title, extract.title),
            extract_id: None,
            learning_item_id: None,
            question: Some(format!(
                "Watch segment: {}",
                format_time_range(extract.start_time, extract.end_time)
            )),
            answer: transcript_preview,
            cloze_text: None,
            learning_hint: None,
            item_type: "video-extract".to_string(),
            priority_rating: None,
            priority_slider: None,
            priority,
            due_date: extract.next_review_date.map(|d| d.to_rfc3339()),
            estimated_time,
            tags: extract.tags.clone(),
            category: None,
            progress: 0,
            source: None,
            position: None,
            stability: None,
            difficulty: None,
            interval: None,
            retrievability: None,
            lapses: None,
            reps: Some(extract.review_count),
        });
    }

    for document in documents {
        let progress = match (document.current_page, document.total_pages) {
            (Some(current), Some(total)) if total > 0 => {
                ((current as f64 / total as f64) * 100.0).round() as i32
            }
            _ => 0,
        };
        let priority = calculate_fsrs_document_priority(
            document.next_reading_date,
            document.stability,
            document.difficulty,
            document.priority_rating,
        );

        queue_items.push(QueueItem {
            id: document.id.clone(),
            document_id: document.id.clone(),
            document_title: document.title.clone(),
            extract_id: None,
            learning_item_id: None,
            question: None,
            answer: None,
            cloze_text: None,
            learning_hint: None,
            item_type: "document".to_string(),
            priority_rating: Some(document.priority_rating),
            priority_slider: Some(document.priority_slider),
            priority,
            due_date: document.next_reading_date.map(|d| d.to_rfc3339()),
            estimated_time: 5,
            tags: document.tags.clone(),
            category: document.category.clone(),
            progress,
            source: None,
            position: None,
            stability: document.stability,
            difficulty: document.difficulty,
            interval: None,
            retrievability: None,
            lapses: None,
            reps: document.reps,
        });
    }

    let selector = QueueSelector::new(randomness.unwrap_or(0.3));
    selector.sort_queue_items(&mut queue_items);
    tracing::debug!(
        "[queue] get_due_queue_items_from_repo collection_id={:?} returned {} items",
        collection_id,
        queue_items.len()
    );
    Ok(queue_items)
}

/// Get due queue items only
#[tauri::command]
pub async fn get_due_queue_items(
    randomness: Option<f32>,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<QueueItem>> {
    get_due_queue_items_from_repo(repo.inner(), collection_id.as_deref(), randomness).await
}

/// Get only due documents (excluding learning items and extracts)
///
/// This provides a "Due Today" view focused specifically on documents that
/// are scheduled for reading via FSRS (next_reading_date <= now) or have
/// never been read (next_reading_date is NULL).
async fn get_due_documents_only_from_repo(
    repo: &Repository,
    collection_id: Option<&str>,
) -> Result<Vec<QueueItem>> {
    let mut due_documents = Vec::new();
    let now = Utc::now();

    let documents = repo
        .list_due_documents_for_queue(&now, collection_id)
        .await?;

    for document in documents {
        let progress = match (document.current_page, document.total_pages) {
            (Some(current), Some(total)) if total > 0 => {
                ((current as f64 / total as f64) * 100.0).round() as i32
            }
            _ => 0,
        };

        // Calculate FSRS-based priority
        let priority = calculate_fsrs_document_priority(
            document.next_reading_date,
            document.stability,
            document.difficulty,
            document.priority_rating,
        );

        due_documents.push(QueueItem {
            id: document.id.clone(),
            document_id: document.id.clone(),
            document_title: document.title.clone(),
            extract_id: None,
            learning_item_id: None,
            question: None,
            answer: None,
            cloze_text: None,
            learning_hint: None,
            item_type: "document".to_string(),
            priority_rating: Some(document.priority_rating),
            priority_slider: Some(document.priority_slider),
            priority,
            due_date: document.next_reading_date.map(|d| d.to_rfc3339()),
            estimated_time: 5,
            tags: document.tags.clone(),
            category: document.category.clone(),
            progress,
            source: None,
            position: None,
            stability: document.stability,
            difficulty: document.difficulty,
            interval: None,
            retrievability: None,
            lapses: None,
            reps: document.reps,
        });
    }

    // Sort using FSRS-based priority
    let selector = QueueSelector::new(0.0); // No randomness for due documents
    selector.sort_queue_items(&mut due_documents);

    Ok(due_documents)
}

#[tauri::command]
pub async fn get_due_documents_only(
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<QueueItem>> {
    get_due_documents_only_from_repo(repo.inner(), collection_id.as_deref()).await
}

/// Get queue with playlist videos interspersed
///
/// This returns the queue with playlist videos inserted at regular intervals
/// based on each subscription's queue_intersperse_interval setting.
#[tauri::command]
pub async fn get_queue_with_playlist_intersperse(
    randomness: Option<f32>,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<QueueItem>> {
    let mut queue = get_queue_items_from_repo(repo.inner(), collection_id.as_deref()).await?;

    let settings = match repo.get_playlist_settings().await {
        Ok(s) => s,
        Err(_) => return Ok(queue), // Return base queue if settings fail
    };

    // If playlist integration is disabled, return base queue
    if !settings.enabled {
        return Ok(queue);
    }

    let playlist_videos = match repo.get_videos_for_queue_interspersion().await {
        Ok(v) => v,
        Err(_) => return Ok(queue),
    };

    if playlist_videos.is_empty() {
        return Ok(queue);
    }

    // Get subscription info for each video to determine intersperse interval
    let mut playlist_queue_items: Vec<QueueItem> = Vec::new();

    // Batch collect all document IDs and subscription IDs
    let doc_ids: Vec<String> = playlist_videos
        .iter()
        .filter_map(|v| v.document_id.clone())
        .collect();
    let sub_ids: Vec<String> = playlist_videos
        .iter()
        .map(|v| v.subscription_id.clone())
        .collect();

    // Batch fetch documents and subscriptions
    let docs_map = repo
        .get_documents_by_ids(&doc_ids)
        .await
        .unwrap_or_default();
    let subs_map = repo
        .get_playlist_subscriptions_by_ids(&sub_ids)
        .await
        .unwrap_or_default();

    for video in playlist_videos {
        if let Some(doc_id) = &video.document_id {
            if let Some(doc) = docs_map.get(doc_id) {
                if let Some(sub) = subs_map.get(&video.subscription_id) {
                    if sub.is_active {
                        let progress = match (doc.current_page, doc.total_pages) {
                            (Some(current), Some(total)) if total > 0 => {
                                ((current as f64 / total as f64) * 100.0).round() as i32
                            }
                            _ => 0,
                        };

                        let priority = calculate_fsrs_document_priority(
                            doc.next_reading_date,
                            doc.stability,
                            doc.difficulty,
                            sub.priority_rating,
                        );

                        playlist_queue_items.push(QueueItem {
                            id: video.id.clone(),
                            document_id: doc.id.clone(),
                            document_title: doc.title.clone(),
                            extract_id: None,
                            learning_item_id: None,
                            question: None,
                            answer: None,
                            cloze_text: None,
                            learning_hint: None,
                            item_type: "playlist-video".to_string(),
                            priority_rating: Some(sub.priority_rating),
                            priority_slider: None,
                            priority,
                            due_date: doc.next_reading_date.map(|d| d.to_rfc3339()),
                            estimated_time: doc.total_pages.map(|p| p / 60).unwrap_or(10),
                            tags: vec!["playlist".to_string()],
                            category: Some("YouTube Playlist".to_string()),
                            progress,
                            source: Some(format!("playlist:{}", sub.id)),
                            position: Some(sub.queue_intersperse_interval),
                            stability: doc.stability,
                            difficulty: doc.difficulty,
                            interval: None,
                            retrievability: None,
                            lapses: None,
                            reps: doc.reps,
                        });
                    }
                }
            }
        }
    }

    // Now intersperse playlist videos into the base queue
    // Group playlist videos by their intersperse interval
    let mut result: Vec<QueueItem> = Vec::new();
    let mut playlist_idx = 0;
    let mut position_counters: std::collections::HashMap<i32, i32> =
        std::collections::HashMap::new();

    for (idx, item) in queue.iter().enumerate() {
        // Add the regular queue item
        result.push(item.clone());

        // We try to insert at positions that are multiples of the interval
        if playlist_idx < playlist_queue_items.len() {
            let playlist_video = &playlist_queue_items[playlist_idx];

            if let Some(interval) = playlist_video.position {
                let counter = position_counters.entry(interval).or_insert(0);
                *counter += 1;

                // Insert a playlist video every 'interval' items
                if *counter >= interval {
                    result.push(playlist_queue_items[playlist_idx].clone());
                    playlist_idx += 1;
                    *counter = 0;

                    // Mark this video as added to queue
                    let _ = repo
                        .mark_video_added_to_queue(&playlist_video.id, idx as i32)
                        .await;

                    if playlist_idx >= playlist_queue_items.len() {
                        break;
                    }
                }
            }
        }
    }

    // Add any remaining regular queue items
    if result.len() < queue.len() {
        result.extend(queue[result.len() - playlist_idx..].iter().cloned());
    }

    Ok(result)
}

/// Format time range as MM:SS-MM:SS or HH:MM:SS-HH:MM:SS
fn format_time_range(start: f64, end: f64) -> String {
    format!("{}-{}", format_seconds(start), format_seconds(end))
}

/// Format seconds as MM:SS or HH:MM:SS
fn format_seconds(seconds: f64) -> String {
    let total_seconds = seconds as i64;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let secs = total_seconds % 60;

    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{}:{:02}", minutes, secs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::database::Repository;
    use crate::models::{Document, FileType};
    use std::path::PathBuf;

    #[test]
    fn derive_learning_hint_strips_cloze_html_and_truncates() {
        assert_eq!(
            derive_learning_hint(
                Some("The [[c1::mitochondria]] is the <b>powerhouse</b>"),
                None
            ),
            Some("The mitochondria is the powerhouse".to_string())
        );
        // Falls back to question when cloze text is absent/empty.
        assert_eq!(
            derive_learning_hint(Some(""), Some("<p>What   is\nRust?</p>")),
            Some("What is Rust?".to_string())
        );
        assert_eq!(derive_learning_hint(None, None), None);
        assert_eq!(derive_learning_hint(Some("<p></p>"), None), None);
        // Truncation appends an ellipsis and respects char boundaries.
        let long = "x".repeat(200);
        let hint = derive_learning_hint(None, Some(&long)).unwrap();
        assert_eq!(hint.chars().count(), LEARNING_HINT_MAX_CHARS + 1);
        assert!(hint.ends_with('…'));
    }

    #[test]
    fn strip_content_for_listing_removes_content_and_populates_hint() {
        let mut items = vec![QueueItem {
            id: "i1".into(),
            document_id: "d1".into(),
            document_title: "Doc".into(),
            extract_id: None,
            learning_item_id: Some("i1".into()),
            question: Some("What is <i>FSRS</i>?".into()),
            answer: Some("A scheduler".into()),
            cloze_text: None,
            learning_hint: None,
            item_type: "learning-item".into(),
            priority_rating: None,
            priority_slider: None,
            priority: 1.0,
            due_date: None,
            estimated_time: 1,
            tags: vec![],
            category: None,
            progress: 0,
            source: None,
            position: None,
            stability: None,
            difficulty: None,
            interval: None,
            retrievability: None,
            lapses: None,
            reps: None,
        }];

        strip_content_for_listing(&mut items);

        let item = &items[0];
        assert_eq!(item.question, None);
        assert_eq!(item.answer, None);
        assert_eq!(item.cloze_text, None);
        // Tag replacement inserts a space (parity with the historical
        // client-side getLearningHint: `<i>FSRS</i>?` → "FSRS ?").
        assert_eq!(item.learning_hint.as_deref(), Some("What is FSRS ?"));
    }

    fn listing_item() -> QueueItem {
        QueueItem {
            id: "i1".into(),
            document_id: "d1".into(),
            document_title: "Doc".into(),
            extract_id: None,
            learning_item_id: Some("i1".into()),
            question: Some("What is FSRS?".into()),
            answer: Some("A scheduler".into()),
            cloze_text: Some("[[c1::spaced repetition]]".into()),
            learning_hint: None,
            item_type: "learning-item".into(),
            priority_rating: None,
            priority_slider: None,
            priority: 1.0,
            due_date: None,
            estimated_time: 1,
            tags: vec![],
            category: None,
            progress: 0,
            source: None,
            position: None,
            stability: None,
            difficulty: None,
            interval: None,
            retrievability: None,
            lapses: None,
            reps: None,
        }
    }

    // Regression guard for the optimize-performance-hotspots review: the queue
    // listing default MUST retain card content, because the frontend stores it
    // as the shared state.items that backs semantic-study / graph / schedule.
    // Defaulting to slim=true silently broke those; this pins slim as opt-in.
    #[test]
    fn apply_slim_defaults_to_full_content() {
        let mut items = vec![listing_item()];
        apply_slim(&mut items, None); // no arg passed by the frontend
        assert_eq!(items[0].question.as_deref(), Some("What is FSRS?"));
        assert_eq!(
            items[0].cloze_text.as_deref(),
            Some("[[c1::spaced repetition]]")
        );
        assert_eq!(items[0].answer.as_deref(), Some("A scheduler"));

        let mut items = vec![listing_item()];
        apply_slim(&mut items, Some(false));
        assert_eq!(items[0].question.as_deref(), Some("What is FSRS?"));
    }

    #[test]
    fn apply_slim_strips_only_when_opted_in() {
        let mut items = vec![listing_item()];
        apply_slim(&mut items, Some(true));
        assert_eq!(items[0].question, None);
        assert_eq!(items[0].cloze_text, None);
        assert_eq!(items[0].answer, None);
        assert_eq!(items[0].learning_hint.as_deref(), Some("spaced repetition"));
    }

    async fn setup_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    async fn create_test_document(
        repo: &Repository,
        title: &str,
        dismissed: bool,
        archived: bool,
    ) -> Document {
        let mut document = Document::new(
            title.to_string(),
            format!("/tmp/{title}.pdf"),
            FileType::Pdf,
        );
        document.is_archived = archived;
        let created = repo
            .create_document(&document)
            .await
            .expect("create document");
        if dismissed {
            repo.update_document_dismiss(&created.id, true)
                .await
                .expect("dismiss document")
        } else {
            created
        }
    }

    #[tokio::test]
    async fn queue_excludes_dismissed_documents() {
        let repo = setup_repo().await;
        let visible = create_test_document(&repo, "visible-doc", false, false).await;
        let dismissed = create_test_document(&repo, "dismissed-doc", true, false).await;

        let queue = get_queue_items_from_repo(&repo, None).await.expect("queue");

        assert!(queue.iter().any(|item| item.document_id == visible.id));
        assert!(!queue.iter().any(|item| item.document_id == dismissed.id));
    }

    #[tokio::test]
    async fn due_documents_exclude_dismissed_documents() {
        let repo = setup_repo().await;
        let visible = create_test_document(&repo, "visible-due-doc", false, false).await;
        let dismissed = create_test_document(&repo, "dismissed-due-doc", true, false).await;

        let due_document_ids: Vec<String> = get_due_documents_only_from_repo(&repo, None)
            .await
            .expect("due documents")
            .into_iter()
            .map(|item| item.document_id)
            .collect();

        assert!(due_document_ids.contains(&visible.id));
        assert!(!due_document_ids.contains(&dismissed.id));
    }

    #[tokio::test]
    async fn startup_queue_preview_is_collection_scoped_and_bounded() {
        let repo = setup_repo().await;
        for index in 0..3 {
            create_test_document(&repo, &format!("startup-{index}"), false, false).await;
        }

        let (items, total) = get_startup_queue_preview_from_repo(
            &repo,
            Some(crate::models::DEFAULT_COLLECTION_ID),
            2,
            Some("due-today"),
        )
        .await
        .expect("startup queue preview");
        assert_eq!(items.len(), 2);
        assert_eq!(total, 3);
    }
}
