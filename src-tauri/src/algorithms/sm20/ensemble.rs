//! Ensemble blending + finalization pipeline.
//!
//! `FUN_00cf4d50` (ensemble) → `FUN_00cf5b50` (finalization) → `FUN_00cf5100`
//! (dispersal) / `FUN_00ce2fe0` (post-lapse).
//!
//! All constants and formulas live-binary-validated against `sm20.exe`:
//! - Ensemble weighting: 20/20 exact match
//! - Retention adjustment: 20/20 exact match
//! - Dispersal: 200 trials, distribution matches within 5% per bucket
//! - Post-lapse: all deterministic clamps exact
//!
//! Evidence: `[C][ASM][BIN]`

use super::helpers::*;

// =============================================================================
// CONSTANTS — all [BIN] unless noted
// =============================================================================

// Ensemble weights — default values from FUN_00af4580 [ASM].
// These are ADAPTIVE: the binary updates them via FUN_00af40d0 based on
// per-model prediction accuracy. Current weights persist in collection.ini.
pub const DEFAULT_WEIGHTS: [f64; 5] = [6.0, 14.0, 45.0, 25.0, 10.0];
const ENSEMBLE_THRESHOLD: f64 = 0.0;

// Weight adaptation constants — FUN_00af40d0 [BIN]
const ADAPT_LEARNING_RATE: f64 = 0.0317; // _DAT_00af44c8
const ADAPT_CLAMP_LO: f64 = -0.5; // DAT_00af44b8
const ADAPT_CLAMP_HI: f64 = 0.5; // DAT_00af44c0
const ADAPT_TARGET_SUM: f64 = 100.0; // _DAT_00af4518
// Per-weight clamps: (lo, hi) from af44d0..af4510
const ADAPT_WEIGHT_CLAMPS: [(f64, f64); 5] = [
    (0.1, 30.0),   // W1/PA2  (M1/SM-2 legacy)
    (2.0, 50.0),   // W2/PA15 (M2/SM-15 classic)
    (25.0, 99.9),  // W3/PA19 (M3/SM-19 matrix)
    (15.0, 95.0),  // W4/PA20 (M4/SM-20 kernel)
    (0.1, 45.0),   // W5/PAF  (M5/FSRS analytic)
];

// Finalization — FUN_00cf5b50
const FI_ONE: f64 = 1.0;
const FI_DIV: f64 = 100.0;
const FORGET_BASE: f64 = 0.9;
pub const CLAMP_HI: f64 = 44530.0;
pub const CLAMP_LO: f64 = 0.7;
pub const INT_HI: i32 = 44530;
pub const INT_LO: i32 = 1;

// Dispersal — FUN_00cf5100 [ASM]
const DISP_BASE: f64 = 1.0;
const DISP_EXP_A: f64 = -0.191;
const DISP_MULT_A: f64 = 0.76;
const DISP_EXP_B: f64 = -0.42;
const DISP_MULT_B: f64 = 3.0;
const DISP_RAND_EXP: f64 = 1.6;
const DISP_THRESH: f64 = 0.5;

// Post-lapse — FUN_00ce2fe0
const PL_DIV: f64 = 100.0;
const PL_SCALE: f64 = -5.0;
const PL_TARGET: f64 = 9.0;
const PL_JITTER: f64 = 0.2;
const PL_LO: f64 = 1.0;
const PL_HI: f64 = 11.0;

// Minimum-growth guard — FUN_00cf4b90 [C][BIN]. Constants byte-extracted
// 2026-07-20: DAT_00cf4cb0=-0.1, _DAT_00cf4cb8=1.7, DAT_00cf4cc0=1.1,
// _DAT_00cf4cc8=0.5; the 0x46 (70) and 0x5b5 (1461) thresholds are code
// immediates.
const MG_USED_MAX: i32 = 1461;
const MG_POW_USED_MAX: i32 = 70;
const MG_POW_EXP: f64 = -0.1;
const MG_POW_MULT: f64 = 1.7;
const MG_FLOOR: f64 = 1.1;
const MG_ROUND_ADD: f64 = 0.5;

pub const DEFAULT_FI: u8 = 10;

// =============================================================================
// ENSEMBLE — FUN_00cf4d50
// =============================================================================

/// Weighted average of the 5 model stabilities with explicit weights. `[C][BIN]`
///
/// Mirrors `FUN_00cf4d50`: the weights live in mutable per-user state (the
/// binary's `[Algorithm] PA2/PA15/PA19/PA20/PAF` settings), and when they sum
/// to zero the blend falls back to the SM-19 slot (`+0x7b`).
///
/// M1 and M2 are stored as int32 in the item struct, so they are rounded
/// before weighting (matching `(double)*(int*)(item+0x73/0x77)`).
pub fn ensemble_stability_weighted(
    weights: &[f64; 5],
    m1: f64,
    m2: f64,
    m3: f64,
    m4: f64,
    m5: f64,
) -> f64 {
    let total: f64 = weights.iter().sum();
    if total <= ENSEMBLE_THRESHOLD {
        return m3; // default = slot +0x7b (SM-19)
    }
    // int32 store rounding = FUN_0040c5d0 = ties-to-even (no-op in the
    // pipeline, where m1/m2 arrive integer-valued).
    let num = weights[0] * (m1.round_ties_even() as i64 as f64)
        + weights[1] * (m2.round_ties_even() as i64 as f64)
        + weights[2] * m3
        + weights[3] * m4
        + weights[4] * m5;
    num / total
}

