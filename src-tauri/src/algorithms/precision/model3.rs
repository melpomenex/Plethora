//! Model 3 — SM-15 raw matrix scheduler (45% ensemble weight).
//!
//! `FUN_00cea5a0` — the legacy SM-15 matrix-based scheduler, the single biggest
//! contributor to the ensemble. Uses 21³ Bayesian learning matrices that are
//! populated per-review. Live-validated: 9/9 vectors (6 fresh + 3 seeded) at
//! 12 decimal places.
//!
//! Evidence: `[C][ASM][BIN]`

use serde::{Deserialize, Serialize};

use super::helpers::*;

// =============================================================================
// CONSTANTS — all extracted from .text section [BIN]
// =============================================================================

const STABILITY_POW_DENOM: f64 = 2.903969365022566; // ln(6000)/ln(20)

// R index mapper (FUN_00cf7250)
const R_LN_MULT: f64 = 20.0;
const R_IDX_MIN: i32 = 1;
const R_IDX_MAX: i32 = 20;

// Stability index mapper (FUN_00cf7330)
const S_SUBTRACT: f64 = 2.0;
const S_FLOOR: f64 = 0.0;
const S_POW_NUM: f64 = 1.0;
const S_IDX_MAX: i32 = 20;

// Difficulty index mapper (FUN_00cf6fd0)
const D_MIN: f64 = 0.0;
const D_MAX: f64 = 1.0;
const D_MULT: f64 = 19.0;
const D_SENTINEL: i32 = 10;

// decay_transform (FUN_00f614b0)
const DECAY_HI: f64 = 38.0;
const DECAY_LO: f64 = -38.0;

// matrix builder (FUN_00ce7e60)
const COUNT_FLOOR: f64 = 0.0;
const PRIOR_A: f64 = 0.64;
const PRIOR_B: f64 = 0.3;

// SInc interpolation (FUN_00ce99a0)
const SINC_K: f64 = 3.5;
const SINC_BASE: f64 = 1.0;

// predicted blend (FUN_00af6e30)
const AF_ADD: f64 = 0.1;
const AF_MUL: f64 = 9.0;
const AF_ONE: f64 = 1.0;
const AF_DIV: f64 = 2.0;
const AF_ZERO: f64 = 0.0;

// stability increase (FUN_00ce9400)
const SI_175: f64 = 175.0;
const SI_100: f64 = 100.0;
const SI_K_PASS: f64 = 3.0;
const SI_W_PASS: f64 = 100.0;
const SI_K_DIFF: f64 = 333.0;
const SI_W_DIFF: f64 = 1.25;
const SI_K_FAIL: f64 = 1.0;
const SI_W_FAIL: f64 = 200.0;

// rounding (FUN_00ce8dd0)
const ROUND_NARROW_HI: f64 = 2.0;
const ROUND_NARROW_LO: f64 = 0.5;
const ROUND_WIDE_HI: f64 = 20.0;
const ROUND_WIDE_LO: f64 = 0.8;

// matrix update (FUN_00ce3210)
const MU_K: f64 = 10.0;
const MU_PRIOR_W: f64 = 1.0;
const MU_POW_BASE: f64 = 1.8;
const MU_MUL_EXP: f64 = -0.27;
const MU_COEFF: f64 = 3.5;
const MU_ADD: f64 = 0.6;

// Bayesian prior (FUN_00ce1900)
const BP_HI: f64 = 15.0;
const BP_LO: f64 = 3.0;
const BP_MID: f64 = 1.0;
const BP_POW_LO: f64 = -0.08;
const BP_POW_HI: f64 = -0.35;
const BP_LIN_M: f64 = -2.0;
const BP_LIN_B: f64 = 2.25;
const BP_CLAMP: f64 = 600.0;

// Bayesian smoothing (FUN_00ce9190)
const BS_CAP: f64 = 1.0;
const BS_K: f64 = 300.0;
const BS_W: f64 = 10.0;
const BS_FLOOR: f64 = 0.1;

// clamps
const R_VALID_LO: f64 = 0.005;
const R_VALID_HI: f64 = 0.995;
const S_VALID_LO: f64 = 0.7;
const S_VALID_HI: f64 = 44530.0;

// W3 main
const W3_WRONG_TH: f64 = 0.0;

