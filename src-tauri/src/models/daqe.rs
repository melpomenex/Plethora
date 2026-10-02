//! Dynamic Adaptive Queue Engine: knobs, scoring terms, and snapshots.
//!
//! The types here are the wire contract between the Rust ranker, the Tauri
//! command surface, and the frontend knob panel. They are deliberately plain
//! data: `algorithms::daqe::ranker` takes them by reference and performs no I/O,
//! so the whole scoring path is unit-testable and bench-able in isolation.
//!
//! Two invariants everything else leans on:
//!
//! 1. Every term carries an `available` flag. A term whose input signal was
//!    missing is reported as unmeasured rather than silently imputed, so no
//!    ranking surface ever displays a fabricated number.
//! 2. Knobs only ever affect *order*. Nothing in this module reads or writes
//!    scheduler state, and `DaqeKnobs` has no field that could.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// The six user-facing ranking knobs, with the ranges and defaults specified by
/// `queue-mode-presets`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaqeKnobs {
    /// Weight on spaced-repetition urgency. `[0.0, 1.0]`, default `0.40`.
    pub srs_decay_weight: f64,
    /// Weight on relevance to the user's active goal. `[0.0, 1.0]`, default `0.30`.
    pub goal_relevance: f64,
    /// The user's energy target. Integer `1..5`, default `3`.
    pub energy_target: i32,
    /// Weight on the interleaving penalty. `[0.0, 1.0]`, default `0.20`.
    pub interleaving_diversity: f64,
    /// Weight on the friction penalty. `[0.0, 1.0]`, default `0.10`.
    pub pruning_aggressiveness: f64,
    /// Dwell inactivity cutoff in milliseconds. `[15000, 120000]`, default `45000`.
    pub afk_idle_timeout_ms: i64,
}

/// Inclusive bounds for the idle timeout, in milliseconds.
pub const AFK_IDLE_TIMEOUT_MIN_MS: i64 = 15_000;
pub const AFK_IDLE_TIMEOUT_MAX_MS: i64 = 120_000;

/// The complexity scale shared by `DaqeKnobs::energy_target` and
/// [`DecisionModelTier`]. Both live on `1..=5`, which is what makes
/// `energy_fit` a plain distance.
pub const COMPLEXITY_SCALE_MIN: f64 = 1.0;
pub const COMPLEXITY_SCALE_MAX: f64 = 5.0;
/// The width of the `1..5` scale — the divisor in `1 - |c - K| / SPAN`.
pub const COMPLEXITY_SCALE_SPAN: f64 = COMPLEXITY_SCALE_MAX - COMPLEXITY_SCALE_MIN;

impl Default for DaqeKnobs {
    fn default() -> Self {
        Self {
            srs_decay_weight: 0.40,
            goal_relevance: 0.30,
            energy_target: 3,
            interleaving_diversity: 0.20,
            pruning_aggressiveness: 0.10,
            afk_idle_timeout_ms: 45_000,
        }
    }
}

impl DaqeKnobs {
    /// Whether only spaced repetition contributes a weight. Note this requires
    /// `srs_decay_weight` to be non-zero: with *every* knob at zero every score
    /// is 0.0 and the ordering collapses to input order, which is not the
    /// pre-DAQE sort and must not be mistaken for it.
    pub fn is_srs_only(&self) -> bool {
        self.srs_decay_weight != 0.0
            && self.goal_relevance == 0.0
            && self.interleaving_diversity == 0.0
            && self.pruning_aggressiveness == 0.0
    }

