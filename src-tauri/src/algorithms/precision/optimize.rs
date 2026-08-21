//! Per-user optimization for the Arena's trainable competitors.
//!
//! - **M4 / Kernel**: fits the 35-double kernel parameter block to
//!   the user's review log by gradient descent (forward-difference Adam) on
//!   binary log-loss, L2-regularized toward the shipped pretrained defaults,
//!   with a held-out validation gate — fitted parameters are only accepted if
//!   they beat the defaults on unseen items.
//! - **M5 / FSRS**: converts the review log into `fsrs-rs` training items so
//!   the crate's own optimizer (`compute_parameters`) can fit
//!   per-user FSRS weights.
//!
//! The prediction target for M4 is the kernel's retrievability proxy `A`
//! (the expert mixture). `A` is not a calibrated probability — Expert 2 grows
//! above 1 for overdue items — so predictions are clamped to [0.01, 0.99];
//! the regularizer and validation gate keep the fit honest.

use super::helpers::clamp;
use super::kernel::{self, expert_mixture_with, init_new_item_with, review_kernel_with};

/// One item's chronological review history as `(elapsed_days, grade 0-5)`.
/// The first review's elapsed must be 0 (it initializes the item).
#[derive(Debug, Clone)]
pub struct RevlogItem {
    pub reviews: Vec<(f64, i32)>,
}

// --- Gates ---------------------------------------------------------------
/// Minimum scorable train/validation predictions before a fit is attempted.
pub const M4_MIN_TRAIN_PREDICTIONS: usize = 320;
pub const M4_MIN_VAL_PREDICTIONS: usize = 80;

// --- Objective / optimizer constants -------------------------------------
const PRED_LO: f64 = 0.01;
const PRED_HI: f64 = 0.99;
/// L2 pull toward the shipped defaults, in normalized parameter space.
/// A full-scale move of one parameter costs 0.01 nats — small against a real
/// per-user signal, large against spurious wiggle. The held-out validation
/// gate below is the hard backstop against overfitting.
const LAMBDA: f64 = 0.01;
/// Parameter step scale: `p_i = p0_i + u_i · scale_i`.
const SCALE_FRAC: f64 = 0.5;
const SCALE_MIN: f64 = 0.05;
/// Sign-preserving magnitude bounds relative to each default.
const MAG_LO: f64 = 0.1;
const MAG_HI: f64 = 5.0;
/// Coordinate-descent step schedule in normalized space: start step, shrink
/// factor, and stop threshold. Monotone (only accepts strict improvements),
/// which is far more robust than gradient methods on this nearly-flat,
/// small-data objective.
const CD_STEP_INIT: f64 = 0.4;
const CD_STEP_SHRINK: f64 = 0.5;
const CD_STEP_MIN: f64 = 0.02;
const CD_MAX_PASSES: usize = 24;
/// Required validation improvement (mean nats) to accept the fit.
const ACCEPT_MARGIN: f64 = 1e-4;

/// Outcome of an M4 optimization run.
#[derive(Debug, Clone, serde::Serialize)]
pub struct M4OptimizeOutcome {
    pub accepted: bool,
    /// The fitted 35-parameter block (present only when accepted).
    pub params: Option<Vec<f64>>,
    pub items: usize,
    pub train_predictions: usize,
    pub val_predictions: usize,
    pub train_loss_before: f64,
    pub train_loss_after: f64,
    pub val_loss_before: f64,
    pub val_loss_after: f64,
    pub iterations: usize,
    pub message: String,
}