// forgetting-curve fit (FUN_00cf9070)
const CF_R_HI: f64 = 0.9999;
const CF_R_LO: f64 = 0.1;
const CF_RATIO_TH: f64 = 0.99;
const CF_POW_EXP: f64 = 0.07;
const CF_BASE: f64 = 0.9;
const CF_YEAR: f64 = 365.0;
const CF_W_HI: f64 = 100.0;
const CF_ONE: f64 = 1.0;
const CF_W_LO: f64 = 50.0;
const INTERVAL_AXIS_BASE: f64 = 1.4;
const INTERVAL_AXIS_SHIFT: f64 = 12.5;

// WLS
const AXIS_LOG_BASE: f64 = 20.0;
const WLS_EPS: f64 = 1e-5;

// Dimensions
pub const OUTCOME_CELLS: usize = 21 * 21 * 21; // 9261
const LAPSE_R_DIM: usize = 20;
const LAPSE_STAGE_DIM: usize = 21;
const LAPSE_INTERVAL_DIM: usize = 36;
pub const LAPSE_CELLS: usize = LAPSE_R_DIM * LAPSE_STAGE_DIM * LAPSE_INTERVAL_DIM; // 15120

// =============================================================================
// HELPERS
// =============================================================================

/// `FUN_0040c5d0` = Delphi Round = ties-to-even (name kept for parity with
/// the Python reference's `round_half_up`, which also rounds ties to even).
#[inline]
fn round_half_up(x: f64) -> i64 {
    x.round_ties_even() as i64
}

#[inline]
fn decay_transform(x: f64) -> f64 {
    let x = clamp(x, DECAY_LO, DECAY_HI);
    x.exp()
}

fn clamp_r(r: f64) -> f64 {
    if r <= -1.0 {
        return 0.995;
    }
    if r <= R_VALID_LO {
        return 0.005;
    }
    if r >= R_VALID_HI {
        return 0.995;
    }
    r
}

fn clamp_s(s: f64) -> f64 {
    if s <= -1.0 {
        return 44530.0;
    }
    if s <= S_VALID_LO {
        return 0.7;
    }
    if s >= S_VALID_HI {
        return 44530.0;
    }
    s
}

// =============================================================================
// INDEX MAPPERS
// =============================================================================

pub fn r_index(r: f64) -> i32 {
    if r < 0.0 {
        panic!("Retrievability not set in categorizing R");
    }
    let mut v = round_half_up((r * R_LN_MULT.ln()).exp()) as i32;
    if v > R_IDX_MAX {
        v = R_IDX_MAX;
    }
    if v < R_IDX_MIN {
        v = R_IDX_MIN;
    }
    v
}

pub fn s_index(s: f64) -> i32 {
    let s = clamp_s(s);
    let mut d = s - S_SUBTRACT;
    if d < S_FLOOR {
        d = S_FLOOR;
    }
    let raw = delphi_pow(d, S_POW_NUM / STABILITY_POW_DENOM);
    let mut idx = round_half_up(raw) as i32 + 1;
    if idx > S_IDX_MAX {
        idx = S_IDX_MAX;
    }
    if idx == 0 {
        idx = 1;
    }
    idx
}

pub fn d_index(d: f64) -> i32 {
    if D_MIN <= d && d <= D_MAX {
        round_half_up(d * D_MULT) as i32 + 1
    } else {
        D_SENTINEL
    }
}

#[inline]
fn matrix_cell_offset(rep_idx: i32, stab_idx: i32, diff_idx: i32) -> usize {
    ((rep_idx - 1) * 441 + (stab_idx - 1) * 21 + (diff_idx - 1)) as usize
}

#[inline]
fn lapse_cell_offset(r_idx: i32, stage_idx: i32, interval_idx: i32) -> usize {
    ((r_idx - 1) * (LAPSE_STAGE_DIM as i32 * LAPSE_INTERVAL_DIM as i32)
        + (stage_idx - 1) * LAPSE_INTERVAL_DIM as i32
        + (interval_idx - 1)) as usize
}

fn stability_axis_value(j: i32) -> f64 {
    (j as f64).ln() / (20.0f64).ln()
}

// =============================================================================
// MATRIX STATE
// =============================================================================

