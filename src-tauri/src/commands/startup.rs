//! Bounded, collection-scoped data needed for the first useful render.

use crate::commands::queue::get_startup_queue_preview_from_repo;
use crate::database::Repository;
use crate::models::{Collection, QueueItem, StartupDocumentSummary, DEFAULT_COLLECTION_ID};
use crate::services::PositionService;
use serde::Serialize;
use sqlx::Row;
use tauri::State;

const STARTUP_VERSION: u32 = 1;
const DEFAULT_DOCUMENT_LIMIT: u32 = 50;
const DEFAULT_QUEUE_LIMIT: u32 = 50;
const DEFAULT_PROGRESS_LIMIT: u32 = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupPage<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub has_more: bool,
    pub next_offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupProgressItem {
    pub id: String,
    pub progress: f32,
    pub title: String,
    pub date_modified: i32,
    pub date_added: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupSnapshot {
    pub version: u32,
    pub collections: Vec<Collection>,
    pub active_collection_id: String,
    pub documents: StartupPage<StartupDocumentSummary>,
    pub queue: StartupPage<QueueItem>,
    pub continue_reading: Vec<StartupProgressItem>,
    pub due_count: i64,
}

async fn resolve_active_collection(
    repo: &Repository,
    collections: &[Collection],
) -> Result<String, String> {
    let stored = sqlx::query("SELECT value FROM settings WHERE key = 'active_collection_id'")
        .fetch_optional(repo.pool())
        .await
        .map_err(|error| error.to_string())?
        .map(|row| row.get::<String, _>("value"));

    if let Some(id) = stored.filter(|id| collections.iter().any(|collection| collection.id == *id))
    {
        return Ok(id);
    }
    if let Some(default) = collections.iter().find(|collection| collection.is_default) {
        return Ok(default.id.clone());
    }
    if let Some(first) = collections.first() {
        return Ok(first.id.clone());
    }
    Ok(DEFAULT_COLLECTION_ID.to_string())
}

#[tauri::command]
pub async fn get_startup_snapshot(
    include_queue: Option<bool>,
    document_limit: Option<u32>,
    document_offset: Option<u32>,
    queue_limit: Option<u32>,
    queue_mode: Option<String>,
    progress_limit: Option<u32>,
    repo: State<'_, Repository>,
) -> Result<StartupSnapshot, String> {
    let document_limit = document_limit
        .unwrap_or(DEFAULT_DOCUMENT_LIMIT)
        .clamp(1, DEFAULT_DOCUMENT_LIMIT);
    let document_offset = document_offset.unwrap_or(0);
    let queue_limit = queue_limit
        .unwrap_or(DEFAULT_QUEUE_LIMIT)
        .clamp(1, DEFAULT_QUEUE_LIMIT);
    let progress_limit = progress_limit
        .unwrap_or(DEFAULT_PROGRESS_LIMIT)
        .clamp(1, DEFAULT_PROGRESS_LIMIT);
    let include_queue = include_queue.unwrap_or(false);

    let collections = repo
        .get_collections()
        .await
        .map_err(|error| error.to_string())?;
    let active_collection_id = resolve_active_collection(repo.inner(), &collections).await?;
    let service = PositionService::new(repo.pool().clone());

    let document_query = repo.list_startup_document_summaries(
        &active_collection_id,
        document_limit,
        document_offset,
    );
    let progress_query = service
        .get_documents_with_progress_for_collection(Some(progress_limit), &active_collection_id);
    let due_count_query = repo.get_collection_due_count(&active_collection_id);
    let queue_query = async {
        if include_queue {
            get_startup_queue_preview_from_repo(
                repo.inner(),
                Some(&active_collection_id),
                queue_limit,
                queue_mode.as_deref(),
            )
            .await
        } else {
            Ok((Vec::new(), 0))
        }
    };

    let ((documents, document_total), progress, due_count, (queue, queue_total)) =
        tokio::try_join!(document_query, progress_query, due_count_query, queue_query)
            .map_err(|error: crate::error::IncrementumError| error.to_string())?;

    let progress = progress
        .into_iter()
        .map(
            |(id, progress, title, date_modified, date_added)| StartupProgressItem {
                id,
                progress,
                title,
                date_modified,
                date_added,
            },
        )
        .collect::<Vec<_>>();

    Ok(StartupSnapshot {
        version: STARTUP_VERSION,
        collections,
        active_collection_id,
        documents: StartupPage {
            has_more: document_total > document_limit as i64,
            next_offset: (document_total > document_offset as i64 + document_limit as i64)
                .then_some(document_offset + document_limit),
            items: documents,
            total: document_total,
        },
        queue: StartupPage {
            has_more: queue_total > queue_limit as i64,
            next_offset: (queue_total > queue_limit as i64).then_some(queue_limit),
            items: queue,
            total: queue_total,
        },
        continue_reading: progress,
        due_count,
    })
}
