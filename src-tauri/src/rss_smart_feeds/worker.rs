//! Background backfill, continuous ingestion hooks, cancellation, bounded
//! concurrency, and deterministic feedback profile rebuilding.

use super::classifier::{
    adjudicate_with_llm, compute_ranking_score, evaluate_fast_local, should_escalate_to_laya,
    validate_llm_policy_for_feed, AiProviderDecisionLlm, DecisionOutput, LayaSystemOneLlm,
    LlmAdjudicationError, SmartFeedDecisionLlm, CLASSIFIER_VERSION,
};
use super::laya_budget::{LayaBudgetConfig, LayaTokenizer};
use super::models::*;
use super::normalize::{
    build_article_snapshot, build_negative_definition_text, build_positive_definition_text,
    negative_definition_hash, positive_definition_hash, sha256_hex, ArticleSnapshot,
};
use super::passages::{
    chunk_article_snapshot, retrieve_passages_for_feed, ArticlePassage, CHUNKER_VERSION,
    DEFAULT_PASSAGE_OVERLAP_TOKENS, DEFAULT_PASSAGE_TARGET_TOKENS,
};
use super::repository;
use super::retrieval::{
    build_feed_query_profile, retrieve_candidate_signals, ArticleVectorRef, FeedQueryProfile,
};
use crate::ai::provider_wrapper::{AIConfig, AIProvider};
use crate::ai::providers::LLMProviderType;
use crate::ai_learning::embeddings_backend::EmbeddingBackend;
use crate::commands::ai_learning::ensure_embedding_consent;
use crate::commands::semantic_graph::EmbeddingConfigInput;
use crate::database::{QueueItemEmbedding, Repository};
use crate::error::Result;
use chrono::Utc;
use futures::stream::{self, StreamExt};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

pub const EVAL_BATCH_SIZE: usize = 25;
pub const MAX_CONCURRENT_EVAL_JOBS: usize = 2;
pub const MAX_LLM_CONCURRENCY: usize = 2;

#[derive(Debug, Clone, Default)]
pub struct SmartFeedRuntimeConfig {
    pub embedding_config: Option<EmbeddingConfigInput>,
    pub paid_embeddings_enabled: Option<bool>,
    pub strict_local_only: bool,
    pub laya_config: Option<SmartFeedLayaConfig>,
}

#[derive(Clone)]
pub struct SmartFeedWorkerState {
    active_tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    progress_by_feed: Arc<Mutex<HashMap<String, SmartFeedProgress>>>,
    runtime_config: Arc<Mutex<SmartFeedRuntimeConfig>>,
    job_semaphore: Arc<Semaphore>,
}

impl Default for SmartFeedWorkerState {
    fn default() -> Self {
        Self::new()
    }
}

impl SmartFeedWorkerState {
    pub fn new() -> Self {
        Self {
            active_tokens: Arc::new(Mutex::new(HashMap::new())),
            progress_by_feed: Arc::new(Mutex::new(HashMap::new())),
            runtime_config: Arc::new(Mutex::new(SmartFeedRuntimeConfig::default())),
            job_semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_EVAL_JOBS)),
        }
    }

    pub fn update_runtime_config(
        &self,
        embedding_config: Option<EmbeddingConfigInput>,
        paid_embeddings_enabled: Option<bool>,
        strict_local_only: Option<bool>,
        laya_config: Option<SmartFeedLayaConfig>,
    ) {
        if let Ok(mut guard) = self.runtime_config.lock() {
            if embedding_config.is_some() {
                guard.embedding_config = embedding_config;
            }
            if paid_embeddings_enabled.is_some() {
                guard.paid_embeddings_enabled = paid_embeddings_enabled;
            }
            if let Some(strict) = strict_local_only {
                guard.strict_local_only = strict;
            }
            guard.laya_config = laya_config;
        }
    }

    pub fn runtime_config(&self) -> SmartFeedRuntimeConfig {
        self.runtime_config
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn cancel_feed(&self, smart_feed_id: &str) -> bool {
        if let Ok(guard) = self.active_tokens.lock() {
            if let Some(tok) = guard.get(smart_feed_id) {
                tok.store(true, Ordering::Relaxed);
                return true;
            }
        }
        false
    }

    pub fn get_progress(&self, smart_feed_id: &str) -> Option<SmartFeedProgress> {
        self.progress_by_feed
            .lock()
            .ok()
            .and_then(|g| g.get(smart_feed_id).cloned())
    }

    fn register_run(&self, smart_feed_id: &str) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));
        if let Ok(mut guard) = self.active_tokens.lock() {
            if let Some(prev) = guard.insert(smart_feed_id.to_string(), Arc::clone(&token)) {
                prev.store(true, Ordering::Relaxed);
            }
        }
        token
    }

    fn finish_run(&self, smart_feed_id: &str, token: &Arc<AtomicBool>) {
        if let Ok(mut guard) = self.active_tokens.lock() {
            if let Some(current) = guard.get(smart_feed_id) {
                if Arc::ptr_eq(current, token) {
                    guard.remove(smart_feed_id);
                }
            }
        }
    }

    fn update_progress(&self, app: Option<&AppHandle>, progress: SmartFeedProgress) {
        if let Ok(mut guard) = self.progress_by_feed.lock() {
            guard.insert(progress.smart_feed_id.clone(), progress.clone());
        }
        if let Some(app_handle) = app {
            let _ = app_handle.emit("rss:smart-feed:progress", &progress);
        }
    }
}

/// Non-blocking background enqueue hook invoked after RSS article ingestion or
/// full-content enrichment. Evaluates affected Smart Feeds asynchronously
/// without stalling the RSS reader or ingestion command.
pub fn spawn_background_articles_evaluation(
    pool: SqlitePool,
    worker: SmartFeedWorkerState,
    app: AppHandle,
    article_ids: Vec<String>,
    ai_config: Option<AIConfig>,
) {
    if article_ids.is_empty() {
        return;
    }
    let runtime = worker.runtime_config();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = evaluate_articles_for_enabled_feeds(
            &pool,
            Some(&worker),
            Some(&app),
            &article_ids,
            runtime.embedding_config,
            runtime.paid_embeddings_enabled,
            ai_config,
            runtime.strict_local_only,
        )
        .await
        {
            tracing::warn!("Background Smart Feed evaluation failed: {}", err);
        }
    });
}

#[derive(Debug, Clone, Default)]
pub struct EvaluationOptions {
    pub force_reevaluate: bool,
    pub article_ids: Option<Vec<String>>,
    pub embedding_config: Option<EmbeddingConfigInput>,
    pub paid_embeddings_enabled: Option<bool>,
    pub ai_config: Option<AIConfig>,
    pub strict_local_only: bool,
    pub laya_config: Option<SmartFeedLayaConfig>,
}

