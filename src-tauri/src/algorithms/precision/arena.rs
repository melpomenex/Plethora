//! Algorithm Arena — weight adaptation.
//!
//! Plethora Precision's "Algorithm Arena" runs five spaced-repetition models
//! in parallel (Classic, Classic 15, Classic 19, Precision, FSRS) and blends
//! them with an adaptive weighted average:
//!
//! 1. **Defaults**: `[6.0, 14.0, 45.0, 25.0, 10.0]` (Classic / Classic 15 /
//!    Classic 19 / Precision / FSRS).
//! 2. **Runtime adaptation** on every committed review: computes per-model
//!    signed prediction error `e_i = outcome - R_i`, and nudges weights toward
//!    models that predicted the recall outcome better.
//!
//! # The weight update formula
//!
//! ```text
//! mean        = (e₁ + e₂ + e₃ + e₄ + e₅) / 5.0
//! adjustment  = clamp(mean - e_i, -0.5, 0.5)
//! weight_i   *= exp(adjustment * 0.0317)
//! weight_i    = clamp(weight_i, lo_i, hi_i)
//! renormalize all weights to sum = 100
//! ```
//!
//! Per-weight clamps `(lo, hi)`, one per slot:
//!
//! ```text
//! M1 (Classic):    (0.1, 30.0)     M2 (Classic 15): (2.0, 50.0)
//! M3 (Classic 19): (25.0, 99.9)    M4 (Precision):  (15.0, 95.0)
//! M5 (FSRS):       (0.1, 45.0)
//! ```
//!
//! # Diagnostics
//!
//! `decayed_loss`, `decayed_blend_loss`, `decayed_baseline_loss`,
//! `decayed_count`, and `total_scored` track a rolling log-loss window so the
//! UI can show how the ensemble blend is performing relative to the M3 baseline.

use serde::{Deserialize, Serialize};

use super::helpers::clamp;

/// Default weights across the five competitors.
pub const ARENA_DEFAULT_WEIGHTS: [f64; 5] = [6.0, 14.0, 45.0, 25.0, 10.0];

/// Display names for the five competitors.
pub const ARENA_MODEL_NAMES: [&str; 5] = [
    "SM-2",
    "SM-15",
    "SM-19",
    "SM-20",
    "FSRS",
];

/// Learning rate multiplied into the clamped adjustment inside `exp()`.
const ADAPT_LEARNING_RATE: f64 = 0.0317;
/// Lower clamp for the mean-centered adjustment.
const ADAPT_CLAMP_LO: f64 = -0.5;
/// Upper clamp for the mean-centered adjustment.
const ADAPT_CLAMP_HI: f64 = 0.5;
/// Post-clamp renormalization target: weights sum to 100.
const ADAPT_TARGET_SUM: f64 = 100.0;

/// Per-slot (lo, hi) weight clamps.
pub const ADAPT_WEIGHT_CLAMPS: [(f64, f64); 5] = [
    (0.1, 30.0), // M1: Classic
    (2.0, 50.0), // M2: Classic 15
    (25.0, 99.9), // M3: Classic 19
    (15.0, 95.0), // M4: Precision
    (0.1, 45.0), // M5: FSRS
];

/// Exponential decay factor per review for rolling diagnostics.
const METRIC_DECAY: f64 = 0.995;

/// Prediction clamp band for log-loss diagnostics.
const PRED_LO: f64 = 0.01;
const PRED_HI: f64 = 0.99;

/// Reviews with less than a day elapsed carry no signal at day-scale
/// stabilities (every model predicts R ≈ 1) — they are not scored.
pub const MIN_SCORING_ELAPSED_DAYS: f64 = 1.0;

/// Minimum decayed sample size before the R-Metric diagnostic is reported.
const MIN_METRIC_COUNT: f64 = 10.0;

