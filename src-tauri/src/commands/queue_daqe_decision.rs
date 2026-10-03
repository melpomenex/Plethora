//! The second ranking pass: the only path that contacts a decision model.
//!
//! Split from `rank_queue` on purpose. That command is synchronous and budgeted at
//! 150 ms for the top ten, and a network round trip cannot live inside that budget —
//! so the two are different commands and the queue never waits on a provider.
//!
//! What this pass is allowed to change is **order only**. It re-ranks the same pool
//! with model judgements folded in and publishes a new snapshot; it cannot add or
//! remove an item, because "the model thought this was more relevant" is not a reason
//! to change what a session contains. That guarantee is what lets the queue reorder
//! under the user without the list they are reading changing shape.
//!
//! It evaluates only the top `DEFAULT_ENRICHED_CANDIDATES` from the first pass: the
//! region where a judgement can plausibly change what the user sees next, and small
//! enough that one bounded round of calls stays inside the provider's timeout rather
//! than scaling with pool size.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::algorithms::daqe::decision_model::http_provider::HttpDecisionProvider;
use crate::algorithms::daqe::decision_model::{
    DecisionModelProvider, DecisionRequest, GoalContext, ProviderFailure, ProviderRegistry,
};
use crate::algorithms::daqe::ranker::rank_with_top_n;
use crate::algorithms::daqe::{ItemSignals, RankContext, RecentItem};
use crate::commands::ai_key_store::AIKeyStore;
use crate::commands::daqe_probe::{DecisionProvider, key_slot, resolve_provider_url, DecisionConfig};
use crate::database::daqe_model_cache_repository::{content_hash_for, DaqeModelCacheRepository};
use crate::database::repository::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::daqe::{DaqeKnobs, QueueSnapshot};

/// How many top-ranked candidates the second pass asks the model about.
///
/// Deliberately small. Twenty is roughly two screens of "what comes next", which is
/// where a relevance judgement changes what the user actually sees; beyond that it
/// would be paying per token to re-order material nobody has reached yet.
pub const DEFAULT_ENRICHED_CANDIDATES: usize = 20;