/// All persistent matrix state for M3.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct M3MatrixState {
    pub outcome_count: Vec<u32>,
    pub outcome_success: Vec<u32>,
    pub smoothing_count: Vec<u32>,
    pub smoothing_value: Vec<f64>,
    pub lapse_observed: Vec<u32>,
    pub lapse_remembered: Vec<u32>,
    pub first_stage_observed: Vec<u32>,
    pub first_stage_remembered: Vec<u32>,
}

impl Default for M3MatrixState {
    fn default() -> Self {
        Self {
            outcome_count: vec![0; OUTCOME_CELLS],
            outcome_success: vec![0; OUTCOME_CELLS],
            smoothing_count: vec![0; OUTCOME_CELLS],
            smoothing_value: vec![0.0; OUTCOME_CELLS],
            lapse_observed: vec![0; LAPSE_CELLS],
            lapse_remembered: vec![0; LAPSE_CELLS],
            first_stage_observed: vec![0; LAPSE_INTERVAL_DIM],
            first_stage_remembered: vec![0; LAPSE_INTERVAL_DIM],
        }
    }
}

impl M3MatrixState {
    pub fn record_outcome(&mut self, d_idx: i32, s_idx: i32, r_idx: i32, grade: i32) {
        let off = matrix_cell_offset(d_idx, s_idx, r_idx);
        self.outcome_count[off] = self.outcome_count[off].saturating_add(1);
        if grade >= 3 {
            self.outcome_success[off] = self.outcome_success[off].saturating_add(1);
        }
    }

    pub fn record_pre_lapse_outcome(
        &mut self,
        previous_reps: u32,
        previous_lapses: u32,
        previous_r_idx: i32,
        interval_idx: i32,
        grade: i32,
    ) {
        let interval_idx = interval_idx.clamp(1, 36);
        if previous_reps != 1 {
            return;
        }
        if previous_lapses > 0 {
            let stage = (previous_lapses as i32).clamp(1, 20);
            let r = previous_r_idx.clamp(1, 20);
            let off = lapse_cell_offset(r, stage, interval_idx);
            self.lapse_observed[off] = self.lapse_observed[off].saturating_add(1);
            if grade >= 3 {
                self.lapse_remembered[off] = self.lapse_remembered[off].saturating_add(1);
            }
        } else {
            let off = (interval_idx - 1) as usize;
            self.first_stage_observed[off] = self.first_stage_observed[off].saturating_add(1);
            if grade >= 3 {
                self.first_stage_remembered[off] =
                    self.first_stage_remembered[off].saturating_add(1);
            }
        }
    }