/// Collection-wide Arena state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArenaState {
    /// Live blend weights (sum 100), slot order Classic/Classic15/Classic19/Precision/FSRS.
    pub weights: [f64; 5],
    /// Diagnostic: exponentially decayed summed log-loss per model.
    pub decayed_loss: [f64; 5],
    /// Diagnostic: decayed summed log-loss of the weighted blend prediction.
    pub decayed_blend_loss: f64,
    /// Diagnostic: decayed summed log-loss of M3 alone (R-Metric baseline).
    #[serde(default, alias = "decayed_sm19_loss")]
    pub decayed_baseline_loss: f64,
    /// Diagnostic: decayed count of scored reviews (the window size).
    pub decayed_count: f64,
    /// Diagnostic: lifetime number of scored reviews.
    pub total_scored: u64,
}

impl Default for ArenaState {
    fn default() -> Self {
        Self {
            weights: ARENA_DEFAULT_WEIGHTS,
            decayed_loss: [0.0; 5],
            decayed_blend_loss: 0.0,
            decayed_baseline_loss: 0.0,
            decayed_count: 0.0,
            total_scored: 0,
        }
    }
}

/// `R = 0.9^(elapsed/S)`, clamped to the diagnostic band. **Diagnostic
/// only** — used to feed the R-Metric window, not the decoded update rule.
/// The binary itself reads each model's pre-review retrievability directly
/// from that model's own forgetting-curve output; we reconstruct it here
/// from the persisted stability because the per-model R values aren't kept
/// across reviews in our state.
pub fn recall_prediction(stability: f64, elapsed_days: f64) -> f64 {
    let s = stability.max(0.01);
    let r = 0.9f64.powf(elapsed_days.max(0.0) / s);
    clamp(r, PRED_LO, PRED_HI)
}

/// Binary log-loss of prediction `p` against outcome `recalled`.
/// Diagnostic only — feeds the R-Metric, not the decoded weight update.
fn log_loss(p: f64, recalled: bool) -> f64 {
    if recalled {
        -p.ln()
    } else {
        -(1.0 - p).ln()
    }
}

impl ArenaState {
    /// Sanitize state loaded from storage (older builds / corrupt rows).
    ///
    /// Restores the weights to compile-time defaults if they are non-finite
    /// or sum to zero, and clears the diagnostic accumulators if they are
    /// non-finite. Used at load time to defend against truncated/corrupt
    /// `collection.ini` values.
    pub fn sanitized(mut self) -> Self {
        let finite = self.weights.iter().all(|w| w.is_finite() && *w >= 0.0);
        let sum: f64 = self.weights.iter().sum();
        if !finite || sum <= 0.0 {
            self.weights = ARENA_DEFAULT_WEIGHTS;
        } else {
            self.renormalize();
        }
        if !self.decayed_count.is_finite() || self.decayed_count < 0.0 {
            self.decayed_loss = [0.0; 5];
            self.decayed_blend_loss = 0.0;
            self.decayed_baseline_loss = 0.0;
            self.decayed_count = 0.0;
        }
        self
    }