    /// Reject any out-of-range or non-integer knob, leaving the receiver
    /// untouched on failure. Mirrors the frontend validator so a value can never
    /// be accepted on one side of the boundary and rejected on the other.
    pub fn validated(&self) -> Result<DaqeKnobs, String> {
        check_unit("srsDecayWeight", self.srs_decay_weight)?;
        check_unit("goalRelevance", self.goal_relevance)?;
        check_unit("interleavingDiversity", self.interleaving_diversity)?;
        check_unit("pruningAggressiveness", self.pruning_aggressiveness)?;
        if !(COMPLEXITY_SCALE_MIN as i32..=COMPLEXITY_SCALE_MAX as i32)
            .contains(&self.energy_target)
        {
            return Err(format!(
                "energyTarget must be an integer between {} and {}, got {}",
                COMPLEXITY_SCALE_MIN as i32, COMPLEXITY_SCALE_MAX as i32, self.energy_target
            ));
        }
        if !(AFK_IDLE_TIMEOUT_MIN_MS..=AFK_IDLE_TIMEOUT_MAX_MS)
            .contains(&self.afk_idle_timeout_ms)
        {
            return Err(format!(
                "afkIdleTimeoutMs must be between {} and {}, got {}",
                AFK_IDLE_TIMEOUT_MIN_MS, AFK_IDLE_TIMEOUT_MAX_MS, self.afk_idle_timeout_ms
            ));
        }
        Ok(*self)
    }
}

fn check_unit(name: &str, value: f64) -> Result<(), String> {
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return Err(format!("{name} must be between 0.0 and 1.0, got {value}"));
    }
    Ok(())
}

/// A discrete cognitive-load classification supplied by the decision model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DecisionModelTier {
    /// Light skim: headlines, abstracts, short bullet lists.
    SurfaceSkim,
    /// A considered read of one section.
    MediumAnalysis,
    /// Sustained close reading of a primary source.
    DeepFoundational,
}

impl DecisionModelTier {
    /// The value stored in `daqe_model_cache.tier`.
    pub fn as_str(&self) -> &'static str {
        match self {
            DecisionModelTier::SurfaceSkim => "surface-skim",
            DecisionModelTier::MediumAnalysis => "medium-analysis",
            DecisionModelTier::DeepFoundational => "deep-foundational",
        }
    }

    /// Named to match `ActivitySurface::from_str` / `ActivityItemType::from_str`,
    /// the codebase's convention for parsing a stored wire string. Clippy's
    /// `should_implement_trait` lint fires on that convention; diverging here
    /// would make this the only stored-string parser in the repo with a
    /// different name.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "surface-skim" => Some(DecisionModelTier::SurfaceSkim),
            "medium-analysis" => Some(DecisionModelTier::MediumAnalysis),
            "deep-foundational" => Some(DecisionModelTier::DeepFoundational),
            _ => None,
        }
    }

    /// The tier's point on the shared `1..5` complexity scale. This is the value
    /// `energy_fit` measures distance against.
    pub fn complexity(&self) -> f64 {
        match self {
            DecisionModelTier::SurfaceSkim => 1.0,
            DecisionModelTier::MediumAnalysis => 3.0,
            DecisionModelTier::DeepFoundational => 5.0,
        }
    }

    /// Every tier, for round-trip tests and exhaustive validation.
    pub fn all() -> [DecisionModelTier; 3] {
        [
            DecisionModelTier::SurfaceSkim,
            DecisionModelTier::MediumAnalysis,
            DecisionModelTier::DeepFoundational,
        ]
    }
}

/// One normalized ranking term.
///
/// `available: false` means the term's input signal was absent and `value` is a
/// documented neutral placeholder, not a measurement. `defaulted: true` means a
/// deterministic local stand-in supplied the value (for example a per-item-type
/// default complexity because no decision model was reachable).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermValue {
    pub value: f64,
    pub available: bool,
    pub defaulted: bool,
}

impl TermValue {
    /// A measured value.
    pub fn measured(value: f64) -> Self {
        Self { value: value.clamp(0.0, 1.0), available: true, defaulted: false }
    }

    /// A deterministic local stand-in: a real number, but not a model verdict.
    pub fn defaulted(value: f64) -> Self {
        Self { value: value.clamp(0.0, 1.0), available: true, defaulted: true }
    }

    /// No input signal was available. `value` is the documented neutral term and
    /// MUST NOT be presented as measured.
    pub fn unavailable() -> Self {
        Self { value: 0.0, available: false, defaulted: false }
    }

    /// The value as it enters the score. An unavailable term contributes its
    /// neutral value, which is what makes degradation additive rather than
    /// silently changing the ranking.
    pub fn effective(&self) -> f64 {
        self.value.clamp(0.0, 1.0)
    }
}