/// Resolve the active embedding backend while strictly honoring paid-embedding
/// consent and strict local-only settings. Never throws on unconsented cloud
/// embeddings: degrades gracefully to local on-device / lexical mode.
pub fn resolve_smart_feed_embedding_backend(
    config: Option<&EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
    strict_local_only: bool,
) -> EmbeddingBackend {
    if let Some(cfg) = config {
        let is_ollama = cfg.provider == crate::ai::embeddings::EmbeddingProviderType::Ollama;
        if strict_local_only && !is_ollama {
            tracing::info!(
                "strict_local_only active: skipping cloud embedding backend for Smart Feeds"
            );
            return EmbeddingBackend::from_config(None);
        }
        if ensure_embedding_consent(Some(cfg), paid_embeddings_enabled).is_err() {
            tracing::info!(
                "paid embeddings consent disabled: using local/lexical fallback for Smart Feeds"
            );
            return EmbeddingBackend::from_config(None);
        }
    }
    EmbeddingBackend::from_config(config)
}

pub fn is_loopback_url(url: &str) -> bool {
    let trimmed = url.trim().to_lowercase();
    trimmed.starts_with("http://localhost")
        || trimmed.starts_with("http://127.0.0.1")
        || trimmed.starts_with("http://[::1]")
        || trimmed.starts_with("https://localhost")
        || trimmed.starts_with("https://127.0.0.1")
}

pub fn resolve_llm_for_feed(
    feed: &SmartFeed,
    ai_config: Option<&AIConfig>,
    laya_config: Option<&SmartFeedLayaConfig>,
    strict_local_only: bool,
) -> std::result::Result<Arc<dyn SmartFeedDecisionLlm>, LlmAdjudicationError> {
    if feed.classification_mode == ClassificationMode::FastLocal {
        return Err(LlmAdjudicationError::Unavailable(
            "Fast Local mode does not require an LLM".to_string(),
        ));
    }

    if feed.classification_mode == ClassificationMode::IntelligentLocal {
        if let Some(laya) = laya_config.filter(|c| c.enabled) {
            let base_url = laya
                .base_url
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(crate::laya_runtime::LAYA_ENDPOINT);
            if !is_loopback_url(base_url) {
                return Err(LlmAdjudicationError::StrictLocalBlocked(
                    "Laya endpoint is not a local loopback URL".to_string(),
                ));
            }
            return Ok(Arc::new(LayaSystemOneLlm::new(
                base_url.to_string(),
                laya.timeout_ms,
            )));
        }

        if crate::laya_runtime::is_managed_running() {
            return Ok(Arc::new(LayaSystemOneLlm::new(
                crate::laya_runtime::LAYA_ENDPOINT.to_string(),
                None,
            )));
        }
    }

    let Some(cfg) = ai_config else {
        return Err(LlmAdjudicationError::Unavailable(
            "No local or AI provider configuration available".to_string(),
        ));
    };

    let mut effective_cfg = cfg.clone();
    let provider_type = match feed.classification_mode {
        ClassificationMode::IntelligentLocal => {
            if !is_loopback_url(&effective_cfg.local_settings.ollama_base_url) {
                return Err(LlmAdjudicationError::StrictLocalBlocked(
                    "Ollama endpoint is not a local loopback URL".to_string(),
                ));
            }
            if let Some(ref model) = feed.preferred_model {
                if !model.trim().is_empty() {
                    effective_cfg.models.ollama_model = model.clone();
                }
            }
            LLMProviderType::Ollama
        }
        ClassificationMode::Hybrid | ClassificationMode::Cloud => {
            let ptype = match feed
                .preferred_provider
                .as_deref()
                .map(str::to_lowercase)
                .as_deref()
            {
                Some("openai") => LLMProviderType::OpenAI,
                Some("anthropic") => LLMProviderType::Anthropic,
                Some("openrouter") => LLMProviderType::OpenRouter,
                Some("deepseek") => LLMProviderType::DeepSeek,
                Some("ollama") => LLMProviderType::Ollama,
                _ => effective_cfg.default_provider,
            };
            if let Some(ref model) = feed.preferred_model {
                if !model.trim().is_empty() {
                    match ptype {
                        LLMProviderType::OpenAI => {
                            effective_cfg.models.openai_model = model.clone()
                        }
                        LLMProviderType::Anthropic => {
                            effective_cfg.models.anthropic_model = model.clone()
                        }
                        LLMProviderType::OpenRouter => {
                            effective_cfg.models.openrouter_model = model.clone()
                        }
                        LLMProviderType::Ollama => {
                            effective_cfg.models.ollama_model = model.clone()
                        }
                        LLMProviderType::DeepSeek => {
                            effective_cfg.models.deepseek_model = model.clone()
                        }
                    }
                }
            }
            ptype
        }
        ClassificationMode::FastLocal => unreachable!(),
    };

    validate_llm_policy_for_feed(feed, provider_type, strict_local_only)?;

    let provider = AIProvider::from_config(
        provider_type,
        &effective_cfg.api_keys,
        &effective_cfg.models,
        &effective_cfg.local_settings,
    )
    .map_err(LlmAdjudicationError::Unavailable)?;

    if !provider.is_available() {
        return Err(LlmAdjudicationError::Unavailable(
            "Selected LLM provider is not available or missing API key".to_string(),
        ));
    }

    Ok(Arc::new(AiProviderDecisionLlm { provider }))
}

fn l2_normalize(v: &[f32]) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm == 0.0 || !norm.is_finite() {
        return Vec::new();
    }
    v.iter().map(|x| x / norm).collect()
}