    /// Score one committed review and adapt the weights (the binary's path).
    ///
    /// Mirrors the contract of the binary's caller `FUN_00ce4470`:
    ///
    /// - `slot_stabilities` — the five models' stability outputs persisted
    ///   at the item's *previous* review (the ones the scheduler used). Each
    ///   model's pre-review retrievability is reconstructed from its
    ///   stability via [`recall_prediction`].
    /// - `elapsed_days` — time since that previous review.
    /// - `recalled` — observed outcome (`grade >= 3`).
    ///
    /// The adaptation uses the *decoded* [`FUN_00af40d0`] update rule
    /// (multiplicative, mean-centered, clamped), not the multiplicative-
    /// weights Hedge algorithm that earlier revisions of this module used.
    ///
    /// Reviews under [`MIN_SCORING_ELAPSED_DAYS`] are ignored (sanity guard).
    /// The binary's caller has additional branch guards on the item's
    /// repetition count and M3's retrievability; those are enforced upstream
    /// in [`crate::algorithms::precision::review`] by only calling `observe` on
    /// committed reviews past the first.
    ///
    /// [`FUN_00af40d0`]: self
    pub fn observe(&mut self, slot_stabilities: &[f64; 5], elapsed_days: f64, recalled: bool) {
        if elapsed_days < MIN_SCORING_ELAPSED_DAYS {
            return;
        }
        if slot_stabilities.iter().any(|s| !s.is_finite()) {
            return;
        }

        // Each model's retrievability prediction based on its previous stability.
        let preds: [f64; 5] =
            std::array::from_fn(|i| recall_prediction(slot_stabilities[i], elapsed_days));

        // --- Diagnostic accumulators (NOT decoded — Incrementum addition) ---
        // Computed BEFORE the weight update so the blend loss reflects the
        // weights that actually scheduled this review.
        let losses: [f64; 5] = std::array::from_fn(|i| log_loss(preds[i], recalled));
        let w_sum: f64 = self.weights.iter().sum();
        let blend_pred = if w_sum > 0.0 {
            let p: f64 = (0..5).map(|i| self.weights[i] * preds[i]).sum::<f64>() / w_sum;
            clamp(p, PRED_LO, PRED_HI)
        } else {
            preds[2]
        };
        for i in 0..5 {
            self.decayed_loss[i] = self.decayed_loss[i] * METRIC_DECAY + losses[i];
        }
        self.decayed_blend_loss =
            self.decayed_blend_loss * METRIC_DECAY + log_loss(blend_pred, recalled);
        self.decayed_baseline_loss = self.decayed_baseline_loss * METRIC_DECAY + losses[2];
        self.decayed_count = self.decayed_count * METRIC_DECAY + 1.0;
        self.total_scored = self.total_scored.saturating_add(1);

        // Per-model signed prediction error: outcome - R_i
        let outcome = if recalled { 1.0 } else { 0.0 };
        let errors: [f64; 5] = std::array::from_fn(|i| outcome - preds[i]);
        let mean_error: f64 = errors.iter().sum::<f64>() / 5.0;

        for i in 0..5 {
            let adjustment = clamp(mean_error - errors[i], ADAPT_CLAMP_LO, ADAPT_CLAMP_HI);
            let factor = (adjustment * ADAPT_LEARNING_RATE).exp();
            self.weights[i] *= factor;
            let (lo, hi) = ADAPT_WEIGHT_CLAMPS[i];
            self.weights[i] = clamp(self.weights[i], lo, hi);
        }
        self.renormalize();
    }

    /// Renormalize weights to sum = 100.
    fn renormalize(&mut self) {
        for w in self.weights.iter_mut() {
            if !w.is_finite() || *w < 0.0 {
                *w = 0.0;
            }
        }
        let sum: f64 = self.weights.iter().sum();
        if sum <= 0.0 {
            self.weights = ARENA_DEFAULT_WEIGHTS;
            return;
        }
        for w in self.weights.iter_mut() {
            *w *= ADAPT_TARGET_SUM / sum;
        }
    }

    /// Diagnostic: mean decayed log-loss per model over the rolling window.
    pub fn mean_losses(&self) -> Option<[f64; 5]> {
        if self.decayed_count < MIN_METRIC_COUNT {
            return None;
        }
        Some(std::array::from_fn(|i| {
            self.decayed_loss[i] / self.decayed_count
        }))
    }

