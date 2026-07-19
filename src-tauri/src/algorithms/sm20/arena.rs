//! Algorithm Arena — adaptive per-user weighting of the five competitors.
//!
//! SuperMemo 20's "Algorithm Arena" runs five spaced-repetition algorithms in
//! parallel (SM-2, SM-15, SM-19, SM-20, FSRS — the binary persists their
//! weights as `[Algorithm] PA2/PA15/PA19/PA20/PAF` with compile-time defaults
//! 6/14/45/25/10) and lets predictive performance on the user's own reviews
//! decide the blend.
//!
//! **Weight update routine:** `FUN_00af40d0` (decompiled from `sm20.exe`).
//! Called from `FUN_00ce4470` which computes per-model prediction errors,
//! then `af40d0` applies a multiplicative update:
//!   `mean_error = sum(errors) / 5`
//!   `adjustment_i = clamp(mean_error - error_i, -0.5, 0.5)`
//!   `factor_i = exp(adjustment_i * 0.0317)`   (learning rate)
//!   `weight_i *= factor_i; clamp(lo_i, hi_i)`
//!   renormalize to sum = 100
//!
//! The R-Metric mirrors SuperMemo's statistic: relative log-loss improvement
//! of the weighted blend over Algorithm SM-19 alone, over an exponentially
//! decayed window.

use serde::{Deserialize, Serialize};

use super::helpers::clamp;

/// Fresh-install weights — the binary's compile-time defaults.
pub const ARENA_DEFAULT_WEIGHTS: [f64; 5] = [6.0, 14.0, 45.0, 25.0, 10.0];

/// The five competitors, in item-struct slot order (+0x73/+0x77/+0x7b/+0x83/+0x8b).
pub const ARENA_MODEL_NAMES: [&str; 5] = ["SM-2", "SM-15", "SM-19", "SM-20", "FSRS"];

// Weight adaptation constants — FUN_00af40d0 [BIN]
/// Learning rate for weight adaptation (0.0317, extracted from `af44c8`).
const ADAPT_LEARNING_RATE: f64 = 0.0317;
/// Clamp for the adjustment term (`af44b8`).
const ADAPT_CLAMP_LO: f64 = -0.5;
/// Clamp for the adjustment term (`af44c0`).
const ADAPT_CLAMP_HI: f64 = 0.5;
/// Target sum after normalization (`af4518`).
const ADAPT_TARGET_SUM: f64 = 100.0;
/// Per-weight clamps (lo, hi) from `af44d0`..`af4510`.
const ADAPT_WEIGHT_CLAMPS: [(f64, f64); 5] = [
    (0.1, 30.0),   // W1/PA2  (M1/SM-2)
    (2.0, 50.0),   // W2/PA15 (M2/SM-15)
    (25.0, 99.9),  // W3/PA19 (M3/SM-19)
    (15.0, 95.0),  // W4/PA20 (M4/SM-20)
    (0.1, 45.0),   // W5/PAF  (M5/FSRS)
];

/// Exponential decay for the R-Metric loss window (half-life ≈ 140 reviews).
const METRIC_DECAY: f64 = 0.995;

/// Predictions are clamped into this band so a single review can contribute
/// at most −ln(0.01) ≈ 4.6 nats of loss.
const PRED_LO: f64 = 0.01;
const PRED_HI: f64 = 0.99;

/// Reviews with less than a day elapsed carry no signal at day-scale
/// stabilities (every model predicts R ≈ 1) — they are not scored.
pub const MIN_SCORING_ELAPSED_DAYS: f64 = 1.0;

/// Minimum decayed sample size before the R-Metric is reported.
const MIN_METRIC_COUNT: f64 = 10.0;

/// Collection-wide Arena state: the live weights plus decayed loss
/// accumulators for the R-Metric.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArenaState {
    /// Live blend weights (sum 100), slot order SM-2/SM-15/SM-19/SM-20/FSRS.
    pub weights: [f64; 5],
    /// Exponentially decayed summed log-loss per model.
    pub decayed_loss: [f64; 5],
    /// Decayed summed log-loss of the weighted blend prediction.
    pub decayed_blend_loss: f64,
    /// Decayed summed log-loss of SM-19 alone (the R-Metric baseline).
    pub decayed_sm19_loss: f64,
    /// Decayed count of scored reviews (the window size).
    pub decayed_count: f64,
    /// Lifetime number of scored reviews.
    pub total_scored: u64,
}

impl Default for ArenaState {
    fn default() -> Self {
        Self {
            weights: ARENA_DEFAULT_WEIGHTS,
            decayed_loss: [0.0; 5],
            decayed_blend_loss: 0.0,
            decayed_sm19_loss: 0.0,
            decayed_count: 0.0,
            total_scored: 0,
        }
    }
}