/// The five terms behind `S(i)`, with the weight each was applied under.
///
/// The weight is recorded rather than recomputed so a breakdown can explain a
/// score that a later knob change would no longer reproduce.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermBreakdown {
    /// `w_srs · R_srs(i)`
    pub srs_urgency: TermValue,
    pub srs_weight: f64,
    /// `w_goal · M_relevance(i)`
    pub goal_relevance: TermValue,
    pub goal_weight: f64,
    /// `w_fit · M_energy_fit(i, K_energy)`
    pub energy_fit: TermValue,
    pub energy_weight: f64,
    /// `P_interleave(i, H_recent)` — subtracted, never weighted.
    pub interleave_penalty: TermValue,
    pub interleave_weight: f64,
    /// `P_friction(i)` — subtracted, never weighted.
    pub friction_penalty: TermValue,
    pub friction_weight: f64,
    /// The energy target actually used. Differs from `knobs.energy_target` when
    /// fatigue lowered it; `energy_downshift_reason` explains the difference.
    pub effective_energy_target: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub energy_downshift_reason: Option<String>,
    /// Ids of the recent-session items the interleave penalty was measured
    /// against. Empty when the penalty is zero.
    pub interleave_against: Vec<String>,
}

impl TermBreakdown {
    /// Reassemble `S(i)` from the recorded terms. This is the single definition
    /// of the composite formula; `ranker` calls it and nothing else computes a
    /// score.
    pub fn score(&self) -> f64 {
        self.srs_urgency.effective() * self.srs_weight
            + self.goal_relevance.effective() * self.goal_weight
            + self.energy_fit.effective() * self.energy_weight
            - self.interleave_penalty.effective() * self.interleave_weight
            - self.friction_penalty.effective() * self.friction_weight
    }

    /// Whether this particular score is driven by spaced repetition alone.
    ///
    /// This asks about the *terms*, not the weights: a penalty carrying weight
    /// `0.2` but a neutral (unavailable, hence zero) value contributes nothing,
    /// so the score is SRS-only even though the knob is turned up. This is the
    /// condition the fallback-equality requirement is stated over, and it is why
    /// `DaqeKnobs::is_srs_only` — a question about the knob configuration —
    /// is a separate, stricter check.
    pub fn is_srs_only(&self) -> bool {
        self.srs_weight != 0.0
            && self.goal_relevance.effective() == 0.0
            && self.energy_fit.effective() == 0.0
            && self.interleave_penalty.effective() == 0.0
            && self.friction_penalty.effective() == 0.0
    }
}

/// A candidate paired with its score and the terms that produced it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedItem {
    pub item: crate::models::queue::QueueItem,
    pub score: f64,
    pub breakdown: TermBreakdown,
    /// The item's position in the incoming pool, used as the first tie-breaker.
    /// Keeping the input order alongside the score is what makes two ranks of an
    /// unchanged pool byte-identical.
    pub input_index: usize,
}

/// The published result of one ranking pass.
///
/// The snapshot is the unit the queue reads: it carries both the full order and
/// the top ten, because only the top ten is ever covered by the latency budget.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot {
    pub id: String,
    pub collection_id: Option<String>,
    pub profile: String,
    pub knobs: DaqeKnobs,
    pub ranked: Vec<RankedItem>,
    pub top10: Vec<RankedItem>,
    pub computed_at: DateTime<Utc>,
}

