//! `rank_queue` — the adaptive queue ranker's command surface.
//!
//! Ranking is a **read** that produces a snapshot. It never writes to a scheduler
//! table, never consumes the pool, and never marks anything reviewed: knobs
//! change what the user sees *next*, never when an item comes back.
//!
//! **Where the decision model runs.** The AI task spine (`runTask`,
//! `resolveTaskRoute`, schema-validated structured output) lives in the frontend,
//! so the model cannot be called from Rust. Model judgements therefore cross the
//! boundary as command *input* — `ModelInput` — rather than being fetched here.
//! Rust owns the pure half: urgency from scheduling state, relevance from
//! `algorithms::relevance`, friction from telemetry, and the ranking itself.
//! `unified-native-on-device-ai` decided "extend this spine, no second router", and
//! this boundary is what that decision implies in practice.
//!
//! The command runs on Tauri's async runtime rather than the webview, and the
//! store keeps rendering the previous snapshot while it runs — so "re-ranking does
//! not block the UI thread" is true by construction, not by discipline.
//!
//! Fallback order:
//!
//! 1. **Rank** the due-candidate pool under the current knobs, with whatever
//!    model inputs the frontend supplied. A model input that is absent simply
//!    leaves its term unavailable.
//! 2. **Degrade** to the pre-DAQE sort — `rank()` does this itself when the knobs
//!    leave every non-SRS term neutral — rather than failing.
//!
//! An empty pool means an empty library, not an error.

use crate::algorithms::daqe::ranker::{rank, rank_with_top_n};
use crate::algorithms::daqe::{ItemSignals, RankContext, RecentItem};
use crate::database::repository::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::daqe::{DaqeKnobs, QueueSnapshot};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

/// One item's model-derived inputs, gathered by the frontend.
///
/// Everything here is optional and every `None` means "not measured", never
/// "measured as zero". That distinction is what lets the ranker report an
/// untracked term honestly instead of presenting a fallback as a measurement.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInput {
    pub item_id: String,
    /// `ItemComplexity(i)` on the shared 1–5 scale, from `evaluateChoice`.
    #[serde(default)]
    pub complexity: Option<f64>,
    /// Strongest topic similarity against the recent window, in `[0,1]`.
    #[serde(default)]
    pub topic_similarity_to_recent: Option<f64>,
    /// Ids of the recent items the similarity was strongest against.
    #[serde(default)]
    pub topic_matches: Vec<String>,
    /// The adaptive learning loop's cluster promotion, in `[0,1]`.
    #[serde(default)]
    pub cluster_boost: Option<f64>,
}

/// Rank the due-candidate pool under `knobs` and publish a snapshot.
///
/// Returns the full ranked order plus the top ten. Only the top ten is covered by
/// the 150 ms budget, because only the top ten is what the user sees next.
#[tauri::command]
pub async fn rank_queue(
    collection_id: Option<String>,
    knobs: DaqeKnobs,
    model_inputs: Option<Vec<ModelInput>>,
    repo: State<'_, Repository>,
) -> Result<QueueSnapshot> {
    let knobs = knobs.validated().map_err(PlethoraError::InvalidInput)?;

    let snapshot =
        build_snapshot(repo.inner(), collection_id.as_deref(), &knobs, model_inputs).await?;
    // Persisting is best-effort: a snapshot that could not be stored is still a
    // valid ranking for this session, and failing the command would discard it for
    // no benefit.
    let _ = repo.daqe_store_snapshot(&snapshot).await;
    Ok(snapshot)
}

/// The most recent snapshot for this collection and knob signature, if any.
///
/// Restoring rather than recomputing is what keeps a queue stable across a reload
/// when nothing has changed: a fresh score would be within noise but not
/// identical, and a list that reshuffles on every reload reads as broken.
#[tauri::command]
pub async fn get_last_queue_snapshot(
    collection_id: Option<String>,
    knobs: DaqeKnobs,
    repo: State<'_, Repository>,
) -> Result<Option<QueueSnapshot>> {
    let knobs = knobs.validated().map_err(PlethoraError::InvalidInput)?;
    repo.daqe_load_snapshot(collection_id.as_deref(), &knobs)
        .await
}