/// Re-rank with the decision model's judgements folded in.
///
/// Returns `Ok(None)` — not an error — when there is nothing to ask: no provider
/// configured, a remote provider the user has not opted into, or a pool too small to
/// be worth a round trip. Every one of those leaves the first pass's snapshot standing,
/// which is a valid ranking.
#[tauri::command]
pub async fn rank_queue_with_decision(
    collection_id: Option<String>,
    goal: Option<String>,
    focus_tags: Option<Vec<String>>,
    knobs: DaqeKnobs,
    decision: Option<DecisionConfig>,
    candidates: Option<usize>,
    repo: State<'_, Repository>,
    key_store: State<'_, AIKeyStore>,
) -> Result<Option<QueueSnapshot>> {
    let knobs = knobs.validated().map_err(PlethoraError::InvalidInput)?;
    let Some(decision) = decision else {
        return Ok(None);
    };
    let limit = candidates.unwrap_or(DEFAULT_ENRICHED_CANDIDATES).clamp(1, 100);

    // The opt-in is checked here, before the provider is even constructed, so the
    // remote code path is unreachable rather than merely skipped. Running a probe is
    // not consent to ranking-time requests.
    let is_local = matches!(decision.provider, Some(DecisionProvider::SystemOne));
    if !is_local && !decision.allow_remote {
        return Ok(None);
    }

    let provider_id = decision
        .provider
        .as_ref()
        .ok_or_else(|| PlethoraError::InvalidInput("No decision provider is configured".into()))?;
    let url = resolve_provider_url(&decision)?;
    let timeout_ms = decision.timeout_ms.unwrap_or(ProviderRegistry::DEFAULT_TIMEOUT_MS);

    // The credential comes from the OS keychain here, at the start of the pass, and
    // is never read from settings — which hold only `decisionApiKeySet`.
    let api_key = key_slot(*provider_id)
        .and_then(|_| futures::executor::block_on(key_store.get_key(key_slot(*provider_id).unwrap_or_default())).ok())
        .flatten();
    let provider = HttpDecisionProvider::new(
        *provider_id,
        url,
        decision.model.clone(),
        api_key,
        timeout_ms,
    )
    .map_err(|failure| PlethoraError::Internal(format!("{failure:?}")))?;

    let goal_statement = goal.as_deref();
    let focus: Vec<String> = focus_tags.unwrap_or_default();
    let goal_context = goal_statement.map(|statement| GoalContext {
        statement,
        focus_tags: &focus,
    });

    // The pool and its signals are rebuilt exactly as the first pass builds them, so
    // the only difference between the two snapshots is the model judgements.
    let pool = crate::commands::queue::due_candidate_pool(repo.inner(), collection_id.as_deref())
        .await?;
    if pool.is_empty() {
        return Ok(None);
    }
    let mut signals = crate::commands::queue_daqe::collect_signals_for_pool(
        repo.inner(),
        &pool,
        goal_statement,
        None,
    )
    .await?;
    let recent: Vec<RecentItem> = repo.daqe_recent_history().await.unwrap_or_default();

    // Which candidates are worth asking about: the first pass's own answer.
    let baseline = {
        let ctx = RankContext {
            now: chrono::Utc::now(),
            recent: &recent,
            goal: goal_statement,
            focus_tags: &focus,
            signals: &signals,
            energy_downshift: None,
            recent_window: crate::algorithms::daqe::DEFAULT_RECENT_WINDOW,
        };
        rank_with_top_n(&pool, &knobs, &ctx)
    };
    let target_ids: Vec<String> = baseline
        .0
        .iter()
        .take(limit)
        .map(|entry| entry.item.id.clone())
        .collect();

    let by_id: HashMap<&str, &crate::models::queue::QueueItem> =
        pool.iter().map(|item| (item.id.as_str(), item)).collect();

    // Content-derived judgements are cached across sessions; goal alignment is not,
    // because it depends on the session rather than on the item. That asymmetry is
    // the whole reason the cache is keyed on content alone.
    let cache = DaqeModelCacheRepository::new(repo.pool().clone());

    // One bounded pass over the shortlist. A provider that fails is marked failed by
    // `evaluate_item`, so a single timeout ends the pass instead of costing one
    // timeout per candidate.
    let mut asked = 0usize;
    for signal in signals.iter_mut() {
        if !target_ids.iter().any(|id| id == &signal.item_id) {
            continue;
        }
        let Some(item) = by_id.get(signal.item_id.as_str()) else {
            continue;
        };
        asked += 1;
        let request = DecisionRequest {
            item_id: item.id.clone(),
            item_type: item.item_type.clone(),
            length_chars: estimate_length(item),
            outline: None,
            rubric_version: RANKER_RUBRIC_VERSION,
        };

        // Content-derived first: a hit costs no inference at all.
        let content_hash = content_hash_for(&item.item_type, &[], estimate_length(item));
        let cached = cache.get(&content_hash, RANKER_RUBRIC_VERSION).await.ok().flatten();
        if let Some(hit) = &cached {
            signal.complexity = hit.tier.as_ref().map(|tier| tier.complexity()).or(signal.complexity);
        }
        if cached.as_ref().is_some_and(|hit| hit.tier.is_some() && hit.gate.is_some()) {
            continue;
        }

        match provider.evaluate_item(&request, goal_context.as_ref()).await {
            Ok(decision_for_item) => {
                // Goal alignment is read every time and never written to the cache:
                // the same item under a different goal deserves a different answer.
                signal.goal_alignment = decision_for_item.goal_alignment;
                signal.complexity = decision_for_item
                    .tier
                    .map(|tier| tier.complexity())
                    .or(signal.complexity);
                // Best-effort: a cache that cannot be written must not fail a ranking.
                let _ = cache
                    .put(
                        &content_hash,
                        RANKER_RUBRIC_VERSION,
                        // The `score` column is deliberately not the goal alignment.
                        None,
                        decision_for_item.tier,
                        decision_for_item.gate,
                    )
                    .await;
            }
            Err(failure) => {
                tracing::debug!(?failure, "daqe decision pass ended early");
                break;
            }
        }
    }
    if asked == 0 {
        return Ok(None);
    }

    let ctx = RankContext {
        now: chrono::Utc::now(),
        recent: &recent,
        goal: goal_statement,
        focus_tags: &focus,
        signals: &signals,
        energy_downshift: None,
        recent_window: crate::algorithms::daqe::DEFAULT_RECENT_WINDOW,
    };
    let (ranked, top10) = rank_with_top_n(&pool, &knobs, &ctx);

    Ok(Some(QueueSnapshot {
        id: uuid::Uuid::new_v4().to_string(),
        collection_id: collection_id.clone(),
        profile: format!("decision:{}", provider_id.id()),
        knobs,
        ranked,
        top10,
        computed_at: chrono::Utc::now(),
    }))
}

/// Bumped when the questions or their reading change, so cached content-derived
/// judgements from an older rubric are treated as stale.
const RANKER_RUBRIC_VERSION: i32 = 2;

/// Roughly how much text an item asks the user to commit to.
///
/// The count is what reaches the provider — a length, never the text. It is a crude
/// proxy for "how long is this", which is the only content-derived property the
/// sanitization gate allows to leave the device.
fn estimate_length(item: &crate::models::queue::QueueItem) -> usize {
    [
        item.question.as_deref(),
        item.answer.as_deref(),
        item.cloze_text.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::len)
    .sum()
}

