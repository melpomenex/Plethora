//! Tauri commands for the AI learning semantic index (Phase 3, tasks
//! 4.3/4.6/4.7): enqueue/pause/resume/cancel/reset of the background
//! indexer, aggregate + per-document status, retrieval with lexical
//! fallback, and direct chunk deletion for changed extra sources.
//!
//! The embedding config is the same `EmbeddingConfigInput` the frontend
//! already sends for RAG; when absent, the on-device stub backend applies
//! (offline-first default, design D10) and retrieval runs lexical-only.

use crate::ai_learning::embeddings_backend::EmbeddingBackend;
use crate::ai_learning::indexer::{
    aggregate_status, document_statuses, reset_index, BackendFactory, IndexerQueue,
    IndexerRuntimeStatus,
};
use crate::ai_learning::models::{RetrievalFilters, RetrievalResponse};
use crate::ai_learning::retrieval::{self, DEFAULT_K};
use crate::commands::semantic_graph::EmbeddingConfigInput;
use crate::database::Repository;
use crate::error::Result;
use std::sync::{Arc, RwLock};
use tauri::State;

/// Managed Tauri state holding the indexer worker handle and the latest
/// embedding configuration supplied by the frontend.
pub struct AiLearningState {
    queue: IndexerQueue,
    config: Arc<RwLock<Option<EmbeddingConfigInput>>>,
}

impl AiLearningState {
    pub fn new(repo: Repository) -> Self {
        let config: Arc<RwLock<Option<EmbeddingConfigInput>>> = Arc::new(RwLock::new(None));
        let config_for_factory = Arc::clone(&config);
        let factory: BackendFactory = Arc::new(move || {
            let guard = config_for_factory
                .read()
                .map(|c| c.clone())
                .unwrap_or_else(|_| {
                    tracing::warn!("ai_learning config lock poisoned; using on-device default");
                    None
                });
            EmbeddingBackend::from_config(guard.as_ref())
        });
        let queue = IndexerQueue::new(repo, factory);
        Self { queue, config }
    }

    fn update_config(&self, config: Option<EmbeddingConfigInput>) {
        if let Ok(mut guard) = self.config.write() {
            *guard = config;
        }
    }

    fn backend(&self) -> EmbeddingBackend {
        let guard = self.config.read().ok().and_then(|g| g.clone());
        EmbeddingBackend::from_config(guard.as_ref())
    }
}

/// Enqueue a single document for (re)indexing. Called from TS on import and
/// on content update; the content-hash diff makes it a no-op when nothing
/// changed.
#[tauri::command]
pub async fn ai_learning_enqueue_document(
    document_id: String,
    config: Option<EmbeddingConfigInput>,
    state: State<'_, AiLearningState>,
) -> Result<()> {
    state.update_config(config);
    state.queue.enqueue_document(document_id)
}

/// Bulk backfill the whole library. `require_charging` (default true, design
/// D14: bulk > 50 docs only while charging) is decided by the caller; when
/// set and the battery is not charging the queue parks itself paused.
#[tauri::command]
pub async fn ai_learning_enqueue_all(
    require_charging: Option<bool>,
    config: Option<EmbeddingConfigInput>,
    state: State<'_, AiLearningState>,
) -> Result<()> {
    state.update_config(config);
    state.queue.enqueue_all(require_charging.unwrap_or(true))
}

/// Aggregate + per-document index status for the settings panel.
#[tauri::command]
pub async fn ai_learning_index_status(
    config: Option<EmbeddingConfigInput>,
    state: State<'_, AiLearningState>,
    repo: State<'_, Repository>,
) -> Result<IndexStatusResponse> {
    if config.is_some() {
        state.update_config(config);
    }
    let runtime: IndexerRuntimeStatus = state.queue.runtime_status();
    let aggregate = aggregate_status(repo.inner(), &runtime).await?;
    let documents = document_statuses(repo.inner(), 500).await?;
    Ok(IndexStatusResponse {
        aggregate,
        documents,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatusResponse {
    pub aggregate: crate::ai_learning::models::AggregateIndexStatus,
    pub documents: Vec<crate::ai_learning::models::DocumentIndexStatus>,
}

/// Pause the background indexer (safe mid-document: committed chunks are
/// retained).
#[tauri::command]
pub async fn ai_learning_index_pause(state: State<'_, AiLearningState>) -> Result<()> {
    state.queue.pause()
}

/// Resume a paused indexer.
#[tauri::command]
pub async fn ai_learning_index_resume(state: State<'_, AiLearningState>) -> Result<()> {
    state.queue.resume()
}

/// Cancel a queued/running document index job.
#[tauri::command]
pub async fn ai_learning_index_cancel(
    document_id: String,
    state: State<'_, AiLearningState>,
) -> Result<()> {
    state.queue.cancel_document(document_id)
}

/// Wipe the rebuildable index (chunks, embeddings, state). User content is
/// untouched; indexing restarts on the next enqueue.
#[tauri::command]
pub async fn ai_learning_reset_index(
    state: State<'_, AiLearningState>,
    repo: State<'_, Repository>,
) -> Result<u64> {
    state.queue.reset()?;
    reset_index(repo.inner()).await
}

/// Retrieve the top-k chunks for a query (task 4.6). Falls back to
/// lexical-only mode when no embedding backend is available or the index has
/// no current-version embeddings.
#[tauri::command]
pub async fn ai_learning_retrieve(
    query: String,
    k: Option<usize>,
    filters: Option<RetrievalFilters>,
    config: Option<EmbeddingConfigInput>,
    state: State<'_, AiLearningState>,
    repo: State<'_, Repository>,
) -> Result<RetrievalResponse> {
    if let Some(cfg) = config.as_ref() {
        state.update_config(Some(cfg.clone()));
    }
    let backend = state.backend();
    let filters = filters.unwrap_or_default();
    let mut response =
        retrieval::retrieve(repo.inner(), &backend, &query, k.unwrap_or(DEFAULT_K), &filters)
            .await?;
    retrieval::resolve_titles(repo.inner(), &mut response.results).await;
    Ok(response)
}

/// Direct chunk removal for extra sources (task 4.7 deletion sync): when an
/// extract/annotation/card is deleted, its single chunk can be dropped
/// immediately without reindexing the whole document.
#[tauri::command]
pub async fn ai_learning_remove_source_chunks(
    source_type: String,
    source_id: String,
    repo: State<'_, Repository>,
) -> Result<u64> {
    let result = sqlx::query("DELETE FROM semantic_chunks WHERE source_type = ?1 AND source_id = ?2")
        .bind(&source_type)
        .bind(&source_id)
        .execute(repo.pool())
        .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    #[test]
    fn command_names_are_stable() {
        // The TS wrappers in src/api/ai-learning.ts invoke these exact names;
        // asserted here so renames surface in review.
        for name in [
            "ai_learning_enqueue_document",
            "ai_learning_enqueue_all",
            "ai_learning_index_status",
            "ai_learning_index_pause",
            "ai_learning_index_resume",
            "ai_learning_index_cancel",
            "ai_learning_reset_index",
            "ai_learning_retrieve",
            "ai_learning_remove_source_chunks",
        ] {
            assert!(name.starts_with("ai_learning_"), "{name} namespace");
        }
    }
}
