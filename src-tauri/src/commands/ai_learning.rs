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
    aggregate_status, document_statuses, mark_all_stale, reset_index, BackendFactory, IndexerQueue,
    IndexerRuntimeStatus,
};
use crate::ai_learning::models::{RetrievalFilters, RetrievalResponse};
use crate::ai_learning::retrieval::{self, DEFAULT_K};
use crate::ai::embeddings::EmbeddingProviderType;
use crate::commands::semantic_graph::EmbeddingConfigInput;
use crate::database::Repository;
use crate::error::{PlethoraError, Result};
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

/// Defensive consent gate (ai-billing-safety #14): a billable cloud embedding
/// provider (everything except Ollama) requires the explicit
/// `paid_embeddings_enabled` flag. Local/on-device backends never do, so a
/// stale or malicious frontend cannot silently trigger paid embedding work.
pub fn ensure_embedding_consent(
    config: Option<&EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
) -> Result<()> {
    let Some(cfg) = config else {
        return Ok(());
    };
    if cfg.provider == EmbeddingProviderType::Ollama {
        return Ok(());
    }
    if paid_embeddings_enabled != Some(true) {
        return Err(PlethoraError::PaidOperationNotConsented(format!(
            "cloud embedding provider '{}' requires paid embeddings to be enabled",
            crate::ai::embedding_config::provider_name(cfg)
        )));
    }
    Ok(())
}

/// Enqueue a single document for (re)indexing. Called from TS on import and
/// on content update; the content-hash diff makes it a no-op when nothing
/// changed.
#[tauri::command]
pub async fn ai_learning_enqueue_document(
    document_id: String,
    config: Option<EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
    state: State<'_, AiLearningState>,
) -> Result<()> {
    ensure_embedding_consent(config.as_ref(), paid_embeddings_enabled)?;
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
    paid_embeddings_enabled: Option<bool>,
    state: State<'_, AiLearningState>,
    repo: State<'_, Repository>,
) -> Result<()> {
    ensure_embedding_consent(config.as_ref(), paid_embeddings_enabled)?;
    state.update_config(config);
    mark_stale_on_backend_change(&state, repo.inner()).await;
    state.queue.enqueue_all(require_charging.unwrap_or(true))
}

/// When the active embedding backend's model/version no longer matches stored
/// embeddings (e.g. the on-device model was downloaded after the index was
/// built with a cloud provider), unchanged documents would be skipped by the
/// content-hash diff and never re-embedded. Mark everything stale so the pass
/// rebuilds vectors with the active model (design D10 same-model rule).
async fn mark_stale_on_backend_change(state: &AiLearningState, repo: &Repository) {
    let cfg = state.config.read().ok().and_then(|guard| guard.clone());
    let backend = EmbeddingBackend::from_config(cfg.as_ref());
    let model = backend.model_name();
    let version = backend.embedding_version();
    let mismatch: Option<bool> = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM semantic_chunk_embeddings \
         WHERE model <> ?1 OR embedding_version <> ?2 LIMIT 1)",
    )
    .bind(model)
    .bind(version)
    .fetch_one(repo.pool())
    .await
    .ok();
    if mismatch == Some(true) {
        match mark_all_stale(repo).await {
            Ok(count) => tracing::info!(
                documents = count,
                "embedding backend changed; marked indexed documents stale for re-embedding"
            ),
            Err(e) => tracing::warn!("failed to mark stale after backend change: {}", e),
        }
    }
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