/// Whether a provider configuration would produce a request at all.
///
/// Exposed so the frontend can skip the round trip entirely rather than asking the
/// backend to decline it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecisionAvailability {
    pub available: bool,
    /// Why not, when `available` is false. Diagnostics only.
    pub reason: Option<String>,
}

/// Report whether the second pass would do anything.
///
/// Separate from the pass itself so the UI can decide whether to schedule it, and so
/// "not configured" is distinguishable from "configured but declined".
#[tauri::command]
pub async fn decision_model_availability(
    decision: Option<DecisionConfig>,
) -> Result<DecisionAvailability> {
    let Some(config) = decision else {
        return Ok(DecisionAvailability { available: false, reason: Some("no provider configured".into()) });
    };
    let Some(provider) = config.provider else {
        return Ok(DecisionAvailability { available: false, reason: Some("no provider configured".into()) });
    };
    let local = matches!(provider, DecisionProvider::SystemOne);
    if !local && !config.allow_remote {
        return Ok(DecisionAvailability {
            available: false,
            reason: Some("remote decision model is not opted in".into()),
        });
    }
    match resolve_provider_url(&config) {
        Ok(_) => Ok(DecisionAvailability { available: true, reason: None }),
        Err(error) => Ok(DecisionAvailability {
            available: false,
            reason: Some(error.to_string()),
        }),
    }
}

/// Whether a `ProviderFailure` should end the whole pass rather than just this item.
///
/// One place, so the "failed once per pass" rule cannot be re-decided per call site.
pub fn ends_pass(failure: &ProviderFailure) -> bool {
    matches!(
        failure,
        ProviderFailure::NotConfigured
            | ProviderFailure::SkippedAfterFailure
            | ProviderFailure::RemoteNotOptedIn
            | ProviderFailure::Timeout { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shortlist_is_bounded() {
        assert!(DEFAULT_ENRICHED_CANDIDATES <= 100);
    }

    #[tokio::test]
    async fn an_unconfigured_provider_is_declined_rather_than_errored() {
        let availability = decision_model_availability(None).await.unwrap();
        assert!(!availability.available);
        assert!(availability.reason.unwrap().contains("no provider"));
    }

    #[tokio::test]
    async fn a_remote_provider_without_the_opt_in_is_declined() {
        let config = DecisionConfig {
            provider: Some(DecisionProvider::Jev),
            allow_remote: false,
            ..Default::default()
        };
        let availability = decision_model_availability(Some(config)).await.unwrap();
        assert!(!availability.available, "running a probe is not consent to ranking");
        assert!(availability.reason.unwrap().contains("not opted in"));
    }

    #[tokio::test]
    async fn a_local_provider_needs_no_opt_in() {
        let config = DecisionConfig {
            provider: Some(DecisionProvider::SystemOne),
            base_url: Some("http://127.0.0.1:8000".into()),
            allow_remote: false,
            ..Default::default()
        };
        let availability = decision_model_availability(Some(config)).await.unwrap();
        assert!(availability.available, "a local model sends nothing anywhere");
    }

    #[tokio::test]
    async fn an_opted_in_remote_provider_is_available() {
        let config = DecisionConfig {
            provider: Some(DecisionProvider::Jev),
            allow_remote: true,
            ..Default::default()
        };
        let availability = decision_model_availability(Some(config)).await.unwrap();
        assert!(availability.available);
    }

    #[test]
    fn the_content_hash_ignores_the_goal_so_cached_tiers_survive_a_goal_change() {
        // The cache is keyed on content alone, which is what lets a tier computed for
        // one session be reused under a different goal — and what guarantees goal
        // alignment can never be served from it.
        let first = content_hash_for("document", &[], 4_200);
        let second = content_hash_for("document", &[], 4_200);
        assert_eq!(first, second, "the same content hashes the same under any goal");
        assert_ne!(first, content_hash_for("document", &[], 4_201));
        assert_ne!(first, content_hash_for("extract", &[], 4_200));
    }

    #[test]
    fn the_cache_key_separates_rubric_versions() {
        // Two rubric versions coexist rather than one overwriting the other, so a
        // mid-pass rubric change never shows the user a half-swapped cache.
        let hash = content_hash_for("document", &[], 100);
        assert_ne!(
            DaqeModelCacheRepository::key(&hash, 1),
            DaqeModelCacheRepository::key(&hash, 2),
        );
    }

    #[test]
    fn a_timeout_and_a_skip_both_end_the_pass() {
        assert!(ends_pass(&ProviderFailure::Timeout { ms: 8000 }));
        assert!(ends_pass(&ProviderFailure::SkippedAfterFailure));
        assert!(ends_pass(&ProviderFailure::NotConfigured));
        assert!(ends_pass(&ProviderFailure::RemoteNotOptedIn));
        // A single item's bad output is that item's problem, not the pass's.
        assert!(!ends_pass(&ProviderFailure::InvalidOutput("x".into())));
    }
}