/// Rank the pool and assemble the snapshot.
///
/// Separated from the command so tests can build one without a `State<Repository>`.
pub(crate) async fn build_snapshot(
    repo: &Repository,
    collection_id: Option<&str>,
    knobs: &DaqeKnobs,
    model_inputs: Option<Vec<ModelInput>>,
) -> Result<QueueSnapshot> {
    let now = Utc::now();
    let pool = crate::commands::queue::due_candidate_pool(repo, collection_id).await?;
    let signals = collect_signals(repo, &pool, model_inputs).await?;
    let recent = recent_history(repo).await.unwrap_or_default();

    let ctx = RankContext {
        now,
        recent: &recent,
        goal: None,
        signals: &signals,
        energy_downshift: None,
        recent_window: crate::algorithms::daqe::DEFAULT_RECENT_WINDOW,
    };

    // `rank` handles the SRS-only deferral internally, so there is exactly one
    // ordering path and no second copy of the decision to keep in sync.
    let (ranked, top10) = rank_with_top_n(&pool, knobs, &ctx);

    Ok(QueueSnapshot {
        id: Uuid::new_v4().to_string(),
        collection_id: collection_id.map(str::to_string),
        profile: "default".to_string(),
        knobs: *knobs,
        ranked,
        top10,
        computed_at: now,
    })
}

/// Merge the three signal sources into one list, one entry per candidate.
///
/// Friction comes from the database, model inputs from the frontend, and
/// relevance from `algorithms::relevance`. An item absent from the frontend's list
/// still gets an entry, so its model-derived terms report as untracked rather
/// than the item silently vanishing from consideration.
async fn collect_signals(
    repo: &Repository,
    pool: &[crate::models::queue::QueueItem],
    model_inputs: Option<Vec<ModelInput>>,
) -> Result<Vec<ItemSignals>> {
    let by_id: std::collections::HashMap<&str, &ModelInput> = model_inputs
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(|input| (input.item_id.as_str(), input))
        .collect();

    let mut signals = Vec::with_capacity(pool.len());
    for item in pool {
        // A telemetry read failure is not an error the queue should see: an
        // unmeasured item gets no friction, which is also its correct value.
        let friction = repo
            .daqe_friction_inputs(&item.id)
            .await
            .unwrap_or_default();
        let model = by_id.get(item.id.as_str()).copied();

        signals.push(ItemSignals {
            item_id: item.id.clone(),
            // Relevance is Rust's to compute (design D2): `relevance.rs` owns the
            // four-signal blend and its weight redistribution.
            relevance: repo.daqe_relevance(item).await.ok().flatten(),
            complexity: model.and_then(|m| m.complexity),
            topic_similarity_to_recent: model
                .and_then(|m| m.topic_similarity_to_recent)
                .unwrap_or(0.0),
            topic_matches: model.map(|m| m.topic_matches.clone()).unwrap_or_default(),
            friction,
            cluster_boost: model.and_then(|m| m.cluster_boost).unwrap_or(0.0),
        });
    }
    Ok(signals)
}

/// The items already reviewed this session, for the interleaving penalty.
///
/// Empty until a session records a history, in which case the penalty is
/// unavailable rather than zero-by-assumption.
async fn recent_history(repo: &Repository) -> Result<Vec<RecentItem>> {
    repo.daqe_recent_history().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_model_input_deserialises_from_camel_case_with_everything_absent() {
        let input: ModelInput = serde_json::from_str(r#"{"itemId":"item-1"}"#)
            .expect("a bare id is the worst legitimate case");
        assert_eq!(input.item_id, "item-1");
        assert_eq!(input.complexity, None);
        assert_eq!(input.topic_similarity_to_recent, None);
        assert!(input.topic_matches.is_empty());
        assert_eq!(input.cluster_boost, None);
    }

    #[test]
    fn a_model_input_round_trips() {
        let input = ModelInput {
            item_id: "item-1".to_string(),
            complexity: Some(4.0),
            topic_similarity_to_recent: Some(0.7),
            topic_matches: vec!["recent-1".to_string()],
            cluster_boost: Some(0.2),
        };
        let back: ModelInput =
            serde_json::from_str(&serde_json::to_string(&input).expect("serialise"))
                .expect("deserialise");
        assert_eq!(back, input);
    }

    #[test]
    fn an_out_of_range_knob_is_rejected_rather_than_coerced() {
        let bad = DaqeKnobs { srs_decay_weight: 1.4, ..DaqeKnobs::default() };
        assert!(bad.validated().is_err());
        let good = DaqeKnobs::default();
        assert!(good.validated().is_ok());
    }
}