    pub fn record_smoothing_value(&mut self, d_idx: i32, s_idx: i32, r_idx: i32, value: f64) {
        if value <= 0.0 || s_idx <= 0 {
            return;
        }
        let off = matrix_cell_offset(d_idx, s_idx, r_idx);
        let count = self.smoothing_count[off] as f64;
        self.smoothing_value[off] = (self.smoothing_value[off] * count + value) / (count + 1.0);
        self.smoothing_count[off] = self.smoothing_count[off].saturating_add(1);
    }
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

fn wls_regression(xs: &[f64], ys: &[f64], counts: &[u32]) -> (f64, f64) {
    let mut sy = 0.0f64;
    let mut sx = 0.0f64;
    let mut sxx = 0.0f64;
    let mut sxy = 0.0f64;
    let mut sw = 0.0f64;
    for i in 0..xs.len() {
        let w = round_half_up(counts[i] as f64) as f64 + WLS_EPS;
        sy += ys[i] * w;
        sx += xs[i] * w;
        sxx += xs[i] * xs[i] * w;
        sxy += xs[i] * ys[i] * w;
        sw += w;
    }
    let xbar = sx / sw;
    let slope = (sxy / sw - xbar * (sy / sw)) / (sxx / sw - xbar * xbar);
    let intercept = sy / sw - xbar * slope;
    (slope, intercept)
}

fn build_axis_and_fit(
    idx_a: i32,
    idx_b: i32,
    of_interval: &[u32],
    of_count: &[u32],
) -> (f64, f64, i64) {
    let mut xs = [0.0f64; 20];
    let mut ys = [0.0f64; 20];
    let mut counts = [0u32; 20];
    let mut total_count: i64 = 0;
    for j in 1..=20i32 {
        let axis = (j as f64).ln() / AXIS_LOG_BASE.ln();
        let off = ((idx_a - 1) * 441 + (idx_b - 1) * 21 + (j - 1)) as usize;
        let c = of_count[off];
        total_count += round_half_up(c as f64);
        let prior = if c as f64 <= COUNT_FLOOR {
            axis * PRIOR_A + PRIOR_B
        } else {
            of_interval[off] as f64 / c as f64
        };
        let y = if prior > COUNT_FLOOR { prior.ln() } else { 0.0 };
        xs[(j - 1) as usize] = axis;
        ys[(j - 1) as usize] = y;
        counts[(j - 1) as usize] = c;
    }
    let (slope, intercept) = wls_regression(&xs, &ys, &counts);
    (slope, intercept, total_count)
}

fn sinc_interpolation(r: f64, matrix_sinc: f64, total_count: f64) -> f64 {
    let w = sigmoid_ratio(total_count, SINC_K);
    w * matrix_sinc + (SINC_BASE - w) * r
}

fn predicted_blend(old_interval: f64, new_sinc: f64, grade: i32, reps: u32, lapses: u32) -> f64 {
    let recall = if grade >= 3 { AF_ONE } else { AF_ZERO };
    let target = (sign_flip(recall - new_sinc) + AF_ADD) * AF_MUL;
    let mut mix_w = 0.2;
    if reps == 2 && lapses == 0 {
        mix_w = 0.7;
    }
    if recall == AF_ONE && old_interval < target {
        mix_w /= AF_DIV;
    }
    if recall == AF_ZERO && target < old_interval {
        mix_w /= AF_DIV;
    }
    let out = mix_w * target + (AF_ONE - mix_w) * old_interval;
    clamp(out, 0.0, 1.0)
}

fn stability_increase(
    old_interval: f64,
    matrix_value: f64,
    total_count: f64,
    grade: i32,
    new_s: f64,
    pass_flag: bool,
    fail_flag: bool,
) -> f64 {
    let w_old = SI_175;
    let w_mat = SI_100;
    let mut w_count = 0.01;
    let mut w_diff = SI_W_FAIL;
    if pass_flag {
        if old_interval <= new_s {
            let ratio = new_s / old_interval;
            w_count = sigmoid_ratio(ratio, SI_K_PASS) * SI_W_PASS;
        }
        w_diff = sigmoid_ratio(total_count, SI_K_DIFF) * SI_W_DIFF;
    }
    if fail_flag {
        if new_s <= old_interval {
            let ratio = SI_K_FAIL - new_s / old_interval;
            w_count = sigmoid_ratio(ratio, SI_K_FAIL) * SI_W_FAIL;
        }
        w_diff = 1.0;
    }
    (matrix_value * (w_mat + w_diff) + old_interval * w_old + new_s * w_count)
        / (w_diff + w_mat + w_old + w_count)
}

fn round_ratio(ratio: f64, pass_flag: bool) -> f64 {
    if !pass_flag {
        // narrow set
        if ratio > ROUND_NARROW_HI {
            return 2.0;
        }
        if ratio <= ROUND_NARROW_LO {
            return 0.5;
        }
        ratio
    } else {
        // wide set
        if ratio > ROUND_WIDE_HI {
            return 20.0;
        }
        if ratio <= ROUND_WIDE_LO {
            return 0.8;
        }
        ratio
    }
}

fn matrix_update_prior(new_reps: f64, new_s: f64) -> f64 {
    let base = delphi_pow(new_s, MU_POW_BASE);
    let e = (new_reps * MU_MUL_EXP).exp();
    base * MU_COEFF * e + MU_ADD
}

fn matrix_update(
    old_s: f64,
    reps_count: f64,
    new_s: f64,
    lookup_smoothed: f64,
    neighbor_count: i64,
) -> f64 {
    let prior = matrix_update_prior(reps_count, new_s);
    let w = sigmoid_ratio(neighbor_count as f64, MU_K);
    (MU_PRIOR_W - w) * prior + w * lookup_smoothed
}

fn bayesian_prior_interval(d_blend: f64, old_interval: f64, r: f64) -> f64 {
    let a = BP_LO + (BP_HI - BP_LO) * (BP_MID - d_blend);
    let b = delphi_pow(old_interval, BP_POW_LO + d_blend * (BP_POW_HI - BP_POW_LO));
    let base = (a - BP_MID) * b + BP_MID;
    let mut lin = d_blend * BP_LIN_M + BP_LIN_B;
    if BP_CLAMP < lin {
        lin = BP_CLAMP;
    }
    let out = base * decay_transform(sign_flip(lin) * r);
    round_ratio(out, true)
}

fn bayesian_smoothing(
    measured: f64,
    measurement_weight: f64,
    cell_value: f64,
    neighbor_value: f64,
    neighbor_count: i64,
) -> f64 {
    let cap = measurement_weight.min(BS_CAP);
    let mut lo = measurement_weight * cell_value;
    if lo < measurement_weight * neighbor_value {
        lo = measurement_weight * neighbor_value;
    }
    if lo < measured {
        lo = measured + cap;
    }
    let w = sigmoid_ratio(neighbor_count as f64, BS_K);
    let mut out = measured * ((neighbor_value + w * BS_W * cell_value) / (w * BS_W + BS_CAP));
    if lo < out {
        out = lo;
    }
    if out < BS_FLOOR {
        out = BS_FLOOR;
    }
    out
}

fn interval_axis_value(index: i32) -> i32 {
    let powered = (INTERVAL_AXIS_BASE.powf(index as f64 - INTERVAL_AXIS_SHIFT)).ceil() as i32;
    index.max(powered)
}

fn forgetting_curve_fit(successes: &[u32], observations: &[u32], prior_interval: f64) -> f64 {
    let n = successes.len().min(35);
    let mut ratios = [0.0f64; 35];
    let mut total_success: i64 = 0;
    let mut total_observed: i64 = 0;
    for i in 0..n {
        if observations[i] == 0 {
            ratios[i] = CF_R_LO;
        } else {
            ratios[i] = CF_R_LO.max(successes[i] as f64 / observations[i] as f64);
            total_success += round_half_up(successes[i] as f64);
            total_observed += round_half_up(observations[i] as f64);
        }
    }
    if total_observed == 0 {
        return prior_interval;
    }
    let overall = total_success as f64 / total_observed as f64;
    if overall > CF_RATIO_TH {
        return prior_interval;
    }
    let overall = CF_R_LO.max(CF_R_HI.min(overall));
    let xs: Vec<f64> = (1..=35)
        .map(|i| (interval_axis_value(i) as f64).ln())
        .collect();
    let ys: Vec<f64> = (0..35).map(|i| ratios[i].ln()).collect();
    let obs_slice = &observations[..n];
    let (slope, intercept) = wls_regression(&xs[..n], &ys[..n], obs_slice);

    let log_hi = CF_R_HI.ln();
    let log_lo = CF_R_LO.ln();
    let log_target = CF_BASE.ln();
    let prior_intercept = (delphi_pow(prior_interval, CF_POW_EXP) * CF_BASE).ln();
    let mut slope = slope;
    let mut intercept = intercept;
    if log_hi < intercept {
        slope = slope * (log_target - log_hi) / (log_target - intercept);
        intercept = log_hi;
    }
    if intercept < log_lo {
        intercept = log_lo;
    }
    let mut minimum_slope = -0.001;
    if CF_BASE < overall {
        minimum_slope = (log_target - overall.ln()) / CF_YEAR.ln();
    }
    if minimum_slope < slope {
        intercept = overall.ln();
        slope = minimum_slope;
    }
    let slope = (-3.0f64).max(slope);
    let data_weight = sigmoid_ratio(total_observed as f64, CF_W_HI);
    let slope = slope * data_weight + (-0.07) * (CF_ONE - data_weight);
    let intercept = intercept * data_weight + prior_intercept * (CF_ONE - data_weight);
    let fitted = ((log_target - intercept) / slope).exp();
    let output_weight = sigmoid_ratio(total_observed as f64, CF_W_LO);
    fitted * output_weight + prior_interval * (CF_ONE - output_weight)
}

fn lapse_cell_fit(r_idx: i32, stage_idx: i32, state: &M3MatrixState) -> (f64, i64) {
    let mut successes = [0u32; 35];
    let mut observations = [0u32; 35];
    for interval_idx in 1..=35 {
        let off = lapse_cell_offset(r_idx, stage_idx, interval_idx);
        successes[interval_idx as usize - 1] = state.lapse_remembered[off];
        observations[interval_idx as usize - 1] = state.lapse_observed[off];
    }
    let total: i64 = observations.iter().map(|&x| x as i64).sum();
    (
        clamp(
            forgetting_curve_fit(&successes, &observations, 1.0),
            0.1,
            11.0,
        ),
        total,
    )
}

fn lapse_neighbor_lookup(retrievability: f64, stage: i32, state: &M3MatrixState) -> (f64, i64) {
    let center_r = r_index(retrievability);
    let center_stage = stage.clamp(1, 20);
    let neighbors: [(i32, i32, i64); 5] =
        [(0, 0, 16), (-1, 0, 4), (1, 0, 4), (0, -1, 1), (0, 1, 1)];
    let mut weighted: Vec<(f64, i64)> = Vec::new();
    for (dr, ds, mult) in neighbors {
        let r = center_r + dr;
        let s = center_stage + ds;
        if (1..=20).contains(&r) && (1..=20).contains(&s) {
            let (value, count) = lapse_cell_fit(r, s, state);
            weighted.push((value, count * mult));
        }
    }
    let total: i64 = weighted.iter().map(|(_, c)| *c).sum();
    if total == 0 {
        return (weighted[0].0, 0);
    }
    let sum: f64 = weighted.iter().map(|(v, c)| v * (*c as f64)).sum();
    (sum / total as f64, total)
}

// =============================================================================
// ITEM STATE
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct M3ItemState {
    pub last_review_day: i32,
    pub previous_interval: i32,
    pub repetitions: u32,
    pub lapses: u32,
    pub stability: f64,
    pub difficulty: f64,
    pub previous_stability: f64,
    pub previous_stability_index: i32,
    pub previous_r_index: i32,
}

impl Default for M3ItemState {
    fn default() -> Self {
        Self {
            last_review_day: -1,
            previous_interval: 0,
            repetitions: 0,
            lapses: 0,
            stability: 1.0,
            difficulty: 0.5,
            previous_stability: -1.0,
            previous_stability_index: 0,
            previous_r_index: 0,
        }
    }
}

impl M3ItemState {
    /// Initialize from the DSR state (for items that don't have M3 state yet).
    pub fn from_dsr(stability: f64, difficulty: f64, repetitions: u32, lapses: u32) -> Self {
        Self {
            stability,
            difficulty,
            repetitions,
            lapses,
            ..Default::default()
        }
    }
}

/// Result of an M3 review.
#[derive(Debug, Clone)]
pub struct M3ReviewResult {
    pub stability: f64,
    pub retrievability: f64,
    pub elapsed: i32,
    pub d_blend: f64,
    pub next_item: M3ItemState,
    pub committed: bool,
}

/// The W3 model path output.
struct W3Output {
    matrix_entry: f64,
    d_blend: f64,
}

/// `FUN_00cea5a0`: the SM-15 raw (W3) model path. `[C][BIN]`
fn w3_model_path(
    t: f64,
    reps: u32,
    lapses: u32,
    grade: i32,
    d: f64,
    s_old: f64,
    old_interval: f64,
    r: f64,
    prev_s: f64,
    state: &M3MatrixState,
) -> W3Output {
    // 1. Map axes to matrix indices
    let r_idx = r_index(r);
    let s_idx = s_index(s_old);
    let d_idx = d_index(d);

    // 2+3. SInc fit
    let (slope, intercept, total_count) =
        build_axis_and_fit(d_idx, s_idx, &state.outcome_success, &state.outcome_count);
    let sinc_interval = clamp_r(decay_transform(slope * r + intercept));

    // 4. Blend SInc with R
    let new_s_from_matrix = clamp_r(sinc_interpolation(r, sinc_interval, total_count as f64));

    // 5. Predicted difficulty blend
    let d_blend = predicted_blend(d, new_s_from_matrix, grade, reps, lapses);

    // 6. Estimated stability
    let estimated_stability = clamp_s((-0.9f64.ln() * t) / (-new_s_from_matrix.ln()));

    // 7. Stability increase
    let pass_flag = grade >= 3;
    let fail_flag = grade < 3;
    let new_s = stability_increase(
        old_interval,
        estimated_stability,
        total_count as f64,
        grade,
        t,
        pass_flag,
        fail_flag,
    );

    // 8-9. Choose branch
    let matrix_entry;
    if fail_flag && grade != 0xb {
        let stage = round_half_up(lapses as f64) as i32 + 1;
        let (neighbor_smoothed, neighbor_count) =
            lapse_neighbor_lookup(new_s_from_matrix, stage, state);
        matrix_entry = matrix_update(
            d,
            stage as f64,
            new_s_from_matrix,
            neighbor_smoothed,
            neighbor_count,
        );
    } else {
        let prior_iv = bayesian_prior_interval(d_blend, old_interval, r);
        let new_d_idx = d_index(d_blend);
        let off = matrix_cell_offset(new_d_idx, s_idx, r_idx);
        matrix_entry = bayesian_smoothing(
            new_s,
            t,
            state.smoothing_value[off],
            prior_iv,
            state.smoothing_count[off] as i64,
        );
    }

    W3Output {
        matrix_entry,
        d_blend,
    }
}

/// Run M3 with the binary's replay order: outcome → schedule → smoothing.
pub fn model_3_stateful(
    item: &M3ItemState,
    matrices: &mut M3MatrixState,
    today: i32,
    grade: i32,
    commit: bool,
    retrievability: Option<f64>,
) -> M3ReviewResult {
    assert!((0..=5).contains(&grade), "grade must be in 0..=5");

    // Clone for scratch mode
    let mut working_owned;
    let working: &mut M3MatrixState = if commit {
        matrices
    } else {
        working_owned = matrices.clone();
        &mut working_owned
    };

    let elapsed = if item.last_review_day < 0 {
        0
    } else {
        (today - item.last_review_day).max(0)
    };

    let retrievability = if let Some(r) = retrievability {
        clamp_r(r)
    } else {
        // Reference: base = max(1.0, previous_interval or stability) — stability
        // is only the fallback when no previous interval exists, never a max.
        let base = if item.previous_interval != 0 {
            (item.previous_interval as f64).max(1.0)
        } else {
            item.stability.max(1.0)
        };
        clamp_r((0.9f64.ln() * elapsed as f64 / base).exp())
    };

    let (repetitions, lapses) = if grade >= 3 {
        (item.repetitions.saturating_add(1).min(65535), item.lapses)
    } else {
        let new_lapses = if item.repetitions > 0 {
            item.lapses.saturating_add(1).min(65535)
        } else {
            item.lapses
        };
        (1, new_lapses)
    };

    let old_stability = clamp_s(item.stability);
    let pre_d = d_index(item.difficulty);
    let pre_s = s_index(old_stability);
    let pre_r = r_index(retrievability);

    // Record outcome before scheduling
    working.record_outcome(pre_d, pre_s, pre_r, grade);
    working.record_pre_lapse_outcome(
        item.repetitions,
        item.lapses,
        if item.previous_r_index != 0 {
            item.previous_r_index
        } else {
            pre_r
        },
        interval_category(elapsed),
        grade,
    );

    let output = w3_model_path(
        elapsed.max(1) as f64,
        repetitions,
        lapses,
        grade,
        item.difficulty,
        old_stability,
        old_stability,
        retrievability,
        item.previous_stability,
        working,
    );

    // Record smoothing value after scheduling
    working.record_smoothing_value(
        pre_d,
        item.previous_stability_index,
        pre_r,
        output.matrix_entry,
    );

    let next_item = M3ItemState {
        last_review_day: today,
        previous_interval: 0, // pipeline overwrites with final ensemble interval
        repetitions,
        lapses,
        stability: output.matrix_entry,
        difficulty: output.d_blend,
        previous_stability: old_stability,
        previous_stability_index: pre_s,
        previous_r_index: pre_r,
    };

    M3ReviewResult {
        stability: output.matrix_entry,
        retrievability,
        elapsed,
        d_blend: output.d_blend,
        next_item,
        committed: commit,
    }
}

fn interval_category(interval: i32) -> i32 {
    let interval = interval.max(1);
    let mut category = round_half_up((interval as f64).ln() / INTERVAL_AXIS_BASE.ln()) as i32 + 12;
    category = interval.min(category);
    category.clamp(1, 35)
}