impl QueueSnapshot {
    /// The signature a stored snapshot must match to be reused for a given knob
    /// set. Two snapshots with the same signature are interchangeable.
    pub fn knobs_signature(&self) -> String {
        serde_json::to_string(&self.knobs).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_queue_mode_presets_table() {
        let k = DaqeKnobs::default();
        assert_eq!(k.srs_decay_weight, 0.40);
        assert_eq!(k.goal_relevance, 0.30);
        assert_eq!(k.energy_target, 3);
        assert_eq!(k.interleaving_diversity, 0.20);
        assert_eq!(k.pruning_aggressiveness, 0.10);
        assert_eq!(k.afk_idle_timeout_ms, 45_000);
        assert!(
            k.validated().is_ok(),
            "documented defaults must satisfy the schema"
        );
    }

    #[test]
    fn tiers_map_onto_the_shared_one_to_five_complexity_scale() {
        assert_eq!(DecisionModelTier::SurfaceSkim.complexity(), 1.0);
        assert_eq!(DecisionModelTier::MediumAnalysis.complexity(), 3.0);
        assert_eq!(DecisionModelTier::DeepFoundational.complexity(), 5.0);
        for tier in DecisionModelTier::all() {
            assert!(
                (COMPLEXITY_SCALE_MIN..=COMPLEXITY_SCALE_MAX)
                    .contains(&tier.complexity()),
                "{tier:?} must sit on the energy target's own scale"
            );
        }
    }

    #[test]
    fn tier_round_trips_through_its_stored_string() {
        for tier in DecisionModelTier::all() {
            assert_eq!(DecisionModelTier::from_str(tier.as_str()), Some(tier));
        }
        assert_eq!(DecisionModelTier::from_str("skim"), None);
    }

    #[test]
    fn knobs_round_trip_through_serde_as_camel_case() {
        let knobs = DaqeKnobs::default();
        let json = serde_json::to_value(&knobs).expect("serialise");
        for field in [
            "srsDecayWeight",
            "goalRelevance",
            "energyTarget",
            "interleavingDiversity",
            "pruningAggressiveness",
            "afkIdleTimeoutMs",
        ] {
            assert!(json.get(field).is_some(), "missing {field}");
        }
        let back: DaqeKnobs = serde_json::from_value(json).expect("deserialise");
        assert_eq!(back, knobs);
    }

    #[test]
    fn validation_rejects_each_knob_outside_its_range_without_mutating() {
        let base = DaqeKnobs::default();

        let bad_weight = DaqeKnobs { srs_decay_weight: 1.4, ..base };
        assert!(bad_weight.validated().unwrap_err().contains("srsDecayWeight"));

        let bad_goal = DaqeKnobs { goal_relevance: -0.1, ..base };
        assert!(bad_goal.validated().is_err());

        let bad_interleave = DaqeKnobs { interleaving_diversity: 2.0, ..base };
        assert!(bad_interleave.validated().is_err());

        let bad_prune = DaqeKnobs { pruning_aggressiveness: f64::NAN, ..base };
        assert!(bad_prune.validated().is_err(), "NaN must not pass a range check");

        let bad_energy = DaqeKnobs { energy_target: 6, ..base };
        assert!(bad_energy.validated().unwrap_err().contains("energyTarget"));

        let low_afk = DaqeKnobs { afk_idle_timeout_ms: 14_999, ..base };
        assert!(low_afk.validated().unwrap_err().contains("afkIdleTimeoutMs"));

        let high_afk = DaqeKnobs { afk_idle_timeout_ms: 120_001, ..base };
        assert!(high_afk.validated().is_err());

        // Boundary values are accepted.
        assert!(DaqeKnobs { energy_target: 1, ..base }.validated().is_ok());
        assert!(DaqeKnobs { energy_target: 5, ..base }.validated().is_ok());
        assert!(DaqeKnobs { afk_idle_timeout_ms: 15_000, ..base }.validated().is_ok());
        assert!(DaqeKnobs { afk_idle_timeout_ms: 120_000, ..base }.validated().is_ok());
        assert!(DaqeKnobs { srs_decay_weight: 0.0, ..base }.validated().is_ok());
        assert!(DaqeKnobs { srs_decay_weight: 1.0, ..base }.validated().is_ok());
    }

    #[test]
    fn srs_only_knobs_ignore_the_energy_target() {
        let srs_only = DaqeKnobs { srs_decay_weight: 0.5, ..DaqeKnobs::default() };
        assert!(!srs_only.is_srs_only(), "other knobs are still non-zero");
        let bare = DaqeKnobs {
            srs_decay_weight: 0.5,
            goal_relevance: 0.0,
            energy_target: 5,
            interleaving_diversity: 0.0,
            pruning_aggressiveness: 0.0,
            afk_idle_timeout_ms: 45_000,
        };
        assert!(bare.is_srs_only());
    }

    #[test]
    fn term_value_distinguishes_measured_defaulted_and_unavailable() {
        let measured = TermValue::measured(0.8);
        assert!(measured.available && !measured.defaulted);
        assert_eq!(measured.effective(), 0.8);

        let defaulted = TermValue::defaulted(0.4);
        assert!(defaulted.available && defaulted.defaulted);

        let unavailable = TermValue::unavailable();
        assert!(!unavailable.available);
        assert!(!unavailable.defaulted);
        assert_eq!(unavailable.effective(), 0.0);
    }

    #[test]
    fn term_values_clamp_on_construction_rather_than_rejecting() {
        // Validation of *model* output happens at the provider boundary (reject,
        // don't clamp). A TermValue is already trusted, so it clamps defensively.
        assert_eq!(TermValue::measured(1.7).value, 1.0);
        assert_eq!(TermValue::measured(-0.2).value, 0.0);
    }

    #[test]
    fn breakdown_reassembles_the_specified_composite_formula() {
        let breakdown = TermBreakdown {
            srs_urgency: TermValue::measured(0.9),
            srs_weight: 0.40,
            goal_relevance: TermValue::measured(0.5),
            goal_weight: 0.30,
            energy_fit: TermValue::measured(1.0),
            energy_weight: 0.40,
            interleave_penalty: TermValue::measured(0.25),
            interleave_weight: 0.20,
            friction_penalty: TermValue::measured(0.10),
            friction_weight: 0.10,
            effective_energy_target: 4.0,
            energy_downshift_reason: None,
            interleave_against: vec!["item-9".to_string()],
        };

        let expected = 0.40 * 0.9 + 0.30 * 0.5 + 0.40 * 1.0 - 0.20 * 0.25 - 0.10 * 0.10;
        assert!((breakdown.score() - expected).abs() < 1e-12);
        assert!(!breakdown.is_srs_only());
    }

    #[test]
    fn penalties_subtract_even_when_unavailable() {
        let base = TermBreakdown {
            srs_urgency: TermValue::measured(0.5),
            srs_weight: 1.0,
            goal_relevance: TermValue::unavailable(),
            goal_weight: 0.0,
            energy_fit: TermValue::unavailable(),
            energy_weight: 0.0,
            interleave_penalty: TermValue::unavailable(),
            interleave_weight: 0.2,
            friction_penalty: TermValue::unavailable(),
            friction_weight: 0.1,
            effective_energy_target: 3.0,
            energy_downshift_reason: None,
            interleave_against: Vec::new(),
        };

        // Unavailable terms contribute their neutral value, so the score is
        // exactly the SRS term.
        assert!((base.score() - 0.5).abs() < 1e-12);
        assert!(base.is_srs_only());
    }

    #[test]
    fn energy_downshift_reason_is_omitted_when_absent() {
        let with_reason = EnergyDownshiftFixture::build(Some("velocity below 40% of baseline"));
        let without = EnergyDownshiftFixture::build(None);
        assert!(serde_json::to_value(&with_reason)
            .expect("serialise")
            .get("energyDownshiftReason")
            .is_some());
        assert!(serde_json::to_value(&without)
            .expect("serialise")
            .get("energyDownshiftReason")
            .is_none());
    }

    struct EnergyDownshiftFixture;

    impl EnergyDownshiftFixture {
        fn build(reason: Option<&str>) -> TermBreakdown {
            TermBreakdown {
                srs_urgency: TermValue::measured(0.5),
                srs_weight: 0.4,
                goal_relevance: TermValue::measured(0.5),
                goal_weight: 0.3,
                energy_fit: TermValue::measured(0.5),
                energy_weight: 0.4,
                interleave_penalty: TermValue::measured(0.0),
                interleave_weight: 0.2,
                friction_penalty: TermValue::measured(0.0),
                friction_weight: 0.1,
                effective_energy_target: 2.0,
                energy_downshift_reason: reason.map(str::to_string),
                interleave_against: Vec::new(),
            }
        }
    }
}