/// Replay one item through the kernel at parameters `p`, scoring recall
/// predictions for reviews with ≥ 1 day elapsed. Returns (summed log-loss, n).
fn m4_item_loss(p: &[f64; 35], item: &RevlogItem) -> (f64, usize) {
    if item.reviews.is_empty() {
        return (0.0, 0);
    }
    let (mut s, mut d) = init_new_item_with(p, item.reviews[0].1);
    let mut loss = 0.0;
    let mut n = 0;
    for &(elapsed, grade) in &item.reviews[1..] {
        if elapsed >= 1.0 {
            let pred = clamp(expert_mixture_with(p, elapsed, s, d), PRED_LO, PRED_HI);
            loss += if grade >= 3 {
                -pred.ln()
            } else {
                -(1.0 - pred).ln()
            };
            n += 1;
        }
        let k = review_kernel_with(p, elapsed, grade, d, s);
        s = k.s_new;
        d = k.d_new;
        if !s.is_finite() || !d.is_finite() {
            return (f64::INFINITY, n.max(1));
        }
        s = clamp(s, 0.01, 100_000.0);
    }
    (loss, n)
}

/// Mean log-loss over a dataset. Returns `(mean, n)`; mean is 0 when n = 0.
fn dataset_loss(p: &[f64; 35], items: &[&RevlogItem]) -> (f64, usize) {
    let mut total = 0.0;
    let mut n = 0;
    for item in items {
        let (l, k) = m4_item_loss(p, item);
        total += l;
        n += k;
    }
    if n == 0 {
        (0.0, 0)
    } else {
        (total / n as f64, n)
    }
}

/// Materialize parameters from normalized offsets `u`, sign-preserving and
/// magnitude-bounded around the shipped defaults.
fn params_from_u(u: &[f64; 35]) -> [f64; 35] {
    let mut p = [0.0f64; 35];
    for i in 0..35 {
        let p0 = kernel::P[i];
        let scale = (p0.abs() * SCALE_FRAC).max(SCALE_MIN);
        let raw = p0 + u[i] * scale;
        let (lo, hi) = if p0 >= 0.0 {
            (p0 * MAG_LO, p0 * MAG_HI)
        } else {
            (p0 * MAG_HI, p0 * MAG_LO)
        };
        p[i] = clamp(raw, lo.min(hi), lo.max(hi));
    }
    p
}

/// Fit the M4 parameter block to the user's review log.
pub fn optimize_m4(items: &[RevlogItem]) -> M4OptimizeOutcome {
    // Deterministic 80/20 item split (every 5th item validates).
    let train: Vec<&RevlogItem> = items
        .iter()
        .enumerate()
        .filter(|(i, _)| i % 5 != 4)
        .map(|(_, it)| it)
        .collect();
    let val: Vec<&RevlogItem> = items
        .iter()
        .enumerate()
        .filter(|(i, _)| i % 5 == 4)
        .map(|(_, it)| it)
        .collect();

    let (val_before, val_n) = dataset_loss(&kernel::P, &val);
    let (train_before, train_n) = dataset_loss(&kernel::P, &train);

    if train_n < M4_MIN_TRAIN_PREDICTIONS || val_n < M4_MIN_VAL_PREDICTIONS {
        return M4OptimizeOutcome {
            accepted: false,
            params: None,
            items: items.len(),
            train_predictions: train_n,
            val_predictions: val_n,
            train_loss_before: train_before,
            train_loss_after: train_before,
            val_loss_before: val_before,
            val_loss_after: val_before,
            iterations: 0,
            message: format!(
                "Not enough review history yet: {train_n} train / {val_n} validation predictions \
                 (need {M4_MIN_TRAIN_PREDICTIONS}/{M4_MIN_VAL_PREDICTIONS}). Keep reviewing with \
                 day-scale intervals and try again."
            ),
        };
    }

    // Objective in normalized offset space: mean train loss + L2 pull.
    let objective = |u: &[f64; 35]| -> f64 {
        let p = params_from_u(u);
        let (mean, _) = dataset_loss(&p, &train);
        mean + LAMBDA * u.iter().map(|v| v * v).sum::<f64>()
    };

    // Monotone coordinate descent with a shrinking step schedule: for each
    // parameter try ±step and keep strict improvements; halve the step when a
    // full pass makes no progress.
    let mut u = [0.0f64; 35];
    let mut best_obj = objective(&u);
    let mut step = CD_STEP_INIT;
    let mut iterations = 0usize;

    for _pass in 0..CD_MAX_PASSES {
        iterations += 1;
        let mut improved = false;
        for i in 0..35 {
            for dir in [1.0f64, -1.0] {
                let mut probe = u;
                probe[i] += dir * step;
                let obj = objective(&probe);
                if obj.is_finite() && obj < best_obj - 1e-6 {
                    best_obj = obj;
                    u = probe;
                    improved = true;
                    break;
                }
            }
        }
        if !improved {
            step *= CD_STEP_SHRINK;
            if step < CD_STEP_MIN {
                break;
            }
        }
    }

    let fitted = params_from_u(&u);
    let (train_after, _) = dataset_loss(&fitted, &train);
    let (val_after, _) = dataset_loss(&fitted, &val);
    let accepted = val_after.is_finite() && val_after < val_before - ACCEPT_MARGIN;

    M4OptimizeOutcome {
        accepted,
        params: accepted.then(|| fitted.to_vec()),
        items: items.len(),
        train_predictions: train_n,
        val_predictions: val_n,
        train_loss_before: train_before,
        train_loss_after: train_after,
        val_loss_before: val_before,
        val_loss_after: val_after,
        iterations,
        message: if accepted {
            format!(
                "Accepted: held-out log-loss improved {:.4} → {:.4} nats over {val_n} predictions \
                 (train {:.4} → {:.4}).",
                val_before, val_after, train_before, train_after
            )
        } else {
            format!(
                "Fit did not beat the shipped defaults on held-out data ({:.4} → {:.4}); \
                 keeping defaults.",
                val_before, val_after
            )
        },
    }
}