/// Weighted average at the binary's fresh-install default weights.
pub fn ensemble_stability(m1: f64, m2: f64, m3: f64, m4: f64, m5: f64) -> f64 {
    ensemble_stability_weighted(&DEFAULT_WEIGHTS, m1, m2, m3, m4, m5)
}

// =============================================================================
// WEIGHT ADAPTATION — FUN_00af40d0 [C][BIN]
// =============================================================================

/// `FUN_00af40d0`: adapt ensemble weights based on per-model prediction errors.
///
/// `weights` are modified in place. `model_errors` are signed prediction errors
/// (actual_outcome - predicted_retrievability for each model).
///
/// Formula (all constants [BIN] from af44b0-af4518):
/// ```text
/// mean_error = sum(errors) / 5
/// adjustment_i = clamp(mean_error - error_i, -0.5, 0.5)
/// factor_i = exp(adjustment_i * 0.0317)
/// weight_i *= factor_i
/// weight_i = clamp(weight_i, lo_i, hi_i)
/// renormalize all weights to sum = 100
/// ```
pub fn adapt_weights(weights: &mut [f64; 5], model_errors: &[f64; 5]) {
    let mean: f64 = model_errors.iter().sum::<f64>() / 5.0;
    for i in 0..5 {
        let adjustment = clamp(mean - model_errors[i], ADAPT_CLAMP_LO, ADAPT_CLAMP_HI);
        let factor = (adjustment * ADAPT_LEARNING_RATE).exp();
        weights[i] *= factor;
        let (lo, hi) = ADAPT_WEIGHT_CLAMPS[i];
        weights[i] = clamp(weights[i], lo, hi);
    }
    let total: f64 = weights.iter().sum();
    for i in 0..5 {
        weights[i] = (weights[i] / total) * ADAPT_TARGET_SUM;
    }
}

/// Compute per-model prediction errors for weight adaptation.
///
/// Each model's error = actual_outcome - predicted_retrievability.
/// `recalled` = true if the user recalled the item (grade >= 3).
pub fn compute_model_errors(
    predictions: [f64; 5],
    recalled: bool,
) -> [f64; 5] {
    let outcome = if recalled { 1.0 } else { 0.0 };
    [
        outcome - predictions[0],
        outcome - predictions[1],
        outcome - predictions[2],
        outcome - predictions[3],
        outcome - predictions[4],
    ]
}

// =============================================================================
// RETENTION FACTOR + DISPERSAL + POST-LAPSE
// =============================================================================

/// `ln(1 - FI/100) / ln(0.9)`. FI = requested forgetting index. `[BIN]`
#[inline]
pub fn retention_factor(fi: u8) -> f64 {
    (FI_ONE - fi as f64 / FI_DIV).ln() / FORGET_BASE.ln()
}

/// `FUN_00cf5100`: interval-scaled stochastic day-spread. `[C][ASM][BIN]`
///
/// Draw order: `p` first (pow(rand, 1.6)), branch second (rand <= 0.5).
pub fn dispersal(adjusted: f64, rng: &mut impl rand::Rng) -> f64 {
    let d_var4 = DISP_BASE - delphi_pow(adjusted, DISP_EXP_A) * DISP_MULT_A;
    let d_var5 = delphi_pow(adjusted, DISP_EXP_B) * DISP_MULT_B + DISP_BASE;
    let p = rng.gen::<f64>().powf(DISP_RAND_EXP);
    let factor = if rng.gen::<f64>() <= DISP_THRESH {
        d_var5 - DISP_BASE // grow
    } else {
        d_var4 - DISP_BASE // shrink
    };
    adjusted + factor * p * adjusted
}

/// `FUN_00ce2fe0`: post-lapse curve toward target=9, clamped [1, 11]. `[C][BIN]`
///
/// `x = item[+0x16]`. Deterministic unless `rng` is given (Box-Muller jitter).
pub fn post_lapse(adjusted: f64, x: f64, rng: Option<&mut impl rand::Rng>) -> f64 {
    let xr = clamp(x / PL_DIV, 0.0, 1.0);
    let f = 1.0 - (xr * PL_SCALE).exp();
    let mut base = adjusted + f * (PL_TARGET - adjusted);
    if let Some(r) = rng {
        // Box-Muller Gaussian (simplified — single draw)
        let u1 = r.gen::<f64>().max(1e-10);
        let u2 = r.gen::<f64>();
        let gauss = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos();
        base = base + base * PL_JITTER * gauss;
    }
    clamp(base, PL_LO, PL_HI)
}

