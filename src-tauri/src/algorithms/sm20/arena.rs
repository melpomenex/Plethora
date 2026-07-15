//! Algorithm Arena — adaptive per-user weighting of the five competitors.
//!
//! SuperMemo 20's "Algorithm Arena" runs five spaced-repetition algorithms in
//! parallel (SM-2, SM-15, SM-19, SM-20, FSRS — the binary persists their
//! weights as `[Algorithm] PA2/PA15/PA19/PA20/PAF` with compile-time defaults
//! 6/14/45/25/10) and lets predictive performance on the user's own reviews
//! decide the blend. The binary's weight-update routine was never decompiled,
//! so this module implements a principled equivalent: the multiplicative
//! weights (Hedge) algorithm over per-review log-loss, with a per-model floor
//! so no competitor is ever permanently eliminated.
//!
//! Scoring: at each committed review with elapsed ≥ 1 day, every model's
//! stability estimate from the *previous* review implies a recall prediction
//! `R_i = 0.9^(elapsed / S_i)`. The observed outcome (grade ≥ 3) scores each
//! model with binary log-loss. Weights then update `w_i ∝ w_i·exp(−η·loss_i)`
//! and renormalize to 100.
//!
//! The R-Metric mirrors SuperMemo's statistic: relative log-loss improvement
//! of the weighted blend over Algorithm SM-19 alone, over an exponentially
//! decayed window.

use serde::{Deserialize, Serialize};

use super::helpers::clamp;

/// Fresh-install weights — the binary's compile-time defaults at
/// `DAT_00d81ab8` (keys PA2/PA15/PA19/PA20/PAF).
pub const ARENA_DEFAULT_WEIGHTS: [f64; 5] = [6.0, 14.0, 45.0, 25.0, 10.0];

/// The five competitors, in item-struct slot order (+0x73/+0x77/+0x7b/+0x83/+0x8b).
pub const ARENA_MODEL_NAMES: [&str; 5] = ["SM-2", "SM-15", "SM-19", "SM-20", "FSRS"];

/// Hedge learning rate. With typical per-review loss spreads of ~0.1 nats this
/// moves the balance meaningfully over 100-200 reviews — the adaptation pace
/// SuperMemo documents for the Arena.
const ETA: f64 = 0.12;

/// Minimum weight per model (out of 100) — no competitor is eliminated, so a
/// model that starts badly can recover (e.g. SM-20/FSRS after optimization).
const FLOOR: f64 = 2.0;

/// Weights always sum to this (matching the binary's percentage convention).
const WEIGHT_SUM: f64 = 100.0;

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
            self.normalize_weights();
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
    /// estimate and update the weights.
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

        let preds: [f64; 5] =
            std::array::from_fn(|i| recall_prediction(slot_stabilities[i], elapsed_days));
        let losses: [f64; 5] = std::array::from_fn(|i| log_loss(preds[i], recalled));

        // Blend prediction with the CURRENT (pre-update) weights — the same
        // weights that scheduled with these slots.
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

        // Hedge update. Subtracting the mean loss before exponentiation is a
        // no-op after normalization but keeps the exponents small.
        let mean_loss = losses.iter().sum::<f64>() / 5.0;
        for i in 0..5 {
            self.weights[i] *= (-ETA * (losses[i] - mean_loss)).exp();
        }
        self.normalize_weights();
    }

    /// Normalize to sum 100 with a per-model floor.
    fn normalize_weights(&mut self) {
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
            *w *= WEIGHT_SUM / sum;
        }
        // Waterfall the floor: pin any weight below FLOOR and rescale the
        // rest so the total stays WEIGHT_SUM. At most 5 passes.
        for _ in 0..5 {
            let mut pinned = 0.0;
            let mut free = 0.0;
            for w in self.weights.iter() {
                if *w <= FLOOR {
                    pinned += FLOOR;
                } else {
                    free += *w;
                }
            }
            if free <= 0.0 {
                self.weights = [WEIGHT_SUM / 5.0; 5];
                return;
            }
            let scale = (WEIGHT_SUM - pinned) / free;
            let mut changed = false;
            for w in self.weights.iter_mut() {
                if *w <= FLOOR {
                    *w = FLOOR;
                } else {
                    let next = *w * scale;
                    if next < FLOOR {
                        changed = true;
                    }
                    *w = next;
                }
            }
            if !changed {
                break;
            }
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
    fn equal_losses_leave_weights_unchanged() {
        let mut a = ArenaState::default();
        // All models predict identically → equal losses → no weight movement.
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
        // predicts forgetting; outcome is recall. Repeat.
        for _ in 0..150 {
            a.observe(&[3.0, 3.0, 1.0, 60.0, 3.0], 6.0, true);
        }
        assert!(a.weights[3] > 40.0, "SM-20 should dominate: {:?}", a.weights);
        assert!(a.weights[2] <= 10.0, "SM-19 should shrink: {:?}", a.weights);
        // Sum stays 100, floor respected.
        assert!((a.weights.iter().sum::<f64>() - 100.0).abs() < 1e-6);
        assert!(a.weights.iter().all(|w| *w >= FLOOR - 1e-9));
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
            // SM-19 badly wrong (predicts forget, outcome recall), others right.
            a.observe(&[50.0, 50.0, 0.5, 50.0, 50.0], 5.0, true);
        }
        let m = a.r_metric().expect("enough data");
        assert!(m > 0.0, "R-metric should favor the blend: {m}");
        let losses = a.mean_losses().expect("enough data");
        assert!(losses[2] > losses[3]);
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
}