// =============================================================================
// FSRS (M5) training-data preparation
// =============================================================================

/// Grade (0-5) → FSRS rating (1-4): fails → Again, 3 → Hard, 4 → Good, 5 → Easy.
pub fn grade_to_fsrs_rating(grade: i32) -> u32 {
    match grade {
        g if g < 3 => 1,
        3 => 2,
        4 => 3,
        _ => 4,
    }
}

/// Convert the review log into `fsrs-rs` training items: one `FSRSItem` per
/// review with its full prefix history. Only reviews with ≥ 1 day elapsed
/// become prediction targets (same-day reviews stay in the history prefix).
pub fn build_fsrs_items(items: &[RevlogItem]) -> Vec<fsrs::FSRSItem> {
    let mut out = Vec::new();
    for item in items {
        let reviews: Vec<fsrs::FSRSReview> = item
            .reviews
            .iter()
            .map(|&(elapsed, grade)| fsrs::FSRSReview {
                rating: grade_to_fsrs_rating(grade),
                delta_t: elapsed.round().max(0.0) as u32,
            })
            .collect();
        for i in 1..reviews.len() {
            if reviews[i].delta_t > 0 {
                out.push(fsrs::FSRSItem {
                    reviews: reviews[..=i].to_vec(),
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tiny deterministic PRNG (xorshift64*) — no external entropy in tests.
    struct Rng(u64);
    impl Rng {
        fn next_f64(&mut self) -> f64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            (self.0.wrapping_mul(0x2545F4914F6CDD1D) >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    /// Generate a synthetic revlog from a "true" parameter block: outcomes are
    /// sampled from the kernel's own (clamped) prediction, so the true block
    /// is the log-loss optimum the fitter should move toward.
    fn synthetic_items(
        p_true: &[f64; 35],
        n_items: usize,
        reviews_per_item: usize,
    ) -> Vec<RevlogItem> {
        let mut rng = Rng(0x5EED_CAFE_F00D_1234);
        let mut out = Vec::with_capacity(n_items);
        for _ in 0..n_items {
            let first_grade = if rng.next_f64() < 0.5 { 4 } else { 3 };
            let (mut s, mut d) = init_new_item_with(p_true, first_grade);
            let mut reviews = vec![(0.0, first_grade)];
            for _ in 1..reviews_per_item {
                // Wide elapsed spread (0.3–2.8 × S) so predictions span a broad
                // probability range — mirrors real early/late review mixtures.
                let elapsed = (s * (0.3 + 2.5 * rng.next_f64())).clamp(1.0, 3650.0);
                let pred = clamp(expert_mixture_with(p_true, elapsed, s, d), PRED_LO, PRED_HI);
                let recalled = rng.next_f64() < pred;
                let grade = if recalled {
                    if rng.next_f64() < 0.3 {
                        5
                    } else {
                        4
                    }
                } else {
                    1
                };
                reviews.push((elapsed, grade));
                let k = review_kernel_with(p_true, elapsed, grade, d, s);
                s = clamp(k.s_new, 0.01, 100_000.0);
                d = k.d_new;
            }
            out.push(RevlogItem { reviews });
        }
        out
    }

    #[test]
    fn optimizer_gates_on_small_data() {
        let items = synthetic_items(&kernel::P, 4, 4);
        let out = optimize_m4(&items);
        assert!(!out.accepted);
        assert!(out.params.is_none());
        assert!(out.message.contains("Not enough review history"));
    }

    #[test]
    fn optimizer_recovers_shifted_parameters() {
        // Ground truth: a strong, clearly identifiable deviation — the user
        // forgets much faster than the pretrained average (expert-1 base well
        // below default shifts every recall prediction down).
        let mut p_true = kernel::P;
        p_true[0] *= 0.75; // expert-1 power-law base → much lower recall
        p_true[19] *= 0.5; // lapse base scale
        let items = synthetic_items(&p_true, 200, 8);

        let out = optimize_m4(&items);
        assert!(
            out.train_predictions >= M4_MIN_TRAIN_PREDICTIONS,
            "synthetic set too small: {}",
            out.train_predictions
        );
        assert!(
            out.accepted,
            "expected fit acceptance; val {:.4} -> {:.4} ({})",
            out.val_loss_before, out.val_loss_after, out.message
        );
        assert!(out.val_loss_after < out.val_loss_before);
        assert!(out.train_loss_after < out.train_loss_before);
        let params = out.params.expect("accepted fit carries params");
        assert_eq!(params.len(), 35);
        assert!(params.iter().all(|v| v.is_finite()));
        // The fitted expert-1 base must have moved toward the true (lower) value.
        assert!(
            params[0] < kernel::P[0] - 1e-3,
            "expected p[0] to drop toward truth: fitted {} vs default {}",
            params[0],
            kernel::P[0]
        );
    }

    #[test]
    fn optimizer_rejects_when_defaults_are_optimal() {
        // Outcomes generated from the shipped defaults: any "improvement" the
        // fitter finds on train is spurious, and the held-out gate must
        // refuse to replace the defaults.
        let items = synthetic_items(&kernel::P, 200, 8);
        let out = optimize_m4(&items);
        assert!(
            !out.accepted,
            "null-signal fit must be rejected; val {:.4} -> {:.4}",
            out.val_loss_before, out.val_loss_after
        );
        assert!(out.params.is_none());
    }

    #[test]
    fn fsrs_items_built_with_prefix_histories() {
        let items = vec![RevlogItem {
            reviews: vec![(0.0, 4), (0.4, 1), (3.0, 4), (10.0, 5)],
        }];
        let built = build_fsrs_items(&items);
        // Targets: reviews at 3.0d and 10.0d (the 0.4d same-day review is
        // history only). Prefixes include everything before them.
        assert_eq!(built.len(), 2);
        assert_eq!(built[0].reviews.len(), 3);
        assert_eq!(built[1].reviews.len(), 4);
        assert_eq!(built[0].reviews[0].delta_t, 0);
        assert_eq!(built[0].reviews[2].rating, 3); // grade 4 → Good
        assert_eq!(built[1].reviews[3].rating, 4); // grade 5 → Easy
    }
}