/// Ensure positive & negative feed definition embeddings are present and match
/// the active embedding backend + definition revision.
pub async fn ensure_feed_definition_embeddings(
    pool: &SqlitePool,
    feed: &SmartFeed,
    backend: &EmbeddingBackend,
) -> Result<()> {
    if !backend.is_available() {
        return Ok(());
    }

    let provider = backend.kind_name().to_string();
    let model = backend.model_name();
    let existing = repository::get_feed_embeddings(pool, &feed.id).await?;
    let now = Utc::now().to_rfc3339();

    let pos_text = build_positive_definition_text(feed);
    let pos_hash = positive_definition_hash(feed);
    let pos_fresh = existing.iter().any(|e| {
        e.role == EmbeddingRole::Positive
            && e.definition_revision == feed.definition_revision
            && e.provider == provider
            && e.model == model
            && e.content_hash == pos_hash
            && !e.embedding.is_empty()
    });

    if !pos_fresh && !pos_text.trim().is_empty() {
        if let Ok(vec) = backend.embed_text(&pos_text).await {
            if !vec.is_empty() {
                repository::upsert_feed_embedding(
                    pool,
                    &SmartFeedEmbeddingRecord {
                        smart_feed_id: feed.id.clone(),
                        role: EmbeddingRole::Positive,
                        definition_revision: feed.definition_revision,
                        provider: provider.clone(),
                        model: model.clone(),
                        dimension: vec.len() as i32,
                        embedding: l2_normalize(&vec),
                        weight: 1.0,
                        content_hash: pos_hash,
                        updated_at: now.clone(),
                    },
                )
                .await?;
            }
        }
    }

    match build_negative_definition_text(feed) {
        None => {
            repository::delete_feed_embedding_role(pool, &feed.id, EmbeddingRole::Negative).await?;
        }
        Some(neg_text) => {
            let neg_hash = negative_definition_hash(feed);
            let neg_fresh = existing.iter().any(|e| {
                e.role == EmbeddingRole::Negative
                    && e.definition_revision == feed.definition_revision
                    && e.provider == provider
                    && e.model == model
                    && e.content_hash == neg_hash
                    && !e.embedding.is_empty()
            });
            if !neg_fresh {
                if let Ok(vec) = backend.embed_text(&neg_text).await {
                    if !vec.is_empty() {
                        repository::upsert_feed_embedding(
                            pool,
                            &SmartFeedEmbeddingRecord {
                                smart_feed_id: feed.id.clone(),
                                role: EmbeddingRole::Negative,
                                definition_revision: feed.definition_revision,
                                provider: provider.clone(),
                                model: model.clone(),
                                dimension: vec.len() as i32,
                                embedding: l2_normalize(&vec),
                                weight: 1.0,
                                content_hash: neg_hash,
                                updated_at: now,
                            },
                        )
                        .await?;
                    }
                }
            }
        }
    }

    Ok(())
}

/// Deterministically rebuild the Smart Feed's `feedback_pos` and `feedback_neg`
/// centroid vectors from persistent `rss_smart_feed_feedback` events.
pub async fn rebuild_feedback_profile(
    pool: &SqlitePool,
    smart_feed_id: &str,
    backend: Option<&EmbeddingBackend>,
) -> Result<()> {
    let feed = repository::get_feed(pool, smart_feed_id).await?;
    let active_map = repository::get_active_feedback_map(pool, smart_feed_id).await?;
    if active_map.is_empty() {
        repository::delete_feed_embedding_role(pool, smart_feed_id, EmbeddingRole::FeedbackPos)
            .await?;
        repository::delete_feed_embedding_role(pool, smart_feed_id, EmbeddingRole::FeedbackNeg)
            .await?;
        return Ok(());
    }

    let article_ids: Vec<String> = active_map.keys().cloned().collect();
    let mut cached_embs = repository::load_article_embeddings_chunked(pool, &article_ids).await?;

    // If a live embedding backend is available, backfill missing feedback article
    // vectors so generalized learning works immediately on corrected articles.
    if let Some(b) = backend.filter(|b| b.is_available()) {
        let provider = b.kind_name().to_string();
        let model = b.model_name();
        let articles = repository::load_articles_by_ids(pool, &article_ids).await?;
        let mut to_embed: Vec<(ArticleSnapshot, String)> = Vec::new();
        for art in articles {
            let snap = build_article_snapshot(&art);
            let needs = match cached_embs.get(&snap.article_id) {
                Some(e) => {
                    e.provider != provider
                        || e.model != model
                        || e.content_hash != snap.content_hash
                }
                None => true,
            };
            if needs {
                to_embed.push((snap.clone(), snap.embedding_text));
            }
        }
        if !to_embed.is_empty() {
            let texts: Vec<String> = to_embed.iter().map(|(_, t)| t.clone()).collect();
            if let Ok(vecs) = b.embed_texts(&texts).await {
                let repo = Repository::new(pool.clone());
                let now_ms = Utc::now().timestamp_millis();
                for ((snap, _), vec) in to_embed.into_iter().zip(vecs.into_iter()) {
                    let qemb = QueueItemEmbedding {
                        item_id: format!("rss-{}", snap.article_id),
                        embedding: vec,
                        content_hash: snap.content_hash,
                        provider: provider.clone(),
                        model: model.clone(),
                        dimension: 0,
                        created_at: now_ms,
                    };
                    let mut qemb = qemb;
                    qemb.dimension = qemb.embedding.len() as i32;
                    let _ = repo.upsert_embedding(&qemb).await;
                    cached_embs.insert(snap.article_id.clone(), qemb);
                }
            }
        }
    }

    let target_space: Option<(String, String)> = backend
        .filter(|b| b.is_available())
        .map(|b| (b.kind_name().to_string(), b.model_name()))
        .or_else(|| {
            cached_embs
                .values()
                .next()
                .map(|e| (e.provider.clone(), e.model.clone()))
        });

    let Some((target_provider, target_model)) = target_space else {
        return Ok(());
    };

    let build_centroid = |target_fb: FeedbackType| -> Option<(Vec<f32>, f64)> {
        let mut sum: Vec<f32> = Vec::new();
        let mut count = 0usize;
        for (aid, fb) in &active_map {
            if *fb != target_fb {
                continue;
            }
            if let Some(emb) = cached_embs.get(aid) {
                if emb.provider == target_provider
                    && emb.model == target_model
                    && !emb.embedding.is_empty()
                {
                    let norm = l2_normalize(&emb.embedding);
                    if norm.is_empty() {
                        continue;
                    }
                    if sum.is_empty() {
                        sum = norm;
                    } else if sum.len() == norm.len() {
                        for (s, x) in sum.iter_mut().zip(norm.iter()) {
                            *s += x;
                        }
                    } else {
                        continue;
                    }
                    count += 1;
                }
            }
        }
        if count == 0 || sum.is_empty() {
            None
        } else {
            Some((l2_normalize(&sum), count as f64))
        }
    };

    let now = Utc::now().to_rfc3339();
    for (role, fb_type) in [
        (EmbeddingRole::FeedbackPos, FeedbackType::SHOULD_INCLUDE),
        (EmbeddingRole::FeedbackNeg, FeedbackType::SHOULD_EXCLUDE),
    ] {
        match build_centroid(fb_type) {
            Some((vec, weight)) => {
                let hash = sha256_hex(&[&target_provider, &target_model, role.as_str()]);
                repository::upsert_feed_embedding(
                    pool,
                    &SmartFeedEmbeddingRecord {
                        smart_feed_id: smart_feed_id.to_string(),
                        role,
                        definition_revision: feed.definition_revision,
                        provider: target_provider.clone(),
                        model: target_model.clone(),
                        dimension: vec.len() as i32,
                        embedding: vec,
                        weight,
                        content_hash: hash,
                        updated_at: now.clone(),
                    },
                )
                .await?;
            }
            None => {
                repository::delete_feed_embedding_role(pool, smart_feed_id, role).await?;
            }
        }
    }

    Ok(())
}