/// Resolve the backend for a query-side retrieve, gating any billable cloud
/// backend behind explicit consent (ai-billing-safety #14).
///
/// The frontend may pass `config: None` when it has nothing new to send; the
/// STORED config — the backend the library was indexed with — is then the
/// effective one. That stored cloud backend still performs a billable
/// query-side `embed_text`, so it must be gated exactly like an explicitly
/// passed config: consent off must never let a stored cloud backend bill on a
/// query.
fn gated_retrieve_backend(
    state: &AiLearningState,
    config: Option<&EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
) -> Result<EmbeddingBackend> {
    let effective = config.cloned().or_else(|| {
        state
            .config
            .read()
            .ok()
            .and_then(|guard| guard.clone())
    });
    ensure_embedding_consent(effective.as_ref(), paid_embeddings_enabled)?;
    Ok(state.backend())
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
    paid_embeddings_enabled: Option<bool>,
    state: State<'_, AiLearningState>,
    repo: State<'_, Repository>,
) -> Result<RetrievalResponse> {
    // Query-side embed_text on a billable cloud backend requires consent; a
    // denied/stale caller is rejected rather than silently billing. The gate
    // resolves the EFFECTIVE config (the one just passed or the stored one),
    // so a stored cloud backend cannot bill a query while consent is off.
    if let Some(cfg) = config.as_ref() {
        state.update_config(Some(cfg.clone()));
    }
    let backend = gated_retrieve_backend(&state, config.as_ref(), paid_embeddings_enabled)?;
    let filters = filters.unwrap_or_default();
    let mut response = retrieval::retrieve(
        repo.inner(),
        &backend,
        &query,
        k.unwrap_or(DEFAULT_K),
        &filters,
    )
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
    let result =
        sqlx::query("DELETE FROM semantic_chunks WHERE source_type = ?1 AND source_id = ?2")
            .bind(&source_type)
            .bind(&source_id)
            .execute(repo.pool())
            .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::PlethoraError;

    fn cloud_config() -> EmbeddingConfigInput {
        EmbeddingConfigInput {
            provider: EmbeddingProviderType::OpenAI,
            openai_api_key: Some("sk-test".into()),
            openai_model: Some("text-embedding-3-small".into()),
            cohere_api_key: None,
            cohere_model: None,
            openrouter_api_key: None,
            openrouter_model: None,
            ollama_base_url: None,
            ollama_model: None,
        }
    }

    fn ollama_config() -> EmbeddingConfigInput {
        EmbeddingConfigInput {
            provider: EmbeddingProviderType::Ollama,
            openai_api_key: None,
            openai_model: None,
            cohere_api_key: None,
            cohere_model: None,
            openrouter_api_key: None,
            openrouter_model: None,
            ollama_base_url: Some("http://localhost:11434".into()),
            ollama_model: Some("nomic-embed-text".into()),
        }
    }

    #[test]
    fn consent_gate_allows_no_config_and_local_ollama() {
        assert!(ensure_embedding_consent(None, None).is_ok());
        assert!(ensure_embedding_consent(None, Some(false)).is_ok());
        assert!(
            ensure_embedding_consent(Some(&ollama_config()), None).is_ok(),
            "local Ollama must never require paid consent"
        );
        assert!(
            ensure_embedding_consent(Some(&ollama_config()), Some(false)).is_ok(),
            "local Ollama must proceed with consent off"
        );
    }

    #[test]
    fn consent_gate_rejects_cloud_without_consent() {
        let err = ensure_embedding_consent(Some(&cloud_config()), None)
            .expect_err("cloud embedding without consent must be rejected");
        assert!(matches!(err, PlethoraError::PaidOperationNotConsented(_)));
        let err = ensure_embedding_consent(Some(&cloud_config()), Some(false))
            .expect_err("explicit false must reject cloud embedding");
        assert!(matches!(err, PlethoraError::PaidOperationNotConsented(_)));
    }

    #[test]
    fn consent_gate_allows_cloud_with_consent() {
        assert!(
            ensure_embedding_consent(Some(&cloud_config()), Some(true)).is_ok(),
            "explicitly enabled paid embeddings must be allowed"
        );
    }

    #[tokio::test]
    async fn stored_cloud_backend_requires_consent_on_retrieve_with_config_none() {
        use crate::ai_learning::embeddings_backend::EmbeddingBackendKind;

        let repo = Repository::new(crate::ai_learning::test_support::test_pool().await);
        let state = AiLearningState::new(repo);
        // The library was indexed with a paid cloud backend (stored config).
        state.update_config(Some(cloud_config()));

        // config: None + consent off ⇒ the STORED cloud backend must be
        // rejected, not silently billed by a query-side embed_text.
        let err = gated_retrieve_backend(&state, None, None)
            .expect_err("stored cloud backend without consent must be rejected");
        assert!(matches!(err, PlethoraError::PaidOperationNotConsented(_)));

        // config: None + explicit consent ⇒ the stored cloud backend is allowed.
        let backend =
            gated_retrieve_backend(&state, None, Some(true)).expect("consent allows the backend");
        assert_eq!(backend.kind(), EmbeddingBackendKind::Cloud);

        // An explicitly passed cloud config is gated the same way as the stored one.
        let err = gated_retrieve_backend(&state, Some(&cloud_config()), None)
            .expect_err("passed cloud config without consent must be rejected");
        assert!(matches!(err, PlethoraError::PaidOperationNotConsented(_)));

        // No stored config + no passed config ⇒ no gate (offline/lexical default).
        let empty = AiLearningState::new(Repository::new(
            crate::ai_learning::test_support::test_pool().await,
        ));
        let backend = gated_retrieve_backend(&empty, None, None).expect("no backend ⇒ ok");
        assert_eq!(backend.kind(), EmbeddingBackendKind::OnDevice);
    }

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
