//! Dynamic Adaptive Queue Engine — deterministic composite ranking.
//!
//! `S(i) = w_srs·R_srs(i) + w_goal·M_relevance(i) + w_fit·M_energy_fit(i,K) − P_interleave(i,H_recent) − P_friction(i)`
//!
//! Everything in this module is pure: producers take plain data and return
//! plain data, and `ranker::rank` only combines them. No database, no clock, no
//! network. That is what makes the whole scoring path unit-testable and
//! bench-able, and it is why [`RankContext`] carries already-resolved signals
//! (relevance, complexity, topic similarity, telemetry counts) instead of
//! loading them here.
//!
//! Module layout:
//! - [`terms`] — the five producers, one per term.
//! - [`ranker`] — combines them and orders the pool.
//! - [`decision_model`] — the pluggable provider (Phase 4).

pub mod decision_model;
pub mod learning;
pub mod ranker;
pub mod terms;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub use ranker::rank;
pub use terms::ItemSignals;

/// An item already reviewed in the current session, as the interleaving penalty
/// sees it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub item_id: String,
    /// Topic identity for the interleaving comparison. `None` means the item has
    /// no topic, which contributes no overlap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,
    pub item_type: String,
}

/// The raw counts the friction penalty reads. Every field is "how many times",
/// never a judgement: the penalty is what interprets them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrictionInputs {
    pub postpone_count: i32,
    /// Sessions where the user moved on without engaging.
    pub rapid_skip_count: i32,
    pub active_dwell_ms: i64,
    /// Discarded idle time. Its ratio against `active_dwell_ms` is the strongest
    /// resistance signal there is.
    pub idle_time_ms: i64,
    pub abandoned_reviews: i32,
}

impl FrictionInputs {
    /// True when nothing at all was recorded, in which case the penalty is
    /// zero rather than imputed — an unmeasured item is not a resistant one.
    pub fn is_untracked(&self) -> bool {
        self.postpone_count == 0
            && self.rapid_skip_count == 0
            && self.abandoned_reviews == 0
            && self.active_dwell_ms <= 0
            && self.idle_time_ms <= 0
    }

    /// The idle share of observed time, in `[0,1]`. `None` when nothing was
    /// observed.
    pub fn idle_share(&self) -> Option<f64> {
        let total = self.active_dwell_ms + self.idle_time_ms;
        if total <= 0 {
            return None;
        }
        Some(self.idle_time_ms as f64 / total as f64)
    }
}

/// A measured collapse in reading velocity, which lowers the *effective* energy
/// target without touching the user's configured one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnergyDownshift {
    /// The target actually used, below `knobs.energy_target`.
    pub effective_energy_target: f64,
    /// The human-readable reason, surfaced in the breakdown.
    pub reason: String,
    /// Observed velocity as a fraction of the user's own baseline. Below 0.4
    /// triggers a downshift.
    pub velocity_ratio: f64,
    /// Whether the baseline had enough samples to mean anything. `false` means
    /// no downshift was applied at all.
    pub baseline_sufficient: bool,
}

/// How many recent items the interleaving penalty considers. Matches the
/// `max_same_topic_streak` default already used by `engaging_scheduler`.
pub const DEFAULT_RECENT_WINDOW: usize = 3;

/// The composite ranker's input. Everything the terms need is already resolved
/// here; the producers never perform I/O.
#[derive(Debug, Clone)]
pub struct RankContext<'a> {
    /// The instant urgency is measured against. Supplied rather than read from
    /// the clock so ranking is reproducible in tests and benches.
    pub now: DateTime<Utc>,
    /// `H_recent`: items already reviewed this session, most recent last.
    pub recent: &'a [RecentItem],
    /// The user's active goal statement, if any.
    pub goal: Option<&'a str>,
    /// Per-candidate signals keyed by `item_id`. An item absent from this list
    /// gets every unavailable term's neutral value.
    pub signals: &'a [ItemSignals],
    /// The fatigue downshift to apply, when one was measured.
    pub energy_downshift: Option<&'a EnergyDownshift>,
    /// How many trailing entries of `recent` to consider.
    pub recent_window: usize,
}

impl<'a> RankContext<'a> {
    /// A context with no recent history, no goal, and no signals — the state a
    /// cold queue starts in, and the one every neutral-fallback test uses.
    pub fn bare(now: DateTime<Utc>) -> Self {
        Self {
            now,
            recent: &[],
            goal: None,
            signals: &[],
            energy_downshift: None,
            recent_window: DEFAULT_RECENT_WINDOW,
        }
    }

    pub fn signals_for(&self, item_id: &str) -> Option<&'a ItemSignals> {
        self.signals.iter().find(|s| s.item_id == item_id)
    }

    /// The trailing slice of `recent` the penalty looks at.
    pub fn recent_window(&self) -> &'a [RecentItem] {
        let take = self.recent_window.min(self.recent.len());
        &self.recent[self.recent.len() - take..]
    }
}