/// Evaluate a Smart Feed over its scoped articles (or a specified article subset).
/// Accepts optional injected `EmbeddingBackend` and `SmartFeedDecisionLlm` so
/// unit/integration tests run deterministically without network calls.
pub async fn evaluate_smart_feed_with_deps(
    pool: &SqlitePool,
    worker_state: Option<&SmartFeedWorkerState>,
    app: Option<&AppHandle>,
    smart_feed_id: &str,
    options: EvaluationOptions,
    backend_override: Option<EmbeddingBackend>,
    llm_override: Option<Arc<dyn SmartFeedDecisionLlm>>,
) -> Result<SmartFeedRunMetrics> {
    let start = Instant::now();
    if let Some(ws) = worker_state {
        // Cancel any in-flight evaluation for this feed immediately, before
        // waiting on `job_semaphore`, so a mode switch (e.g. Cloud -> IntelligentLocal)
        // halts outbound cloud calls right away.
        ws.cancel_feed(smart_feed_id);
    }
    let _permit = if let Some(ws) = worker_state {
        Some(ws.job_semaphore.clone().acquire_owned().await.ok())
    } else {
        None
    };

    let cancel_token = worker_state
        .map(|ws| ws.register_run(smart_feed_id))
        .unwrap_or_default();

    let result = evaluate_inner(
        pool,
        worker_state,
        app,
        smart_feed_id,
        options,
        backend_override,
        llm_override,
        &cancel_token,
        start,
    )
    .await;

    if let Some(ws) = worker_state {
        ws.finish_run(smart_feed_id, &cancel_token);
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn evaluate_inner(
    pool: &SqlitePool,
    worker_state: Option<&SmartFeedWorkerState>,
    app: Option<&AppHandle>,
    smart_feed_id: &str,
    options: EvaluationOptions,
    backend_override: Option<EmbeddingBackend>,
    llm_override: Option<Arc<dyn SmartFeedDecisionLlm>>,
    cancel_token: &Arc<AtomicBool>,
    start: Instant,
) -> Result<SmartFeedRunMetrics> {
    let feed = repository::get_feed(pool, smart_feed_id).await?;
    let feed_forces_local = matches!(
        feed.classification_mode,
        ClassificationMode::FastLocal | ClassificationMode::IntelligentLocal
    );
    let backend = backend_override.unwrap_or_else(|| {
        resolve_smart_feed_embedding_backend(
            options.embedding_config.as_ref(),
            options.paid_embeddings_enabled,
            options.strict_local_only || feed_forces_local,
        )
    });

    let mut backend_live = backend.is_available();
    let provider_name = backend.kind_name().to_string();
    let model_name = backend.model_name();

    if backend_live {
        if let Err(err) = ensure_feed_definition_embeddings(pool, &feed, &backend).await {
            tracing::warn!(
                "Smart Feed definition embedding failed ({}), degrading to lexical",
                err
            );
            backend_live = false;
        } else {
            let _ = rebuild_feedback_profile(pool, &feed.id, Some(&backend)).await;
        }
    }

    let scoped_articles =
        repository::load_scoped_articles(pool, &feed, options.article_ids.as_deref()).await?;
    let existing_matches = repository::get_existing_match_states(pool, &feed.id).await?;
    let active_feedback = repository::get_active_feedback_map(pool, &feed.id).await?;

    // Load snapshots for active feedback articles to derive bounded lexical priors.
    let fb_ids: Vec<String> = active_feedback.keys().cloned().collect();
    let fb_rows = repository::load_articles_by_ids(pool, &fb_ids).await?;
    let mut fb_pairs: Vec<(FeedbackType, ArticleSnapshot)> = Vec::new();
    for r in fb_rows {
        if let Some(&fb_type) = active_feedback.get(&r.id) {
            fb_pairs.push((fb_type, build_article_snapshot(&r)));
        }
    }

    let feed_embs = repository::get_feed_embeddings(pool, &feed.id).await?;
    let profile: FeedQueryProfile = build_feed_query_profile(&feed, &feed_embs, &fb_pairs);
    let fts_boosts = repository::query_fts_boosts(
        pool,
        &format!(
            "{} {} {}",
            feed.name, feed.description, feed.inclusion_criteria
        ),
    )
    .await;

    let total_scoped = scoped_articles.len();
    let mut metrics = SmartFeedRunMetrics {
        smart_feed_id: feed.id.clone(),
        total_scanned: total_scoped,
        lexical_only: !backend_live,
        ..Default::default()
    };

    let mut snapshots: Vec<ArticleSnapshot> = Vec::with_capacity(scoped_articles.len());
    for row in &scoped_articles {
        snapshots.push(build_article_snapshot(row));
    }

    let emit_progress = |phase: &str,
                         evaluated: usize,
                         matched: usize,
                         excluded: usize,
                         uncertain: usize,
                         cache_hits: usize,
                         lexical_only: bool,
                         msg: Option<String>| {
        if let Some(ws) = worker_state {
            ws.update_progress(
                app,
                SmartFeedProgress {
                    smart_feed_id: feed.id.clone(),
                    phase: phase.to_string(),
                    total: total_scoped,
                    evaluated,
                    matched,
                    excluded,
                    uncertain,
                    remaining: total_scoped.saturating_sub(evaluated),
                    cache_hits,
                    lexical_only,
                    message: msg,
                },
            );
        }
    };

    emit_progress("running", 0, 0, 0, 0, 0, !backend_live, None);

    // Resolve LLM adapter if mode uses one. Failures are non-fatal and tracked.
    let llm_resolution: Option<
        std::result::Result<Arc<dyn SmartFeedDecisionLlm>, LlmAdjudicationError>,
    > = if feed.classification_mode == ClassificationMode::FastLocal {
        None
    } else if let Some(override_llm) = llm_override {
        let ptype = match feed.classification_mode {
            ClassificationMode::IntelligentLocal => LLMProviderType::Ollama,
            _ => LLMProviderType::OpenAI,
        };
        match validate_llm_policy_for_feed(&feed, ptype, options.strict_local_only) {
            Ok(()) => Some(Ok(override_llm)),
            Err(e) => Some(Err(e)),
        }
    } else {
        Some(resolve_llm_for_feed(
            &feed,
            options.ai_config.as_ref(),
            options.laya_config.as_ref(),
            options.strict_local_only,
        ))
    };

    let mut processed_total = 0usize;
    let repo_writer = Repository::new(pool.clone());

    for batch in snapshots.chunks(EVAL_BATCH_SIZE) {
        if cancel_token.load(Ordering::Relaxed) {
            metrics.cancelled = true;
            emit_progress(
                "cancelled",
                processed_total,
                metrics.matched_count,
                metrics.excluded_count,
                metrics.uncertain_count,
                metrics.cache_hits,
                metrics.lexical_only,
                Some("Evaluation cancelled".to_string()),
            );
            break;
        }

        let batch_ids: Vec<String> = batch.iter().map(|s| s.article_id.clone()).collect();
        let mut cached_article_embs =
            repository::load_article_embeddings_chunked(pool, &batch_ids).await?;

        // Identify items needing evaluation vs valid cache hits vs user overrides.
        let mut to_evaluate: Vec<&ArticleSnapshot> = Vec::new();
        for snap in batch {
            if let Some(existing) = existing_matches.get(&snap.article_id) {
                if existing.is_user_override {
                    metrics.cache_hits += 1;
                    match existing.decision {
                        MatchDecision::INCLUDE => metrics.matched_count += 1,
                        MatchDecision::EXCLUDE => metrics.excluded_count += 1,
                        MatchDecision::UNCERTAIN => metrics.uncertain_count += 1,
                        MatchDecision::PENDING => {}
                    }
                    continue;
                }
                let model_matches = !backend_live
                    || (existing.embedding_provider == provider_name
                        && existing.embedding_model == model_name
                        && existing.evaluation_status != EvaluationStatus::CompletedLexical);
                let cache_valid = !options.force_reevaluate
                    && existing.definition_revision == feed.definition_revision
                    && existing.classifier_version == CLASSIFIER_VERSION
                    && existing.content_hash == snap.content_hash
                    && model_matches
                    && !matches!(
                        existing.evaluation_status,
                        EvaluationStatus::Pending
                            | EvaluationStatus::Deferred
                            | EvaluationStatus::Error
                    );
                if cache_valid {
                    metrics.cache_hits += 1;
                    match existing.decision {
                        MatchDecision::INCLUDE => metrics.matched_count += 1,
                        MatchDecision::EXCLUDE => metrics.excluded_count += 1,
                        MatchDecision::UNCERTAIN => metrics.uncertain_count += 1,
                        MatchDecision::PENDING => {}
                    }
                    continue;
                }
            }
            to_evaluate.push(snap);
        }

        // Generate missing/stale embeddings for the batch if backend is live.
        if backend_live && !to_evaluate.is_empty() {
            let mut missing_snaps: Vec<&ArticleSnapshot> = Vec::new();
            let mut missing_texts: Vec<String> = Vec::new();
            for &snap in &to_evaluate {
                let reusable = cached_article_embs
                    .get(&snap.article_id)
                    .map(|e| {
                        e.provider == provider_name
                            && e.model == model_name
                            && e.content_hash == snap.content_hash
                            && !e.embedding.is_empty()
                    })
                    .unwrap_or(false);
                if reusable {
                    metrics.embeddings_reused += 1;
                } else {
                    missing_snaps.push(snap);
                    missing_texts.push(snap.embedding_text.clone());
                }
            }

            if !missing_texts.is_empty() {
                match backend.embed_texts(&missing_texts).await {
                    Ok(vectors) => {
                        let now_ms = Utc::now().timestamp_millis();
                        for (snap, vec) in missing_snaps.into_iter().zip(vectors.into_iter()) {
                            if vec.is_empty() {
                                continue;
                            }
                            let rec = QueueItemEmbedding {
                                item_id: format!("rss-{}", snap.article_id),
                                embedding: vec,
                                content_hash: snap.content_hash.clone(),
                                provider: provider_name.clone(),
                                model: model_name.clone(),
                                dimension: 0,
                                created_at: now_ms,
                            };
                            let mut rec = rec;
                            rec.dimension = rec.embedding.len() as i32;
                            if repo_writer.upsert_embedding(&rec).await.is_ok() {
                                metrics.embeddings_generated += 1;
                            }
                            cached_article_embs.insert(snap.article_id.clone(), rec);
                        }
                    }
                    Err(err) => {
                        tracing::warn!(
                            "Smart Feed embedding batch failed ({}), continuing in lexical mode",
                            err
                        );
                        metrics.lexical_only = true;
                    }
                }
            }
        }

        // Stage E + Stage F (Fast Local)
        let mut fast_decisions: Vec<(&ArticleSnapshot, DecisionOutput, bool)> =
            Vec::with_capacity(to_evaluate.len());
        let mut llm_indices: Vec<usize> = Vec::new();

        for &snap in &to_evaluate {
            let vec_ref = cached_article_embs.get(&snap.article_id).and_then(|e| {
                if !e.embedding.is_empty() {
                    Some(ArticleVectorRef {
                        provider: e.provider.as_str(),
                        model: e.model.as_str(),
                        vector: e.embedding.as_slice(),
                    })
                } else {
                    None
                }
            });
            let fts_boost = fts_boosts.get(&snap.article_id).copied().unwrap_or(0.0);
            let signals = retrieve_candidate_signals(
                &profile,
                snap,
                vec_ref.as_ref(),
                fts_boost,
                active_feedback.contains_key(&snap.article_id),
            );
            let mut fast_out = evaluate_fast_local(&feed, &signals);
            fast_out.content_provenance = snap.content_provenance;
            let needs_llm = match feed.classification_mode {
                ClassificationMode::FastLocal => false,
                ClassificationMode::IntelligentLocal | ClassificationMode::Hybrid => {
                    should_escalate_to_laya(&feed, &signals, &fast_out, snap)
                }
                ClassificationMode::Cloud => signals.is_candidate,
            };
            let idx = fast_decisions.len();
            if needs_llm {
                llm_indices.push(idx);
            }
            fast_decisions.push((snap, fast_out, signals.is_candidate));
        }

        // Optional Stage F LLM adjudication with bounded concurrency and
        // non-destructive error recovery (errors NEVER map to EXCLUDE).
        let mut skipped_cancelled: Vec<bool> = vec![false; fast_decisions.len()];
        if !llm_indices.is_empty() {
            let laya_adaptive_client: Option<Arc<LayaSystemOneLlm>> =
                if feed.classification_mode == ClassificationMode::IntelligentLocal {
                    if let Some(laya) = options.laya_config.as_ref().filter(|c| c.enabled) {
                        let base_url = laya
                            .base_url
                            .as_deref()
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .unwrap_or(crate::laya_runtime::LAYA_ENDPOINT);
                        if is_loopback_url(base_url) {
                            Some(Arc::new(LayaSystemOneLlm::new(
                                base_url.to_string(),
                                laya.timeout_ms,
                            )))
                        } else {
                            None
                        }
                    } else if crate::laya_runtime::is_managed_running() {
                        Some(Arc::new(LayaSystemOneLlm::new(
                            crate::laya_runtime::LAYA_ENDPOINT.to_string(),
                            None,
                        )))
                    } else {
                        None
                    }
                } else {
                    None
                };

            match &llm_resolution {
                Some(Ok(llm)) => {
                    let source_kind = match feed.classification_mode {
                        ClassificationMode::IntelligentLocal => DecisionSource::IntelligentLocal,
                        ClassificationMode::Hybrid => DecisionSource::Hybrid,
                        ClassificationMode::Cloud => DecisionSource::Cloud,
                        ClassificationMode::FastLocal => DecisionSource::FastLocal,
                    };
                    let laya_tok = LayaTokenizer::discover_global();
                    let laya_budget = LayaBudgetConfig::default();
                    let max_passages = match feed.evaluation_depth {
                        EvaluationDepth::Fast => 1usize,
                        EvaluationDepth::Adaptive => 3usize,
                        EvaluationDepth::Thorough => 5usize,
                    };
                    let target_passage_tokens = laya_budget
                        .max_len
                        .saturating_sub(laya_budget.head_max_len + 80)
                        .clamp(220, DEFAULT_PASSAGE_TARGET_TOKENS);

                    let mut futs = Vec::with_capacity(llm_indices.len());
                    for &idx in &llm_indices {
                        let snap = fast_decisions[idx].0;
                        let llm_ref = Arc::clone(llm);
                        let laya_ref = laya_adaptive_client.clone();
                        let feed_ref = &feed;
                        let profile_ref = &profile;
                        let backend_ref = &backend;
                        let prov_ref = &provider_name;
                        let mod_ref = &model_name;
                        let tok_ref = &laya_tok;
                        let token_ref = Arc::clone(cancel_token);
                        futs.push(async move {
                            if token_ref.load(Ordering::Relaxed) {
                                return (idx, None);
                            }
                            if let Some(laya) = laya_ref {
                                // Load or chunk passages lazily only for escalated articles
                                let mut passages: Vec<ArticlePassage> =
                                    repository::load_article_passages(
                                        pool,
                                        &snap.article_id,
                                        &snap.content_hash,
                                        CHUNKER_VERSION,
                                    )
                                    .await
                                    .unwrap_or_default();
                                if passages.is_empty() {
                                    passages = chunk_article_snapshot(
                                        snap,
                                        tok_ref,
                                        target_passage_tokens,
                                        DEFAULT_PASSAGE_OVERLAP_TOKENS,
                                    );
                                    if !passages.is_empty() {
                                        let _ = repository::upsert_article_passages(
                                            pool,
                                            &snap.article_id,
                                            &snap.content_hash,
                                            CHUNKER_VERSION,
                                            &passages,
                                        )
                                        .await;
                                    }
                                }

                                // Lazy passage embeddings when backend is live
                                let mut p_vecs: Vec<Option<Vec<f32>>> = vec![None; passages.len()];
                                if backend_live && passages.len() > 1 {
                                    let pids: Vec<String> =
                                        passages.iter().map(|p| p.id.clone()).collect();
                                    let mut cached = repository::load_passage_embeddings(
                                        pool,
                                        &pids,
                                        prov_ref,
                                        mod_ref,
                                    )
                                    .await
                                    .unwrap_or_default();
                                    let mut missing_idx = Vec::new();
                                    let mut missing_texts = Vec::new();
                                    for (i, p) in passages.iter().enumerate() {
                                        if let Some(v) = cached.remove(&p.id) {
                                            p_vecs[i] = Some(v);
                                        } else {
                                            missing_idx.push(i);
                                            missing_texts.push(p.text.clone());
                                        }
                                    }
                                    if !missing_texts.is_empty() {
                                        if let Ok(new_vecs) =
                                            backend_ref.embed_texts(&missing_texts).await
                                        {
                                            let mut to_store = Vec::new();
                                            for (i, v) in
                                                missing_idx.iter().copied().zip(new_vecs.into_iter())
                                            {
                                                if !v.is_empty() {
                                                    p_vecs[i] = Some(v);
                                                }
                                            }
                                            for &i in &missing_idx {
                                                if let Some(ref v) = p_vecs[i] {
                                                    to_store.push((
                                                        passages[i].id.as_str(),
                                                        prov_ref.as_str(),
                                                        mod_ref.as_str(),
                                                        passages[i].content_hash.as_str(),
                                                        v.as_slice(),
                                                    ));
                                                }
                                            }
                                            let _ =
                                                repository::upsert_passage_embeddings(pool, &to_store)
                                                    .await;
                                        }
                                    }
                                }

                                let vec_refs: Vec<Option<ArticleVectorRef<'_>>> = p_vecs
                                    .iter()
                                    .map(|opt| {
                                        opt.as_ref().map(|v| ArticleVectorRef {
                                            provider: prov_ref.as_str(),
                                            model: mod_ref.as_str(),
                                            vector: v.as_slice(),
                                        })
                                    })
                                    .collect();
                                let retrieved = retrieve_passages_for_feed(
                                    profile_ref,
                                    &passages,
                                    &vec_refs,
                                    max_passages,
                                );
                                let res = laya
                                    .adjudicate_article_adaptive(
                                        feed_ref,
                                        snap,
                                        &retrieved,
                                        passages.len(),
                                        source_kind,
                                    )
                                    .await;
                                return (idx, Some(res));
                            }

                            let res =
                                adjudicate_with_llm(llm_ref.as_ref(), feed_ref, snap, source_kind)
                                    .await;
                            (idx, Some(res))
                        });
                    }
                    let settled: Vec<(
                        usize,
                        Option<std::result::Result<DecisionOutput, LlmAdjudicationError>>,
                    )> = stream::iter(futs)
                        .buffer_unordered(MAX_LLM_CONCURRENCY)
                        .collect()
                        .await;

                    for (idx, maybe_res) in settled {
                        let Some(res) = maybe_res else {
                            skipped_cancelled[idx] = true;
                            metrics.cancelled = true;
                            continue;
                        };
                        metrics.provider_calls += 1;
                        match res {
                            Ok(llm_out) => {
                                metrics.estimated_tokens += llm_out.estimated_tokens;
                                fast_decisions[idx].1 = llm_out;
                            }
                            Err(err) => {
                                let (status, keep_decision) = match &err {
                                    LlmAdjudicationError::InvalidOutput(_) => {
                                        metrics.error_count += 1;
                                        (EvaluationStatus::Error, MatchDecision::PENDING)
                                    }
                                    LlmAdjudicationError::RateLimited(_)
                                    | LlmAdjudicationError::Timeout(_)
                                    | LlmAdjudicationError::Unavailable(_)
                                    | LlmAdjudicationError::ConsentRequired(_)
                                    | LlmAdjudicationError::StrictLocalBlocked(_) => {
                                        metrics.deferred_count += 1;
                                        (EvaluationStatus::Deferred, MatchDecision::PENDING)
                                    }
                                };
                                let fallback = &mut fast_decisions[idx].1;
                                // Preserve INCLUDE/UNCERTAIN if already known; never silently turn
                                // an error into EXCLUDE.
                                if fallback.decision == MatchDecision::EXCLUDE {
                                    fallback.decision = keep_decision;
                                } else if feed.classification_mode == ClassificationMode::Cloud {
                                    fallback.decision = MatchDecision::PENDING;
                                }
                                fallback.evaluation_status = status;
                                fallback.error_message = Some(err.to_string());
                            }
                        }
                    }
                }
                Some(Err(err)) => {
                    for &idx in &llm_indices {
                        metrics.deferred_count += 1;
                        let fallback = &mut fast_decisions[idx].1;
                        if fallback.decision == MatchDecision::EXCLUDE
                            || feed.classification_mode == ClassificationMode::Cloud
                        {
                            fallback.decision = MatchDecision::PENDING;
                        }
                        fallback.evaluation_status = EvaluationStatus::Deferred;
                        fallback.error_message = Some(err.to_string());
                    }
                }
                None => {}
            }
        }

        // Persist batch matches transactionally
        let evaluated_at = Utc::now().to_rfc3339();
        let mut to_persist = Vec::with_capacity(fast_decisions.len());
        for (idx, (snap, out, _)) in fast_decisions.into_iter().enumerate() {
            if skipped_cancelled[idx] {
                continue;
            }
            let fb_lift = match active_feedback.get(&snap.article_id) {
                Some(FeedbackType::SHOULD_INCLUDE) => 1.0,
                Some(FeedbackType::SHOULD_EXCLUDE) => 0.0,
                _ => 0.5,
            };
            let ranking_score =
                compute_ranking_score(out.relevance_score, snap.published_date.as_deref(), fb_lift);
            let (emb_prov, emb_mod) = cached_article_embs
                .get(&snap.article_id)
                .map(|e| (e.provider.clone(), e.model.clone()))
                .unwrap_or_default();

            metrics.evaluated_count += 1;
            match out.decision {
                MatchDecision::INCLUDE => metrics.matched_count += 1,
                MatchDecision::EXCLUDE => metrics.excluded_count += 1,
                MatchDecision::UNCERTAIN => metrics.uncertain_count += 1,
                MatchDecision::PENDING => {}
            }

            to_persist.push(SmartFeedMatch {
                smart_feed_id: feed.id.clone(),
                article_id: snap.article_id.clone(),
                decision: out.decision,
                relevance_score: out.relevance_score,
                ranking_score,
                decision_reason: out.decision_reason,
                matched_evidence: out.matched_evidence,
                decision_source: out.decision_source,
                content_hash: snap.content_hash.clone(),
                definition_revision: feed.definition_revision,
                classifier_version: CLASSIFIER_VERSION.to_string(),
                embedding_provider: emb_prov,
                embedding_model: emb_mod,
                evaluation_status: out.evaluation_status,
                error_message: out.error_message,
                is_user_override: false,
                evaluated_at: evaluated_at.clone(),
                evaluation_depth: out.evaluation_depth,
                content_provenance: snap.content_provenance,
                passages_evaluated: out.passages_evaluated,
                passages_total: out.passages_total,
                inference_calls: out.inference_calls,
                unexpected_truncation: out.unexpected_truncation,
                diagnostics: out.diagnostics,
            });
        }

        repository::upsert_matches_batch(pool, &to_persist).await?;
        processed_total += to_persist.len();
        if metrics.cancelled {
            emit_progress(
                "cancelled",
                processed_total,
                metrics.matched_count,
                metrics.excluded_count,
                metrics.uncertain_count,
                metrics.cache_hits,
                metrics.lexical_only,
                Some("Evaluation cancelled".to_string()),
            );
            break;
        }
        emit_progress(
            "running",
            processed_total,
            metrics.matched_count,
            metrics.excluded_count,
            metrics.uncertain_count,
            metrics.cache_hits,
            metrics.lexical_only,
            None,
        );
    }

    repository::touch_last_evaluated(pool, &feed.id).await?;
    metrics.duration_ms = start.elapsed().as_millis() as u64;
    if metrics.duration_ms > 0 {
        metrics.articles_per_sec =
            (metrics.total_scanned as f64) / (metrics.duration_ms as f64 / 1000.0);
    } else {
        metrics.articles_per_sec = metrics.total_scanned as f64;
    }

    if !metrics.cancelled {
        emit_progress(
            "completed",
            total_scoped,
            metrics.matched_count,
            metrics.excluded_count,
            metrics.uncertain_count,
            metrics.cache_hits,
            metrics.lexical_only,
            None,
        );
    }

    if let Some(app_handle) = app {
        let _ = app_handle.emit("rss:smart-feed:updated", &feed.id);
    }

    Ok(metrics)
}

/// Evaluate newly ingested or updated RSS articles across all enabled Smart
/// Feeds whose source scope covers the articles' feeds. Embeds each distinct
/// new article at most once, then reuses cached vectors across all feeds!
pub async fn evaluate_articles_for_enabled_feeds(
    pool: &SqlitePool,
    worker_state: Option<&SmartFeedWorkerState>,
    app: Option<&AppHandle>,
    article_ids: &[String],
    embedding_config: Option<EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
    ai_config: Option<AIConfig>,
    strict_local_only: bool,
) -> Result<Vec<SmartFeedRunMetrics>> {
    if article_ids.is_empty() {
        return Ok(Vec::new());
    }
    let all_feeds = repository::list_feeds_with_stats(pool).await?;
    let enabled: Vec<SmartFeed> = all_feeds
        .into_iter()
        .map(|s| s.feed)
        .filter(|f| f.is_enabled)
        .collect();
    if enabled.is_empty() {
        return Ok(Vec::new());
    }

    let articles = repository::load_articles_by_ids(pool, article_ids).await?;
    if articles.is_empty() {
        return Ok(Vec::new());
    }

    let mut feed_matches: Vec<(SmartFeed, Vec<String>)> = Vec::with_capacity(enabled.len());
    let mut cloud_article_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for feed in enabled {
        let allowed = repository::resolve_allowed_feed_ids(
            pool,
            feed.source_scope,
            &feed.source_scope_config,
        )
        .await?;
        let matching_ids: Vec<String> = articles
            .iter()
            .filter(|a| match &allowed {
                Some(set) => set.contains(&a.feed_id),
                None => true,
            })
            .map(|a| a.id.clone())
            .collect();
        if matching_ids.is_empty() {
            continue;
        }
        if matches!(
            feed.classification_mode,
            ClassificationMode::Hybrid | ClassificationMode::Cloud
        ) {
            cloud_article_ids.extend(matching_ids.iter().cloned());
        }
        feed_matches.push((feed, matching_ids));
    }

    if feed_matches.is_empty() {
        return Ok(Vec::new());
    }

    let any_cloud_article = !cloud_article_ids.is_empty();
    let backend = resolve_smart_feed_embedding_backend(
        embedding_config.as_ref(),
        paid_embeddings_enabled,
        strict_local_only || !any_cloud_article,
    );

    // Pre-generate missing embeddings ONCE across all matching Smart Feeds.
    // When using a cloud embedding backend, never embed articles that only
    // belong to FastLocal or IntelligentLocal feeds.
    if backend.is_available() {
        let is_cloud_backend =
            backend.kind() == crate::ai_learning::embeddings_backend::EmbeddingBackendKind::Cloud;
        let provider_name = backend.kind_name().to_string();
        let model_name = backend.model_name();
        let cached = repository::load_article_embeddings_chunked(pool, article_ids).await?;
        let mut missing_snaps = Vec::new();
        let mut missing_texts = Vec::new();
        for art in &articles {
            if is_cloud_backend && !cloud_article_ids.contains(&art.id) {
                continue;
            }
            let snap = build_article_snapshot(art);
            let valid = cached
                .get(&snap.article_id)
                .map(|e| {
                    e.provider == provider_name
                        && e.model == model_name
                        && e.content_hash == snap.content_hash
                        && !e.embedding.is_empty()
                })
                .unwrap_or(false);
            if !valid {
                missing_texts.push(snap.embedding_text.clone());
                missing_snaps.push(snap);
            }
        }
        if !missing_texts.is_empty() {
            if let Ok(vecs) = backend.embed_texts(&missing_texts).await {
                let repo = Repository::new(pool.clone());
                let now_ms = Utc::now().timestamp_millis();
                for (snap, vec) in missing_snaps.into_iter().zip(vecs.into_iter()) {
                    if vec.is_empty() {
                        continue;
                    }
                    let dim = vec.len() as i32;
                    let _ = repo
                        .upsert_embedding(&QueueItemEmbedding {
                            item_id: format!("rss-{}", snap.article_id),
                            embedding: vec,
                            content_hash: snap.content_hash,
                            provider: provider_name.clone(),
                            model: model_name.clone(),
                            dimension: dim,
                            created_at: now_ms,
                        })
                        .await;
                }
            }
        }
    }

    let mut out = Vec::new();
    for (feed, matching_ids) in feed_matches {
        let metrics = evaluate_smart_feed_with_deps(
            pool,
            worker_state,
            app,
            &feed.id,
            EvaluationOptions {
                force_reevaluate: false,
                article_ids: Some(matching_ids),
                embedding_config: embedding_config.clone(),
                paid_embeddings_enabled,
                ai_config: ai_config.clone(),
                strict_local_only,
                laya_config: worker_state.and_then(|w| w.runtime_config().laya_config),
            },
            None,
            None,
        )
        .await?;
        out.push(metrics);
    }
    Ok(out)
}

/// Apply an explicit user feedback action (`SHOULD_INCLUDE`, `SHOULD_EXCLUDE`,
/// or `UNDO`) for an article inside a Smart Feed, rebuild the feed-specific
/// preference profile, and keep the explicit override authoritative.
pub async fn apply_smart_feed_feedback(
    pool: &SqlitePool,
    smart_feed_id: &str,
    article_id: &str,
    feedback_type: FeedbackType,
    note: Option<&str>,
    embedding_config: Option<&EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
    strict_local_only: bool,
) -> Result<SmartFeedFeedbackResult> {
    let feed = repository::get_feed(pool, smart_feed_id).await?;
    let previous = repository::get_match_decision(pool, smart_feed_id, article_id).await?;
    let rows = repository::load_articles_by_ids(pool, &[article_id.to_string()]).await?;
    let article = rows.into_iter().next().ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Article '{}' not found", article_id))
    })?;
    let snap = build_article_snapshot(&article);

    repository::insert_feedback_event(
        pool,
        smart_feed_id,
        article_id,
        feedback_type,
        previous,
        note,
    )
    .await?;

    let feed_forces_local = matches!(
        feed.classification_mode,
        ClassificationMode::FastLocal | ClassificationMode::IntelligentLocal
    );
    let backend = resolve_smart_feed_embedding_backend(
        embedding_config,
        paid_embeddings_enabled,
        strict_local_only || feed_forces_local,
    );
    rebuild_feedback_profile(pool, smart_feed_id, Some(&backend)).await?;

    let now = Utc::now().to_rfc3339();
    match feedback_type {
        FeedbackType::SHOULD_INCLUDE | FeedbackType::SHOULD_EXCLUDE => {
            let (decision, rel, reason) = if feedback_type == FeedbackType::SHOULD_INCLUDE {
                (
                    MatchDecision::INCLUDE,
                    0.96,
                    format!("Manually included in {} by user feedback.", feed.name),
                )
            } else {
                (
                    MatchDecision::EXCLUDE,
                    0.02,
                    format!("Manually excluded from {} by user feedback.", feed.name),
                )
            };
            let fb_lift = if decision == MatchDecision::INCLUDE {
                1.0
            } else {
                0.0
            };
            let ranking = compute_ranking_score(rel, snap.published_date.as_deref(), fb_lift);
            repository::upsert_matches_batch(
                pool,
                &[SmartFeedMatch {
                    smart_feed_id: smart_feed_id.to_string(),
                    article_id: article_id.to_string(),
                    decision,
                    relevance_score: rel,
                    ranking_score: ranking,
                    decision_reason: reason.clone(),
                    matched_evidence: vec!["user feedback override".to_string()],
                    decision_source: DecisionSource::UserOverride,
                    content_hash: snap.content_hash,
                    definition_revision: feed.definition_revision,
                    classifier_version: CLASSIFIER_VERSION.to_string(),
                    embedding_provider: String::new(),
                    embedding_model: String::new(),
                    evaluation_status: EvaluationStatus::Completed,
                    error_message: None,
                    is_user_override: true,
                    evaluated_at: now,
                    evaluation_depth: feed.evaluation_depth,
                    content_provenance: snap.content_provenance,
                    passages_evaluated: 0,
                    passages_total: 0,
                    inference_calls: 0,
                    unexpected_truncation: false,
                    diagnostics: None,
                }],
            )
            .await?;

            Ok(SmartFeedFeedbackResult {
                smart_feed_id: smart_feed_id.to_string(),
                article_id: article_id.to_string(),
                decision,
                active_feedback: Some(feedback_type),
                is_user_override: true,
                decision_reason: reason,
            })
        }
        FeedbackType::UNDO => {
            repository::clear_match_user_override(pool, smart_feed_id, article_id).await?;
            let _ = evaluate_smart_feed_with_deps(
                pool,
                None,
                None,
                smart_feed_id,
                EvaluationOptions {
                    force_reevaluate: true,
                    article_ids: Some(vec![article_id.to_string()]),
                    embedding_config: embedding_config.cloned(),
                    paid_embeddings_enabled,
                    ai_config: None,
                    strict_local_only,
                    laya_config: None,
                },
                Some(backend),
                None,
            )
            .await?;
            let restored = repository::get_match_decision(pool, smart_feed_id, article_id)
                .await?
                .unwrap_or(MatchDecision::UNCERTAIN);
            Ok(SmartFeedFeedbackResult {
                smart_feed_id: smart_feed_id.to_string(),
                article_id: article_id.to_string(),
                decision: restored,
                active_feedback: None,
                is_user_override: false,
                decision_reason: format!(
                    "Feedback undone; automated classification restored ({}).",
                    restored.as_str()
                ),
            })
        }
    }
}
