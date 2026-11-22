//! Tauri commands for AI-powered RSS Smart Feeds.

use crate::ai::providers::LLMProviderType;
use crate::commands::ai::AIState;
use crate::commands::ai_key_store::AIKeyStore;
use crate::commands::semantic_graph::EmbeddingConfigInput;
use crate::database::Repository;
use crate::error::Result;
use crate::rss_smart_feeds::clustering::{group_feed_articles, ClusterVector};
use crate::rss_smart_feeds::models::*;
use crate::rss_smart_feeds::repository;
use crate::rss_smart_feeds::worker::{
    apply_smart_feed_feedback, evaluate_smart_feed_with_deps, is_loopback_url,
    resolve_smart_feed_embedding_backend, EvaluationOptions, SmartFeedWorkerState,
};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_rss_smart_feed(
    input: CreateSmartFeedInput,
    evaluate_now: Option<bool>,
    embedding_config: Option<EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
    strict_local_only: Option<bool>,
    laya_config: Option<SmartFeedLayaConfig>,
    app: AppHandle,
    repo: State<'_, Repository>,
    ai_state: State<'_, AIState>,
    worker: State<'_, SmartFeedWorkerState>,
) -> Result<SmartFeedWithStats> {
    worker.update_runtime_config(
        embedding_config.clone(),
        paid_embeddings_enabled,
        strict_local_only,
        laya_config.clone(),
    );
    let created = repository::create_feed(repo.pool(), input).await?;
    let stats = repository::get_feed_with_stats(repo.pool(), &created.id).await?;

    if evaluate_now.unwrap_or(true) && created.is_enabled {
        let pool = repo.pool().clone();
        let worker_clone = worker.inner().clone();
        let app_clone = app.clone();
        let feed_id = created.id.clone();
        let ai_cfg = ai_state.config.lock().ok().and_then(|g| g.clone());
        let strict = strict_local_only.unwrap_or(false);
        tauri::async_runtime::spawn(async move {
            let _ = evaluate_smart_feed_with_deps(
                &pool,
                Some(&worker_clone),
                Some(&app_clone),
                &feed_id,
                EvaluationOptions {
                    force_reevaluate: false,
                    article_ids: None,
                    embedding_config,
                    paid_embeddings_enabled,
                    ai_config: ai_cfg,
                    strict_local_only: strict,
                    laya_config,
                },
                None,
                None,
            )
            .await;
        });
    }

    Ok(stats)
}

#[tauri::command]
pub async fn get_rss_smart_feeds(repo: State<'_, Repository>) -> Result<Vec<SmartFeedWithStats>> {
    repository::list_feeds_with_stats(repo.pool()).await
}