/// `R = 0.9^(elapsed/S)`, clamped to the scoring band.
pub fn recall_prediction(stability: f64, elapsed_days: f64) -> f64 {
    let s = stability.max(0.01);
    let r = 0.9f64.powf(elapsed_days.max(0.0) / s);
    clamp(r, PRED_LO, PRED_HI)
}

/// Binary log-loss of prediction `p` against outcome `recalled`.
fn log_loss(p: f64, recalled: bool) -> f64 {
    if recalled {
        -p.ln()
    } else {
        -(1.0 - p).ln()
    }
}

impl ArenaState {
    /// Sanitize state loaded from storage (older builds / corrupt rows).
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
            self.decayed_sm19_loss = 0.0;
            self.decayed_count = 0.0;
        }
        self
    }

    /// Score one committed review against every model's previous stability
    /// estimate and update the weights using the binary's `FUN_00af40d0`.
    ///
    /// `slot_stabilities` are the five models' stability outputs persisted at
    /// the item's previous review; `elapsed_days` is the time since then;
    /// `recalled` is the observed outcome (grade ≥ 3). Reviews under
    /// [`MIN_SCORING_ELAPSED_DAYS`] are ignored.
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
        let losses: [f64; 5] = std::array::from_fn(|i| log_loss(preds[i], recalled));

        // Blend prediction with current weights (for R-Metric).
        let w_sum: f64 = self.weights.iter().sum();
        let blend_pred = if w_sum > 0.0 {
            let p: f64 = (0..5).map(|i| self.weights[i] * preds[i]).sum::<f64>() / w_sum;
            clamp(p, PRED_LO, PRED_HI)
        } else {
            preds[2]
        };

        // R-Metric accumulators (decayed window).
        for i in 0..5 {
            self.decayed_loss[i] = self.decayed_loss[i] * METRIC_DECAY + losses[i];
        }
        self.decayed_blend_loss =
            self.decayed_blend_loss * METRIC_DECAY + log_loss(blend_pred, recalled);
        self.decayed_sm19_loss = self.decayed_sm19_loss * METRIC_DECAY + losses[2];
        self.decayed_count = self.decayed_count * METRIC_DECAY + 1.0;
        self.total_scored = self.total_scored.saturating_add(1);

        // Binary's weight adaptation: FUN_00af40d0 [C][BIN]
        // Per-model error = actual_outcome - predicted_retrievability
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

    /// Renormalize weights to sum = 100 (matching the binary's `af4518`).
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

    /// Mean decayed log-loss per model over the metric window, if enough data.
    pub fn mean_losses(&self) -> Option<[f64; 5]> {
        if self.decayed_count < MIN_METRIC_COUNT {
            return None;
        }
        Some(std::array::from_fn(|i| self.decayed_loss[i] / self.decayed_count))
    }

    /// The R-Metric: percentage log-loss improvement of the weighted blend
    /// over Algorithm SM-19 alone. Positive means the Arena beats SM-19.
    pub fn r_metric(&self) -> Option<f64> {
        if self.decayed_count < MIN_METRIC_COUNT || self.decayed_sm19_loss <= 0.0 {
            return None;
        }
        Some(
            (self.decayed_sm19_loss - self.decayed_blend_loss) / self.decayed_sm19_loss * 100.0,
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
        // All models predict identically → equal errors → no weight movement.
        a.observe(&[10.0; 5], 5.0, true);
        for (w, d) in a.weights.iter().zip(ARENA_DEFAULT_WEIGHTS.iter()) {
            assert!((w - d).abs() < 1e-9, "{w} vs {d}");
        }
        assert_eq!(a.total_scored, 1);
    }

    #[test]
    fn better_model_gains_weight() {
        let mut a = ArenaState::default();
        // Model 4 (SM-20) predicts recall confidently; model 3 (SM-19)
        // predicts forgetting; outcome is recall. Repeat many times.
        for _ in 0..500 {
            a.observe(&[3.0, 3.0, 1.0, 60.0, 3.0], 6.0, true);
        }
        assert!(a.weights[3] > 40.0, "SM-20 should gain significantly: {:?}", a.weights);
        assert!(a.weights[2] < 35.0, "SM-19 should shrink significantly: {:?}", a.weights);
        // Sum stays 100
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
    fn r_metric_positive_when_blend_beats_sm19() {
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
        }
        .sanitized();
        assert_eq!(a.weights, ARENA_DEFAULT_WEIGHTS);
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