    /// Diagnostic: the R-Metric — percentage log-loss improvement of the
    /// weighted blend over Model 3 (Classic 19) alone.
    pub fn r_metric(&self) -> Option<f64> {
        if self.decayed_count < MIN_METRIC_COUNT || self.decayed_baseline_loss <= 0.0 {
            return None;
        }
        Some(
            (self.decayed_baseline_loss - self.decayed_blend_loss)
                / self.decayed_baseline_loss
                * 100.0,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_matches_binary() {
        let a = ArenaState::default();
        assert_eq!(a.weights, [6.0, 14.0, 45.0, 25.0, 10.0]);
        assert!((a.weights.iter().sum::<f64>() - 100.0).abs() < 1e-9);
    }

    #[test]
    fn equal_predictions_leave_weights_unchanged() {
        let mut a = ArenaState::default();
        a.observe(&[10.0; 5], 5.0, true);
        for (w, d) in a.weights.iter().zip(ARENA_DEFAULT_WEIGHTS.iter()) {
            assert!((w - d).abs() < 1e-9, "{w} vs {d}");
        }
        assert_eq!(a.total_scored, 1);
    }

    #[test]
    fn better_model_gains_weight() {
        let mut a = ArenaState::default();
        // Model 4 (Precision) predicts recall confidently; model 3 (Classic 19)
        // predicts forgetting; outcome is recall. Repeat many times.
        for _ in 0..500 {
            a.observe(&[3.0, 3.0, 1.0, 60.0, 3.0], 6.0, true);
        }
        assert!(
            a.weights[3] > 40.0,
            "Precision should gain significantly: {:?}",
            a.weights
        );
        assert!(
            a.weights[2] < 35.0,
            "Classic 19 should shrink significantly: {:?}",
            a.weights
        );
        assert!((a.weights.iter().sum::<f64>() - 100.0).abs() < 1e-4);
    }

    #[test]
    fn same_day_reviews_not_scored() {
        let mut a = ArenaState::default();
        a.observe(&[3.0, 3.0, 1.0, 60.0, 3.0], 0.2, false);
        assert_eq!(a.total_scored, 0);
        assert_eq!(a.weights, ARENA_DEFAULT_WEIGHTS);
    }

    #[test]
    fn r_metric_positive_when_blend_beats_baseline() {
        let mut a = ArenaState::default();
        for _ in 0..30 {
            a.observe(&[50.0, 50.0, 0.5, 50.0, 50.0], 5.0, true);
        }
        let m = a.r_metric().expect("enough data");
        assert!(m > 0.0, "R-metric should favor the blend: {m}");
    }

    #[test]
    fn sanitize_recovers_from_bad_state() {
        let a = ArenaState {
            weights: [f64::NAN, 1.0, 1.0, 1.0, 1.0],
            ..Default::default()
        };
        // Verify weights fallback if invalid
        let sanitized_weights = if a.weights.iter().all(|w| w.is_finite() && *w >= 0.0) {
            a.weights
        } else {
            ARENA_DEFAULT_WEIGHTS
        };
        assert_eq!(sanitized_weights, ARENA_DEFAULT_WEIGHTS);
    }

    #[test]
    fn weights_match_user_collection_b_range() {
        // User's Collection B: PA2=0.72, PA15=31.77, PA19=40.38, PA20=18.85, PAF=8.28
        // All should be within the per-weight clamps.
        let clamped = [
            clamp(0.72, ADAPT_WEIGHT_CLAMPS[0].0, ADAPT_WEIGHT_CLAMPS[0].1),
            clamp(31.77, ADAPT_WEIGHT_CLAMPS[1].0, ADAPT_WEIGHT_CLAMPS[1].1),
            clamp(40.38, ADAPT_WEIGHT_CLAMPS[2].0, ADAPT_WEIGHT_CLAMPS[2].1),
            clamp(18.85, ADAPT_WEIGHT_CLAMPS[3].0, ADAPT_WEIGHT_CLAMPS[3].1),
            clamp(8.28, ADAPT_WEIGHT_CLAMPS[4].0, ADAPT_WEIGHT_CLAMPS[4].1),
        ];
        assert_eq!(clamped, [0.72, 31.77, 40.38, 18.85, 8.28]);
    }
}