#[tauri::command]
pub async fn get_rss_smart_feed(
    id: String,
    repo: State<'_, Repository>,
) -> Result<SmartFeedWithStats> {
    repository::get_feed_with_stats(repo.pool(), &id).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_rss_smart_feed(
    id: String,
    input: UpdateSmartFeedInput,
    reevaluate_now: Option<bool>,
    embedding_config: Option<EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
    strict_local_only: Option<bool>,
    laya_config: Option<SmartFeedLayaConfig>,
    app: AppHandle,
    repo: State<'_, Repository>,
    ai_state: State<'_, AIState>,
    worker: State<'_, SmartFeedWorkerState>,
) -> Result<SmartFeedWithStats> {
    worker.update_runtime_config(
        embedding_config.clone(),
        paid_embeddings_enabled,
        strict_local_only,
        laya_config.clone(),
    );
    let (updated, policy_changed) = repository::update_feed(repo.pool(), &id, input).await?;
    let stats = repository::get_feed_with_stats(repo.pool(), &updated.id).await?;

    let should_eval = reevaluate_now.unwrap_or(policy_changed) && updated.is_enabled;
    if should_eval {
        let pool = repo.pool().clone();
        let worker_clone = worker.inner().clone();
        let app_clone = app.clone();
        let feed_id = updated.id.clone();
        let ai_cfg = ai_state.config.lock().ok().and_then(|g| g.clone());
        let strict = strict_local_only.unwrap_or(false);
        tauri::async_runtime::spawn(async move {
            let _ = evaluate_smart_feed_with_deps(
                &pool,
                Some(&worker_clone),
                Some(&app_clone),
                &feed_id,
                EvaluationOptions {
                    force_reevaluate: false,
                    article_ids: None,
                    embedding_config,
                    paid_embeddings_enabled,
                    ai_config: ai_cfg,
                    strict_local_only: strict,
                    laya_config,
                },
                None,
                None,
            )
            .await;
        });
    } else {
        let _ = app.emit("rss:smart-feed:updated", &updated.id);
    }

    Ok(stats)
}

#[tauri::command]
pub async fn delete_rss_smart_feed(
    id: String,
    app: AppHandle,
    repo: State<'_, Repository>,
    worker: State<'_, SmartFeedWorkerState>,
) -> Result<()> {
    worker.cancel_feed(&id);
    repository::delete_feed(repo.pool(), &id).await?;
    let _ = app.emit("rss:smart-feed:updated", &id);
    Ok(())
}

#[tauri::command]
pub async fn get_rss_smart_feed_articles(
    smart_feed_id: String,
    filter: Option<SmartFeedArticlesFilter>,
    repo: State<'_, Repository>,
) -> Result<SmartFeedArticlesResponse> {
    let filter = filter.unwrap_or_default();
    let smart_feed = repository::get_feed_with_stats(repo.pool(), &smart_feed_id).await?;
    let (mut articles, total_in_bucket) =
        repository::query_feed_articles(repo.pool(), &smart_feed_id, &filter).await?;

    // Attach sibling Smart Feed memberships so multi-feed articles show badges.
    let ids: Vec<String> = articles.iter().map(|a| a.article_id.clone()).collect();
    let memberships = repository::get_article_memberships_batch(repo.pool(), &ids).await?;
    for art in &mut articles {
        if let Some(badges) = memberships.get(&art.article_id) {
            art.also_in_smart_feeds = badges
                .iter()
                .filter(|b| b.smart_feed_id != smart_feed_id)
                .cloned()
                .collect();
        }
    }

    let should_group = filter
        .group_similar_stories
        .unwrap_or(smart_feed.feed.group_similar_stories);
    let bucket = filter.bucket.unwrap_or(MatchDecision::INCLUDE);
    if should_group && bucket == MatchDecision::INCLUDE && articles.len() > 1 {
        let cached = repository::load_article_embeddings_chunked(repo.pool(), &ids).await?;
        let vec_refs: HashMap<String, ClusterVector<'_>> = cached
            .iter()
            .map(|(aid, emb)| {
                (
                    aid.clone(),
                    ClusterVector {
                        provider: emb.provider.as_str(),
                        model: emb.model.as_str(),
                        vector: emb.embedding.as_slice(),
                    },
                )
            })
            .collect();
        articles = group_feed_articles(articles, &vec_refs);
    }

    let grouped_count = articles.len() as i64;
    Ok(SmartFeedArticlesResponse {
        smart_feed,
        articles,
        total_in_bucket,
        grouped_count,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn evaluate_rss_smart_feed(
    smart_feed_id: String,
    force_reevaluate: Option<bool>,
    wait_for_completion: Option<bool>,
    embedding_config: Option<EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
    strict_local_only: Option<bool>,
    laya_config: Option<SmartFeedLayaConfig>,
    app: AppHandle,
    repo: State<'_, Repository>,
    ai_state: State<'_, AIState>,
    worker: State<'_, SmartFeedWorkerState>,
) -> Result<SmartFeedRunMetrics> {
    worker.update_runtime_config(
        embedding_config.clone(),
        paid_embeddings_enabled,
        strict_local_only,
        laya_config.clone(),
    );
    let ai_cfg = ai_state.config.lock().ok().and_then(|g| g.clone());
    let strict = strict_local_only.unwrap_or(false);
    let force = force_reevaluate.unwrap_or(false);

    if wait_for_completion.unwrap_or(true) {
        evaluate_smart_feed_with_deps(
            repo.pool(),
            Some(worker.inner()),
            Some(&app),
            &smart_feed_id,
            EvaluationOptions {
                force_reevaluate: force,
                article_ids: None,
                embedding_config,
                paid_embeddings_enabled,
                ai_config: ai_cfg,
                strict_local_only: strict,
                laya_config,
            },
            None,
            None,
        )
        .await
    } else {
        let pool = repo.pool().clone();
        let worker_clone = worker.inner().clone();
        let app_clone = app.clone();
        let fid = smart_feed_id.clone();
        tauri::async_runtime::spawn(async move {
            let _ = evaluate_smart_feed_with_deps(
                &pool,
                Some(&worker_clone),
                Some(&app_clone),
                &fid,
                EvaluationOptions {
                    force_reevaluate: force,
                    article_ids: None,
                    embedding_config,
                    paid_embeddings_enabled,
                    ai_config: ai_cfg,
                    strict_local_only: strict,
                    laya_config,
                },
                None,
                None,
            )
            .await;
        });
        Ok(SmartFeedRunMetrics {
            smart_feed_id,
            ..Default::default()
        })
    }
}

#[tauri::command]
pub async fn cancel_rss_smart_feed_evaluation(
    smart_feed_id: String,
    worker: State<'_, SmartFeedWorkerState>,
) -> Result<bool> {
    Ok(worker.cancel_feed(&smart_feed_id))
}

#[tauri::command]
pub async fn get_rss_smart_feed_progress(
    smart_feed_id: String,
    worker: State<'_, SmartFeedWorkerState>,
) -> Result<Option<SmartFeedProgress>> {
    Ok(worker.get_progress(&smart_feed_id))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn submit_rss_smart_feed_feedback(
    smart_feed_id: String,
    article_id: String,
    feedback_type: FeedbackType,
    note: Option<String>,
    embedding_config: Option<EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
    strict_local_only: Option<bool>,
    laya_config: Option<SmartFeedLayaConfig>,
    app: AppHandle,
    repo: State<'_, Repository>,
    worker: State<'_, SmartFeedWorkerState>,
) -> Result<SmartFeedFeedbackResult> {
    worker.update_runtime_config(
        embedding_config.clone(),
        paid_embeddings_enabled,
        strict_local_only,
        laya_config,
    );
    let result = apply_smart_feed_feedback(
        repo.pool(),
        &smart_feed_id,
        &article_id,
        feedback_type,
        note.as_deref(),
        embedding_config.as_ref(),
        paid_embeddings_enabled,
        strict_local_only.unwrap_or(false),
    )
    .await?;
    let _ = app.emit("rss:smart-feed:updated", &smart_feed_id);
    Ok(result)
}

#[tauri::command]
pub async fn get_rss_smart_feed_capabilities(
    embedding_config: Option<EmbeddingConfigInput>,
    paid_embeddings_enabled: Option<bool>,
    strict_local_only: Option<bool>,
    laya_config: Option<SmartFeedLayaConfig>,
    ai_state: State<'_, AIState>,
    key_store: State<'_, AIKeyStore>,
    worker: State<'_, SmartFeedWorkerState>,
) -> Result<SmartFeedCapabilities> {
    worker.update_runtime_config(
        embedding_config.clone(),
        paid_embeddings_enabled,
        strict_local_only,
        laya_config.clone(),
    );
    let strict = strict_local_only.unwrap_or(false);
    let paid_ok = paid_embeddings_enabled.unwrap_or(false);

    let backend = resolve_smart_feed_embedding_backend(
        embedding_config.as_ref(),
        paid_embeddings_enabled,
        strict,
    );
    let semantic_embeddings_available = backend.is_available();
    let embedding_provider = if semantic_embeddings_available {
        Some(backend.kind_name().to_string())
    } else {
        None
    };
    let embedding_model = if semantic_embeddings_available {
        Some(backend.model_name())
    } else {
        None
    };

    let ai_cfg = ai_state.config.lock().ok().and_then(|g| g.clone());
    let laya_configured = laya_config.as_ref().filter(|c| c.enabled).and_then(|cfg| {
        let base_url = cfg
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(crate::laya_runtime::LAYA_ENDPOINT);
        if is_loopback_url(base_url) {
            let label = cfg
                .model
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|m| format!("Laya ({m})"))
                .unwrap_or_else(|| "Laya (typed-decisions)".to_string());
            Some(label)
        } else {
            None
        }
    });

    let (intelligent_local_available, local_llm_model) = if let Some(label) = laya_configured {
        (true, Some(label))
    } else if crate::laya_runtime::is_managed_running()
        || crate::laya_runtime::is_laya_endpoint_healthy(crate::laya_runtime::LAYA_ENDPOINT).await
    {
        (true, Some("Laya (typed-decisions)".to_string()))
    } else {
        match ai_cfg.as_ref() {
            Some(cfg) => {
                let ok = is_loopback_url(&cfg.local_settings.ollama_base_url)
                    && !cfg.models.ollama_model.trim().is_empty();
                (
                    ok,
                    if ok {
                        Some(cfg.models.ollama_model.clone())
                    } else {
                        None
                    },
                )
            }
            None => (false, None),
        }
    };

    let mut cloud_llm_provider: Option<String> = None;
    let mut cloud_llm_model: Option<String> = None;
    if !strict {
        if let Some(ref cfg) = ai_cfg {
            match cfg.default_provider {
                LLMProviderType::OpenAI
                    if cfg.api_keys.openai.as_ref().is_some_and(|k| !k.is_empty()) =>
                {
                    cloud_llm_provider = Some("openai".to_string());
                    cloud_llm_model = Some(cfg.models.openai_model.clone());
                }
                LLMProviderType::Anthropic
                    if cfg
                        .api_keys
                        .anthropic
                        .as_ref()
                        .is_some_and(|k| !k.is_empty()) =>
                {
                    cloud_llm_provider = Some("anthropic".to_string());
                    cloud_llm_model = Some(cfg.models.anthropic_model.clone());
                }
                LLMProviderType::OpenRouter
                    if cfg
                        .api_keys
                        .openrouter
                        .as_ref()
                        .is_some_and(|k| !k.is_empty()) =>
                {
                    cloud_llm_provider = Some("openrouter".to_string());
                    cloud_llm_model = Some(cfg.models.openrouter_model.clone());
                }
                LLMProviderType::DeepSeek
                    if cfg
                        .api_keys
                        .deepseek
                        .as_ref()
                        .is_some_and(|k| !k.is_empty()) =>
                {
                    cloud_llm_provider = Some("deepseek".to_string());
                    cloud_llm_model = Some(cfg.models.deepseek_model.clone());
                }
                _ => {}
            }
        }
        if cloud_llm_provider.is_none() {
            for (name, default_model) in [
                ("openai", "gpt-4o-mini"),
                ("openrouter", "openai/gpt-4o-mini"),
                ("anthropic", "claude-3-5-haiku-latest"),
                ("deepseek", "deepseek-chat"),
            ] {
                if let Ok(Some(k)) = key_store.get_key(name).await {
                    if !k.trim().is_empty() {
                        cloud_llm_provider = Some(name.to_string());
                        cloud_llm_model = Some(default_model.to_string());
                        break;
                    }
                }
            }
        }
    }

    Ok(SmartFeedCapabilities {
        fast_local_available: true,
        semantic_embeddings_available,
        embedding_provider,
        embedding_model,
        intelligent_local_available,
        local_llm_model,
        cloud_llm_available: cloud_llm_provider.is_some(),
        cloud_llm_provider,
        cloud_llm_model,
        strict_local_only: strict,
        paid_embeddings_enabled: paid_ok,
    })
}

#[tauri::command]
pub async fn get_article_smart_feed_memberships(
    article_ids: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<HashMap<String, Vec<SmartFeedBadge>>> {
    repository::get_article_memberships_batch(repo.pool(), &article_ids).await
}

#[tauri::command]
pub async fn export_rss_smart_feeds(
    repo: State<'_, Repository>,
) -> Result<SmartFeedsExportPayload> {
    repository::export_all_feeds(repo.pool()).await
}

#[tauri::command]
pub async fn import_rss_smart_feeds(
    payload: SmartFeedsExportPayload,
    app: AppHandle,
    repo: State<'_, Repository>,
) -> Result<SmartFeedsImportResult> {
    let res = repository::import_feeds_payload(repo.pool(), payload).await?;
    if res.imported > 0 {
        let _ = app.emit("rss:smart-feed:updated", "import");
    }
    Ok(res)
}