/// `FUN_00cf4b90`: minimum interval-growth ratio for pass reviews. `[C][BIN]`
///
/// The finalizer calls this (`FUN_00cf5b50:53-62`) only when `item[+0xb7] > 1`
/// — i.e. the current review's dispatch classified it as a **pass with at
/// least one prior repetition**. Enforces `interval/used >= floor`:
///
/// ```text
/// used < 70:    floor = max(1.7 * used^-0.1, 1.1)
/// used < 1461:  floor = 1.1
/// used >= 1461: no guard
/// ```
///
/// On violation: `interval = Round(used * floor + 0.5)` (Delphi Round),
/// re-clamped to `INT_HI` by the caller.
pub fn min_growth_guard(interval: i32, used_interval: i32) -> i32 {
    let used = used_interval.max(1); // FUN_00cf5b50:54 floors +0x2a at 1
    if used >= MG_USED_MAX {
        return interval;
    }
    let mut floor_ratio = MG_FLOOR;
    if used < MG_POW_USED_MAX {
        floor_ratio = delphi_pow(used as f64, MG_POW_EXP) * MG_POW_MULT;
    }
    if floor_ratio < MG_FLOOR {
        floor_ratio = MG_FLOOR;
    }
    if (interval as f64) / (used as f64) < floor_ratio {
        let bumped = delphi_round(used as f64 * floor_ratio + MG_ROUND_ADD) as i32;
        return bumped.min(INT_HI); // caller re-clamp (FUN_00cf5b50:60)
    }
    interval
}

/// Result of the finalization pipeline.
#[derive(Debug, Clone)]
pub struct FinalizeResult {
    pub adjusted: f64,
    pub raw: f64,
    pub interval: i32,
}

/// `FUN_00cf5b50`: ensemble stability → integer due-date interval. `[C][BIN]`
///
/// `post_lapse_mode` is the binary trigger `item[+0xb9]!=0 && item[+0xb7]==1`
/// — with the markers written by the *same* review's dispatch this means
/// "the current review is a lapse on an item with a prior repetition".
/// `post_lapse_x` is the element priority percent (`item[+0x16]`).
/// `min_growth` mirrors `item[+0xb7] > 1` (a pass with a prior repetition)
/// and applies [`min_growth_guard`] with `used_interval` (`item[+0x2a]`).
#[allow(clippy::too_many_arguments)]
pub fn finalize(
    ensemble_val: f64,
    fi: u8,
    post_lapse_mode: bool,
    post_lapse_x: f64,
    disperse: bool,
    rng: Option<&mut impl rand::Rng>,
    used_interval: i32,
    min_growth: bool,
) -> FinalizeResult {
    let adjusted = retention_factor(fi) * ensemble_val;

    let raw = if post_lapse_mode {
        post_lapse(adjusted, post_lapse_x, rng)
    } else if disperse {
        match rng {
            Some(r) => dispersal(adjusted, r),
            None => adjusted,
        }
    } else {
        adjusted
    };

    let raw = clamp(raw, CLAMP_LO, CLAMP_HI);
    let mut interval = (delphi_round(raw) as i32).clamp(INT_LO, INT_HI);
    if min_growth {
        interval = min_growth_guard(interval, used_interval);
    }

    FinalizeResult {
        adjusted,
        raw,
        interval,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `FUN_0040c5d0` decompiles to `(longlong)ROUND(x)` — ties-to-even.
    #[test]
    fn delphi_round_ties_to_even() {
        assert_eq!(delphi_round(12.5), 12);
        assert_eq!(delphi_round(13.5), 14);
        assert_eq!(delphi_round(12.4), 12);
        assert_eq!(delphi_round(-0.5), 0);
    }

    /// `FUN_00cf4b90` with byte-extracted constants (2026-07-20):
    /// floor = max(1.7·used^-0.1, 1.1) for used < 70, flat 1.1 for
    /// used < 1461, unguarded beyond.
    #[test]
    fn min_growth_guard_matches_cf4b90() {
        let expected10 = delphi_round(10.0 * delphi_pow(10.0, -0.1) * 1.7 + 0.5) as i32;
        assert_eq!(min_growth_guard(10, 10), expected10);
        // Ratio already above the floor: unchanged.
        assert_eq!(min_growth_guard(20, 10), 20);
        // 70 <= used < 1461: flat 1.1 floor.
        assert_eq!(min_growth_guard(100, 100), delphi_round(100.0 * 1.1 + 0.5) as i32);
        // used >= 1461: no guard.
        assert_eq!(min_growth_guard(1461, 1461), 1461);
    }
}
