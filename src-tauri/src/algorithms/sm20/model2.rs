//! Model 2 — stateful SM-15/SM-16 classic optimizer (14% ensemble weight).
//!
//! The collection-wide SuperMemo optimizer behind `a651f0 -> a605a0` and the
//! local optimizer record behind `DAT_01135240`. `ClassicM2Optimizer` holds the
//! 0x49bc-byte collection state; `M2ItemState` is the small per-item part passed
//! through `a65600`.
//!
//! Live-validated against the running `sm20.exe` binary (34 isolated + 60
//! chained reviews, exact match). Every formula, constant and branch mirrors
//! the Python reconstruction in `sm20_model2.py`.
//!
//! Evidence: `[C][BIN]`

use serde::{Deserialize, Serialize};

use super::helpers::clamp;

// =============================================================================
// CONSTANTS
// =============================================================================

/// Target retention ratio R* used throughout SM-15/16.
const TARGET_R: f64 = 0.9;

/// Quantization scale for the unsigned-word record rounding (`_q`).
const SCALE: f64 = 1000.0;

/// Hard cap on cell/grade case counts.
const MAX_CASES: u32 = 60000;

// =============================================================================
// CORE MATH HELPERS (Delphi RTL parity)
// =============================================================================

/// `_q` — round `value` through the unsigned-word representation used by the
/// record: `clamp(round(value*scale), 0, 65535)/scale`. Delphi `Word` rounding.
fn q(value: f64, scale: f64) -> f64 {
    clamp(py_round_f(value * scale), 0.0, 65535.0) / scale
}

/// `_q` with the default `SCALE = 1000.0`.
#[inline]
fn q_default(value: f64) -> f64 {
    q(value, SCALE)
}

/// `_real48` — round a float through Delphi's 6-byte Real48 format. Required for
/// trained-matrix parity (the binary stores these matrices as Real48).
///
/// Mirrors Python's `math.frexp` + `math.ldexp` exactly by reading the IEEE-754
/// exponent field directly, so the mantissa rounding matches bit-for-bit.
fn real48(value: f64) -> f64 {
    if value == 0.0 {
        return 0.0;
    }
    let sign: f64 = if value < 0.0 { -1.0 } else { 1.0 };
    // math.frexp(|value|) -> (fraction in [0.5, 1.0), exponent) bit-exactly.
    let (fraction, frexp_exp) = frexp(value.abs());
    let mut exponent = frexp_exp - 1;
    // value = (1 + mantissa/2^39) * 2^exponent, where
    // mantissa = round((fraction*2 - 1) * 2^39).
    let mut mantissa = py_round((fraction * 2.0 - 1.0) * (1i64 << 39) as f64);
    if mantissa == 1i64 << 39 {
        mantissa = 0;
        exponent += 1;
    }
    if exponent + 129 <= 0 {
        return 0.0;
    }
    if exponent + 129 >= 255 {
        // Python raises OverflowError; unreachable for valid optimizer values.
        // Saturate to a large finite value rather than panic inside the scheduler.
        return sign * f64::MAX;
    }
    // math.ldexp(1.0 + mantissa/2^39, exponent)
    sign * (1.0 + (mantissa as f64) / (1i64 << 39) as f64) * 2f64.powi(exponent)
}

/// Bit-exact port of C/Python `frexp(x)`: returns `(fraction, exponent)` with
/// `x = fraction * 2^exponent`, `0.5 <= fraction < 1.0`. Works directly on the
/// IEEE-754 representation so it matches `math.frexp` bit-for-bit.
fn frexp(x: f64) -> (f64, i32) {
    // Subnormals and zero need special handling.
    if x.is_subnormal() || x == 0.0 || !x.is_finite() {
        // Fall back to the exact iterative method for subnormals (rare here).
        let mut e: i32 = 0;
        let mut f = x;
        while f >= 1.0 {
            f *= 0.5;
            e += 1;
        }
        while f < 0.5 {
            f *= 2.0;
            e -= 1;
        }
        return (f, e);
    }
    let bits = x.to_bits();
    // IEEE-754 double: sign(1) | exponent(11) | mantissa(52)
    let raw_exp = ((bits >> 52) & 0x7ff) as i32; // biased exponent
    let unbiased = raw_exp - 1023; // E such that x = 1.mantissa * 2^E
                                   // frexp wants fraction in [0.5, 1): set biased exponent to 1022 (=> 2^-1).
    let new_bits = (bits & !(0x7ff_u64 << 52)) | ((0x3fe_u64) << 52);
    let fraction = f64::from_bits(new_bits);
    (fraction, unbiased + 1)
}

/// Python 3 `round(x)` — round-half-to-even (banker's rounding), returning an
/// `i64`. Rust's `f64::round()` rounds half *away from zero*, which would break
/// `_q` quantization parity (e.g. `round(2485.5)` is `2486` in Python but `2486`
/// via away-from-zero too — yet `round(2484.5)` is `2484` in Python vs `2485`
/// away-from-zero). Every site that mirrors a Python `round()` call uses this.
fn py_round(x: f64) -> i64 {
    // Use libm's rint() which rounds according to the current rounding mode
    // (default round-to-nearest-ties-to-even), matching Python 3 semantics.
    let r = x.round_ties_even();
    // round_ties_even on f64 returns the nearest integer, ties to even.
    r as i64
}

/// Python 3 `round(x)` returning an `f64` (for sites that use the rounded value
/// in floating arithmetic, e.g. `_q`).
#[inline]
fn py_round_f(x: f64) -> f64 {
    x.round_ties_even()
}

/// `_weighted_linear` (FUN_0097bc90 / FUN_0097c2c0) — weighted slope and intercept.
///
/// Returns `(slope, intercept)`. When `plus_one` is true the per-sample weight is
/// `round(w) + 1.0`, otherwise `round(w) + 1e-5`.
fn weighted_linear(x: &[f64], y: &[f64], weights: &[f64], plus_one: bool) -> (f64, f64) {
    let mut w: Vec<f64> = Vec::with_capacity(weights.len());
    for &v in weights {
        let wi = if plus_one {
            py_round_f(v) + 1.0
        } else {
            py_round_f(v) + 1e-5
        };
        w.push(wi);
    }
    let total: f64 = w.iter().sum();
    let mean_x: f64 = x.iter().zip(w.iter()).map(|(a, c)| a * c).sum::<f64>() / total;
    let mean_y: f64 = y.iter().zip(w.iter()).map(|(b, c)| b * c).sum::<f64>() / total;
    let variance: f64 =
        x.iter().zip(w.iter()).map(|(a, c)| a * a * c).sum::<f64>() / total - mean_x * mean_x;
    if variance == 0.0 {
        return (0.0, mean_y);
    }
    let covariance: f64 = x
        .iter()
        .zip(y.iter())
        .zip(w.iter())
        .map(|((a, b), c)| a * b * c)
        .sum::<f64>()
        / total
        - mean_x * mean_y;
    let slope = covariance / variance;
    (slope, mean_y - mean_x * slope)
}

/// `_fixed_intercept_slope` (FUN_0097ba30 / FUN_0097c6d0) — least-squares slope
/// with a fixed intercept. Returns 0.0 if the denominator is zero.
fn fixed_intercept_slope(x: &[f64], y: &[f64], weights: &[f64], intercept: f64) -> f64 {
    let denominator: f64 = x.iter().zip(weights.iter()).map(|(a, w)| a * a * w).sum();
    if denominator == 0.0 {
        return 0.0;
    }
    let numerator: f64 = x
        .iter()
        .zip(y.iter())
        .zip(weights.iter())
        .map(|((a, b), w)| a * w * (b - intercept))
        .sum();
    numerator / denominator
}

// =============================================================================
// AXIS / BUCKET HELPERS
// =============================================================================

/// `a_axis` (FUN_00a610d0): 1.2, 1.5, ..., 6.9. `index` is 1-based.
fn a_axis(index: i32) -> f64 {
    1.2 + 0.3 * (index - 1) as f64
}

/// `a_bucket` (FUN_00a612c0): A-factor to a 1..=20 row.
fn a_bucket(a_factor: f64) -> i32 {
    let value = clamp(a_factor + 1e-6, 1.2, 10.0);
    20.min(((value - 1.2) / 0.3).floor() as i32 + 1)
}

/// `u_value` (FUN_00a5fdc0): value represented by a 1..=20 U-factor bin.
fn u_value(a_index: i32, repetition_index: i32, bin_index: i32) -> f64 {
    if repetition_index == 1 {
        return bin_index as f64;
    }
    bin_index as f64 * (a_axis(a_index).floor() / 20.0) + 1.0
}

/// `u_bucket` (FUN_00a5df30): observed U-factor to a 1..=20 bin.
fn u_bucket(a_index: i32, repetition_index: i32, value: f64) -> i32 {
    let low = u_value(a_index, repetition_index, 1);
    let high = u_value(a_index, repetition_index, 20);
    if high == low {
        return 1;
    }
    let bounded = clamp(value, low, high);
    py_round(((bounded - low) / (high - low)) * 19.0) as i32 + 1
}

/// `_fresh_optimum` (FUN_00a5d5e0), used by FUN_00a64fb0 for a new collection.
fn fresh_optimum(a_index: i32, repetition_index: i32) -> f64 {
    let axis = a_axis(a_index);
    if repetition_index == 1 {
        return (-0.057 * (a_index - 1) as f64 + 0.91).exp();
    }
    if repetition_index == 2 {
        return axis;
    }
    (axis - 1.2) / (repetition_index - 1) as f64 + 1.2
}

// =============================================================================
// DATA TYPES
// =============================================================================

/// Persistent per-item inputs used by the classic scheduler. `M2ItemState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct M2ItemState {
    pub last_review_day: i32,
    pub previous_interval: i32,
    pub repetitions: u32,
    pub lapses: u32,
    pub a_factor: f64,
    pub u_factor: f64,
}

impl Default for M2ItemState {
    /// Mirrors the Python dataclass defaults: `a_factor = 3.0`, `u_factor = 1.0`.
    fn default() -> Self {
        Self {
            last_review_day: -1,
            previous_interval: 0,
            repetitions: 0,
            lapses: 0,
            a_factor: 3.0,
            u_factor: 1.0,
        }
    }
}

/// Result of an M2 review. `M2ReviewResult`. `stability` is i32 because the
/// ensemble slots M1 and M2 as int32.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct M2ReviewResult {
    pub stability: i32,
    pub used_interval: i32,
    pub adjusted_used_interval: i32,
    pub repetition_stage: f64,
    pub new_a_factor: f64,
    pub new_u_factor: f64,
    pub repetitions: u32,
    pub lapses: u32,
    pub next_item: M2ItemState,
}

/// The 0x49bc-byte collection optimizer represented as typed arrays.
/// `ClassicM2Optimizer`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassicM2Optimizer {
    /// +0x000: generated optimum-factor matrix [20][20], row-major (A-1, R-1).
    pub matrix: Box<[[f64; 20]; 20]>,
    /// +0x2f6: empirical optimum factors [20][20].
    pub empirical: Box<[[f64; 20]; 20]>,
    /// +0x616: case counts for each (A,R) cell [20][20].
    pub cell_cases: Box<[[u32; 20]; 20]>,
    /// +0x807: remembered (pass) observations by U bin [20][20][20].
    pub remembered: Box<[[[u32; 20]; 20]; 20]>,
    /// +0x2747: total observations by U bin [20][20][20].
    pub observed: Box<[[[u32; 20]; 20]; 20]>,
    /// +0x95c: per-row decay exponent [20].
    pub row_exponent: Box<[f64; 20]>,
    /// +0x982: per-row regression weight [20].
    pub row_weight: Box<[u32; 20]>,
    /// +0x4826: grade graph used to infer an A-factor [20].
    pub first_grade: Box<[f64; 20]>,
    /// +0x48a2: case counts for the first-grade graph [20].
    pub first_grade_cases: Box<[u32; 20]>,
    /// +0x48c6: grade by forgetting-index graph [18].
    pub second_grade: Box<[f64; 18]>,
    /// +0x497e: case counts for the second-grade graph [18].
    pub second_grade_cases: Box<[u32; 18]>,
}

impl Default for ClassicM2Optimizer {
    fn default() -> Self {
        fresh_optimizer()
    }
}

impl PartialEq for ClassicM2Optimizer {
    fn eq(&self, other: &Self) -> bool {
        self.matrix == other.matrix
            && self.empirical == other.empirical
            && self.cell_cases == other.cell_cases
            && self.remembered == other.remembered
            && self.observed == other.observed
            && self.row_exponent == other.row_exponent
            && self.row_weight == other.row_weight
            && self.first_grade == other.first_grade
            && self.first_grade_cases == other.first_grade_cases
            && self.second_grade == other.second_grade
            && self.second_grade_cases == other.second_grade_cases
    }
}

/// The fresh-state `second_grade` initializer literal (1-based forgetting-index
/// graph, 18 entries).
const SECOND_GRADE_INIT: [f64; 18] = [
    4.8, 4.7, 4.6, 4.5, 4.4, 4.3, 4.2, 4.1, 4.0, 3.95, 3.9, 3.8, 3.74, 3.65, 3.55, 3.48, 3.39, 3.3,
];

impl ClassicM2Optimizer {
    /// Alias for new() — matches naming used by mod.rs and review.rs.
    pub fn fresh() -> Self {
        Self::new()
    }

    /// Construct a fresh optimizer with all default matrices. `__init__`.
    pub fn new() -> Self {
        // +0x000 / +0x2f6: matrix and empirical seeded from fresh_optimum.
        let mut matrix = Box::new([[0.0f64; 20]; 20]);
        let mut empirical = Box::new([[0.0f64; 20]; 20]);
        for a in 0..20 {
            for r in 0..20 {
                let v = q_default(fresh_optimum((a + 1) as i32, (r + 1) as i32));
                matrix[a][r] = v;
                empirical[a][r] = v;
            }
        }
        let cell_cases = Box::new([[0u32; 20]; 20]);
        let remembered = Box::new([[[0u32; 20]; 20]; 20]);
        let observed = Box::new([[[0u32; 20]; 20]; 20]);
        let row_exponent = Box::new([1.0f64; 20]);
        let row_weight = Box::new([1u32; 20]);

        // +0x4826: first_grade seeded from 5.2 - exp(-0.67*axis + 2.4), clamped + Real48.
        let mut first_grade = Box::new([0.0f64; 20]);
        for i in 0..20 {
            let axis = a_axis((i + 1) as i32);
            first_grade[i] = real48(clamp(5.2 - (-0.67 * axis + 2.4).exp(), 0.0, 5.0));
        }
        let first_grade_cases = Box::new([1u32; 20]);

        // +0x48c6: second_grade seeded from the literal table via Real48.
        let mut second_grade = Box::new([0.0f64; 18]);
        for i in 0..18 {
            second_grade[i] = real48(SECOND_GRADE_INIT[i]);
        }
        let second_grade_cases = Box::new([1u32; 18]);

        Self {
            matrix,
            empirical,
            cell_cases,
            remembered,
            observed,
            row_exponent,
            row_weight,
            first_grade,
            first_grade_cases,
            second_grade,
            second_grade_cases,
        }
    }

    /// `interpolate` (FUN_00a5e650): interpolate a generated matrix row.
    /// `row` is 1-based.
    pub fn interpolate(&self, row: i32, repetition_stage: f64) -> f64 {
        let stage = 20.0_f64.min(repetition_stage);
        let lower = (1.0f64.max(20.0f64.min(stage.floor()))).max(1.0) as i32;
        let lower = lower.min(20);
        let upper = (lower + 1).min(20);
        let left = self.matrix[(row - 1) as usize][(lower - 1) as usize];
        let right = self.matrix[(row - 1) as usize][(upper - 1) as usize];
        left + (stage - lower as f64) * (right - left)
    }

    /// `repetition_stage` (FUN_00a600b0): map an interval onto the current matrix row.
    pub fn repetition_stage(&self, used_interval: i32, a_factor: f64) -> f64 {
        let init = self.matrix[0][0];
        let mut previous = init;
        let mut current = init;
        let mut stage: i32 = 2;
        let row = a_bucket(a_factor);
        // Python: `while current < used_interval and stage < 20:` — float vs int
        // comparison done at full float precision (Python does not truncate).
        while current < used_interval as f64 && stage < 20 {
            previous = current;
            current *= self.matrix[(row - 1) as usize][(stage - 1) as usize];
            stage += 1;
        }
        let result = if stage < 3 || current == previous {
            1.0
        } else {
            (stage - 2) as f64 + (used_interval as f64 - previous) / (current - previous)
        };
        clamp(result, 2.0, 20.0)
    }

    /// `_forgetting_rate` (FUN_00a5e140): fit log(recall) against the U-factor bins.
    /// Returns the positive decay rate in exp(-rate * U).
    fn forgetting_rate(&self, row: i32, repetition: i32) -> f64 {
        let ri = (row - 1) as usize;
        let ci = (repetition - 1) as usize;
        if self.cell_cases[ri][ci] == 0 {
            return -TARGET_R.ln() / self.empirical[ri][ci];
        }
        let mut x: Vec<f64> = Vec::with_capacity(20);
        let mut y: Vec<f64> = Vec::with_capacity(20);
        let mut weights: Vec<f64> = Vec::with_capacity(20);
        for bin_index in 1..=20 {
            let total = self.observed[ri][ci][(bin_index - 1) as usize];
            let success = self.remembered[ri][ci][(bin_index - 1) as usize];
            x.push(u_value(row, repetition, bin_index));
            weights.push(total as f64);
            if total == 0 {
                y.push(0.0);
            } else if success == 0 {
                y.push(-3.0);
            } else {
                // Python: max(-3.0, log(success/total)). NB: unary minus binds
                // looser than `.max()` in Rust, so the literal must be parenthesized.
                y.push(((-3.0_f64).max((success as f64 / total as f64).ln())));
            }
        }
        -fixed_intercept_slope(&x, &y, &weights, 0.0)
    }

    /// `_rebuild` (FUN_00a5eff0): rebuild the generated matrix from empirical data.
    pub fn rebuild(&mut self) {
        // FUN_00a5ee40: regress the first column over A rows.
        let x: Vec<f64> = (0..20).map(|i| i as f64).collect(); // i-1 for i in 1..=20
        let y: Vec<f64> = (0..20)
            .map(|i| self.empirical[i][0].max(1e-300).ln())
            .collect();
        // a60330 pre-adds one case, then 97bc90 adds one again while fitting.
        let weights: Vec<f64> = (0..20)
            .map(|i| self.cell_cases[i][0] as f64 + 1.0)
            .collect();
        let (slope, intercept) = weighted_linear(&x, &y, &weights, true);
        for i in 0..20 {
            self.matrix[i][0] = q_default(clamp((slope * i as f64 + intercept).exp(), 1.0, 20.0));
        }

        // FUN_00a5d770: fit each A row's power-decay exponent.
        for row in 2..=20 {
            let mut xs: Vec<f64> = Vec::with_capacity(18);
            let mut ys: Vec<f64> = Vec::with_capacity(18);
            let mut ws: Vec<f64> = Vec::with_capacity(18);
            for repetition in 3..=20 {
                xs.push((repetition as f64 - 1.0).ln());
                let optimum = self.empirical[(row - 1) as usize][(repetition - 1) as usize];
                let transformed = if optimum <= 1.21 {
                    -10000.0
                } else {
                    (optimum - 1.2).ln()
                };
                ys.push(clamp(transformed, -4.0, 4.0));
                ws.push(self.cell_cases[(row - 1) as usize][(repetition - 1) as usize] as f64);
            }
            if !ws.iter().any(|&w| w > 0.0) {
                let last = ws.len() - 1;
                ws[last] = 1.0;
            }
            let fixed_intercept = (a_axis(row) - 1.2).ln();
            let exponent = clamp(
                -fixed_intercept_slope(&xs, &ys, &ws, fixed_intercept),
                0.0,
                3.0,
            );
            self.row_exponent[(row - 1) as usize] = py_round_f(exponent * 10000.0) / 10000.0;
            self.row_weight[(row - 1) as usize] =
                MAX_CASES.min(ws.iter().map(|w| py_round_f(*w) as u32).sum::<u32>());
        }

        // FUN_00a64350: smooth the row exponents with a weighted line.
        let rows: Vec<i32> = (2..=20).collect();
        // a64350 prepends a fixed (A=1.2, exponent=1, weight=1) anchor.
        let mut x: Vec<f64> = Vec::with_capacity(20);
        let mut y: Vec<f64> = Vec::with_capacity(20);
        let mut weights: Vec<f64> = Vec::with_capacity(20);
        x.push(1.2);
        y.push(1.0);
        weights.push(1.0);
        for &i in &rows {
            x.push(a_axis(i));
            y.push(self.row_exponent[(i - 1) as usize]);
            weights.push(self.row_weight[(i - 1) as usize] as f64);
        }
        let (mut decay_slope, mut decay_intercept) = weighted_linear(&x, &y, &weights, false);
        if decay_slope < -0.5 || decay_slope > 0.5 {
            let anchor = decay_slope * 3.6 + decay_intercept;
            decay_slope = clamp(decay_slope, -0.5, 0.5);
            decay_intercept = anchor - decay_slope * 3.6;
        }

        // FUN_00a5dd20: fill columns 2..20 from the fitted decay curve.
        for row in 2..=20 {
            let axis = a_axis(row);
            let exponent = clamp(decay_slope * axis + decay_intercept, 0.0, 3.0);
            for repetition in 2..=20 {
                let factor = (repetition as f64 - 1.0).powf(-exponent);
                self.matrix[(row - 1) as usize][(repetition - 1) as usize] =
                    q_default(factor * (axis - 1.2) + 1.2);
            }
        }
    }

    /// `_record` (FUN_00a67640): update one local optimizer cell and rebuild it.
    pub fn record<R: rand::Rng>(
        &mut self,
        row: i32,
        repetition: i32,
        observed_u: f64,
        remembered: bool,
        rng: &mut R,
    ) {
        let bin_index = u_bucket(row, repetition, observed_u);
        let ri = (row - 1) as usize;
        let ci = (repetition - 1) as usize;
        let bi = (bin_index - 1) as usize;

        // At the capped U bin, a lapse can probabilistically count as remembered
        // when it occurred beyond the represented range (the binary's tail fix).
        let mut effective_remembered = remembered;
        if bin_index == 20 && !remembered {
            let rate = self.forgetting_rate(row, repetition);
            let represented_r = (-rate * u_value(row, repetition, 20)).exp();
            let actual_r = (-rate * observed_u).exp();
            if rng.gen::<f64>() < represented_r - actual_r {
                effective_remembered = true;
            }
        }

        if effective_remembered {
            self.remembered[ri][ci][bi] = 255u32.min(self.remembered[ri][ci][bi] + 1);
        }
        self.observed[ri][ci][bi] = 255u32.min(self.observed[ri][ci][bi] + 1);
        if self.observed[ri][ci][bi] > 250 {
            self.observed[ri][ci][bi] >>= 1;
            self.remembered[ri][ci][bi] >>= 1;
        }
        self.cell_cases[ri][ci] = MAX_CASES.min(self.cell_cases[ri][ci] + 1);

        let rate = self.forgetting_rate(row, repetition);
        let optimum = if rate == 0.0 {
            u_value(row, repetition, 20)
        } else {
            -TARGET_R.ln() / rate
        };
        let optimum = if repetition == 1 {
            clamp(optimum, 1.0, 20.0)
        } else {
            clamp(optimum, 1.2, a_axis(row))
        };
        self.empirical[ri][ci] = q_default(optimum);
        self.rebuild();
    }

    /// `_grade_fit`: fit the grade-by-forgetting-index graph.
    fn grade_fit(&self) -> (f64, f64) {
        let x: Vec<f64> = (3..=20).map(|i| i as f64).collect();
        let y: Vec<f64> = self
            .second_grade
            .iter()
            .map(|&value| (-5.0f64).max(value.max(1e-300).ln()))
            .collect();
        weighted_linear(
            &x,
            &y,
            &self
                .second_grade_cases
                .iter()
                .map(|&c| c as f64)
                .collect::<Vec<_>>(),
            true,
        )
    }

    /// `_first_grade_fit`: fit the first-grade graph. Slope is clamped to <= 0.
    fn first_grade_fit(&self) -> (f64, f64) {
        let x: Vec<f64> = (1..=20).map(|i| a_axis(i)).collect();
        let y: Vec<f64> = self
            .first_grade
            .iter()
            .map(|&v| (5.2 - clamp(v, 0.0, 5.0)).max(1e-300).ln())
            .collect();
        let (slope, intercept) = weighted_linear(
            &x,
            &y,
            &self
                .first_grade_cases
                .iter()
                .map(|&c| c as f64)
                .collect::<Vec<_>>(),
            true,
        );
        (0.0f64.min(slope), intercept)
    }

    /// `_grade_at` (static): evaluate the grade curve at a forgetting index.
    fn grade_at(value: f64, slope: f64, intercept: f64) -> f64 {
        clamp(
            (clamp(slope * value + intercept, -38.0, 38.0)).exp(),
            0.1,
            5.0,
        )
    }

    /// `_forgetting_index_for_grade`: invert the grade curve to a forgetting index.
    fn forgetting_index_for_grade(&self, grade: f64, slope: f64, intercept: f64) -> f64 {
        if slope == 0.0 {
            return 50.0;
        }
        let value = (grade.max(0.3).ln() - intercept) / slope;
        clamp(value, 0.2, 90.0)
    }

    /// `_predicted_fi`: predicted forgetting index for the current state.
    fn predicted_fi(
        &self,
        old_repetitions: u32,
        old_lapses: u32,
        old_a: f64,
        stage: f64,
        observed_u: f64,
    ) -> f64 {
        let optimum = if old_repetitions == 1 {
            self.matrix[(20_i32.min(old_lapses as i32 + 1) - 1) as usize][0]
        } else {
            self.interpolate(a_bucket(old_a), stage)
        };
        let retrievability = ((observed_u / optimum) * TARGET_R.ln()).exp();
        clamp((1.0 - retrievability) * 100.0, 0.1, 99.5)
    }

    /// `_a_from_first_grade`: invert the first-grade curve to an A-factor.
    fn a_from_first_grade(&self, grade_value: f64) -> f64 {
        let (slope, intercept) = self.first_grade_fit();
        if slope == 0.0 {
            return 6.9;
        }
        clamp(((5.2 - grade_value).ln() - intercept) / slope, 1.2, 6.9)
    }

    /// `_new_a_factor` (FUN_00a63010 + FUN_00a62ce0).
    /// Returns `(new_a, predicted_fi, fitted_grade)`.
    pub fn new_a_factor(
        &self,
        item: &M2ItemState,
        grade: i32,
        used_interval: i32,
        observed_u: f64,
        stage: f64,
    ) -> (f64, f64, f64) {
        if item.repetitions == 0 {
            return (
                ((grade as f64 - 4.0) * 0.3 + 3.0) * 0.6 + 0.4 * item.a_factor,
                10.0,
                4.0,
            );
        }

        let (slope, intercept) = self.grade_fit();
        let predicted_fi = self.predicted_fi(
            item.repetitions,
            item.lapses,
            item.a_factor,
            stage,
            observed_u,
        );
        let inferred_fi = self.forgetting_index_for_grade(grade as f64, slope, intercept);

        let g10 = Self::grade_at(10.0, slope, intercept);
        let g_predicted = Self::grade_at(predicted_fi, slope, intercept);
        let c1 = Self::grade_at((inferred_fi / predicted_fi) * 10.0, slope, intercept);
        let c2 = Self::grade_at(inferred_fi + 10.0 - predicted_fi, slope, intercept);
        let c3 = grade as f64 * (g10 / g_predicted);
        let c4 = g10 + (grade as f64 - g_predicted);
        let mut fitted_grade = clamp((c1 + c2 + c3 + c4) * 0.25, 0.0, 5.0);
        fitted_grade = if grade < 3 {
            fitted_grade.min(2.5)
        } else {
            fitted_grade.max(2.5)
        };

        let new_a = if item.repetitions == 1 && item.lapses == 0 {
            0.85 * self.a_from_first_grade(fitted_grade) + 0.15 * item.a_factor
        } else if item.repetitions == 1 {
            0.4 * ((grade as f64 - 4.0) * 0.3 + 3.0) + 0.6 * item.a_factor
        } else {
            let denominator = (1.0 - inferred_fi / 100.0).ln();
            let target_interval = if denominator == 0.0 {
                used_interval as f64
            } else {
                used_interval as f64 * TARGET_R.ln() / denominator
            };
            let target_u = (target_interval / used_interval as f64) * observed_u;
            let mut row: i32 = 20;
            while row > 0 && self.interpolate(row, stage) >= target_u {
                row -= 1;
            }
            let estimated_a = a_axis(1.max(row));
            0.4 * estimated_a + 0.6 * item.a_factor
        };
        (new_a, predicted_fi, fitted_grade)
    }

    /// `_update_grade_graphs` (FUN_00a5e8a0 + FUN_00a639c0).
    pub fn update_grade_graphs(
        &mut self,
        new_a: f64,
        predicted_fi: f64,
        grade: i32,
        old_repetitions: u32,
        old_lapses: u32,
    ) {
        // FUN_00a5e8a0: grade by forgetting-index graph.
        // Python: index = min(18, max(1, round(predicted_fi))) - 1
        let index = ((18_i32.min(1_i32.max(py_round(predicted_fi) as i32)) - 1).max(0)) as usize;
        self.second_grade_cases[index] = MAX_CASES.min(self.second_grade_cases[index] + 1);
        let count = self.second_grade_cases[index];
        let alpha = 1.0 / (10.0 * (count as f64 + 2.0).ln());
        self.second_grade[index] =
            real48(self.second_grade[index] * (1.0 - alpha) + alpha * grade as f64);

        // FUN_00a639c0: first-grade graph; excludes a first clean repetition.
        if old_repetitions != 0 && !(old_repetitions == 1 && old_lapses == 0) && grade < 6 {
            let row = (a_bucket(new_a) - 1) as usize;
            self.first_grade_cases[row] = MAX_CASES.min(self.first_grade_cases[row] + 1);
            let alpha = if old_repetitions == 2 { 0.15 } else { 0.07 };
            self.first_grade[row] = real48(clamp(
                (1.0 - alpha) * self.first_grade[row] + alpha * grade as f64,
                0.0,
                5.0,
            ));
        }
    }

    /// `_correct_early_factor` (FUN_00a60980): compensate when a review occurs
    /// before its due day. Returns `(corrected_factor, adjusted_used)`.
    pub fn correct_early_factor(factor: f64, scheduled: i32, used: i32) -> (f64, i32) {
        if used >= scheduled {
            return (factor, used);
        }
        let difference = (scheduled - used) as f64;
        let previous = (scheduled - 1) as f64;
        let correction_scale = scheduled as f64 * 0.4;
        let candidate = ((factor - 1.0) * (previous + correction_scale)) / previous;
        let deduction = (candidate * difference) / (correction_scale + difference);
        let corrected = factor.min(factor - deduction);
        let adjusted_used = py_round((scheduled as f64 * corrected) / factor) as i32;
        (corrected, scheduled.min(used.max(adjusted_used)))
    }

    /// `review` — run the local equivalent of `a65600 -> a651f0 -> a605a0`.
    ///
    /// `commit = false` mirrors the binary's scratch-record prediction (a deep
    /// clone is used so the optimizer is not mutated). With `commit = true` the
    /// collection optimizer learns from this review. The returned
    /// `next_item.previous_interval` is deliberately left at zero; the ensemble's
    /// final due interval must be assigned after all five model slots are blended.
    pub fn review<R: rand::Rng>(
        &mut self,
        item: &M2ItemState,
        today: i32,
        grade: i32,
        forgetting_index: u32,
        commit: bool,
        rng: &mut R,
    ) -> M2ReviewResult {
        assert!((0..=5).contains(&grade), "grade must be in 0..=5");

        // commit=false -> operate on a scratch clone; commit=true -> mutate self.
        if !commit {
            let mut scratch = self.clone();
            return scratch.review_inner(item, today, grade, forgetting_index, rng);
        }
        self.review_inner(item, today, grade, forgetting_index, rng)
    }

    /// Inner review body that mutates the receiver. Split out so the `commit=false`
    /// path can run on the scratch clone without re-cloning.
    fn review_inner<R: rand::Rng>(
        &mut self,
        item: &M2ItemState,
        today: i32,
        grade: i32,
        forgetting_index: u32,
        rng: &mut R,
    ) -> M2ReviewResult {
        let mut used: i32 = if item.last_review_day < 0 {
            0
        } else {
            1_i32.max(today - item.last_review_day)
        };
        let remembered = grade >= 3;
        let (new_repetitions, new_lapses) = if remembered {
            (20_u32.min(item.repetitions + 1), 19_u32.min(item.lapses))
        } else {
            let lapses = if item.repetitions == 0 {
                0
            } else {
                19_u32.min(item.lapses + 1)
            };
            (1, lapses)
        };

        let mut stage: f64 = 1.0;
        let mut observed_u: f64 = item.u_factor;
        if item.repetitions != 0 {
            let scheduled = 1_i32.max(item.previous_interval);
            used = 1_i32.max(used);
            observed_u = (used as f64 / scheduled as f64) * item.u_factor;
            stage = self.repetition_stage(used, item.a_factor);
            let row = if item.repetitions == 1 {
                20_i32.min(item.lapses as i32 + 1)
            } else {
                a_bucket(item.a_factor)
            };
            let repetition = if item.repetitions == 1 {
                1
            } else {
                20_i32.min(1_i32.max(py_round(stage) as i32))
            };
            self.record(row, repetition, observed_u, remembered, rng);
        }

        let used_for_new_a = 1_i32.max(used);
        let (new_a, predicted_fi, _fitted) =
            self.new_a_factor(item, grade, used_for_new_a, observed_u, stage);

        let mut adjusted_used: i32 = 1_i32.max(used);
        let base: f64;
        if new_repetitions == 1 {
            base = self.matrix[(20_i32.min(new_lapses as i32 + 1) - 1) as usize][0];
        } else {
            let factor = self.interpolate(a_bucket(new_a), stage + 1.0);
            let (factor, au) = Self::correct_early_factor(
                factor,
                1_i32.max(item.previous_interval),
                1_i32.max(used),
            );
            adjusted_used = au;
            let prev_max = (1_i32.max(item.previous_interval) as f64).max(1_i32.max(used) as f64);
            base = prev_max * factor;
        }

        let fi_factor = (1.0 - forgetting_index as f64 / 100.0).ln() / TARGET_R.ln();
        let stability = 1_i32.max(py_round(base * fi_factor) as i32);
        let new_u = if new_repetitions == 1 {
            stability as f64
        } else {
            1.0_f64.max(stability as f64 / adjusted_used as f64)
        };
        if item.repetitions != 0 {
            self.update_grade_graphs(new_a, predicted_fi, grade, item.repetitions, item.lapses);
        }

        let next_item = M2ItemState {
            last_review_day: today,
            previous_interval: 0,
            repetitions: new_repetitions,
            lapses: new_lapses,
            a_factor: new_a,
            u_factor: new_u,
        };
        M2ReviewResult {
            stability,
            used_interval: used,
            adjusted_used_interval: adjusted_used,
            repetition_stage: stage,
            new_a_factor: new_a,
            new_u_factor: new_u,
            repetitions: new_repetitions,
            lapses: new_lapses,
            next_item,
        }
    }
}

/// Create a fresh optimizer with default matrices. Convenience constructor.
pub fn fresh_optimizer() -> ClassicM2Optimizer {
    ClassicM2Optimizer::new()
}

/// Convenience entry point for the reconstructed M2 model.
///
/// Runs one M2 review. `commit = false` performs a non-mutating scratch
/// prediction; `commit = true` learns from the review (mutating `optimizer`).
pub fn model_2<R: rand::Rng>(
    item: &M2ItemState,
    optimizer: &mut ClassicM2Optimizer,
    today: i32,
    grade: i32,
    forgetting_index: u32,
    commit: bool,
    rng: &mut R,
) -> M2ReviewResult {
    optimizer.review(item, today, grade, forgetting_index, commit, rng)
}

// =============================================================================
// TESTS — pinned against `sm20_model2.py` reference output
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    /// Python: `random.Random(0)` is used when no rng is supplied. We seed the
    /// StdRng with 0 here; note Rust's StdRng is a different PRNG than Python's
    /// Mersenne Twister, so the probabilistic tail-fix branch is exercised but
    /// the exact random draw differs. The live-validated scenarios use seeded
    /// RNG only in the `_record` tail path; the deterministic paths (which cover
    /// the validated vectors) are independent of the RNG stream.
    fn seeded_rng() -> StdRng {
        StdRng::seed_from_u64(0)
    }

    #[test]
    fn fresh_optimizer_first_cell_matches_python() {
        // matrix[0][0] = q(fresh_optimum(1,1)) = q(exp(-0.057*0 + 0.91))
        let opt = fresh_optimizer();
        let expected = q_default(fresh_optimum(1, 1));
        assert!((opt.matrix[0][0] - expected).abs() < 1e-12);
        assert!((opt.empirical[0][0] - expected).abs() < 1e-12);
    }

    #[test]
    fn a_axis_sequence() {
        assert!((a_axis(1) - 1.2).abs() < 1e-12);
        assert!((a_axis(2) - 1.5).abs() < 1e-12);
        assert!((a_axis(20) - 6.9).abs() < 1e-12);
    }

    #[test]
    fn a_bucket_clamps_to_20() {
        assert_eq!(a_bucket(1.2), 1);
        assert_eq!(a_bucket(10.0), 20);
        assert_eq!(a_bucket(100.0), 20); // clamped
    }

    #[test]
    fn u_value_repetition_one_is_bin_index() {
        for b in 1..=20 {
            assert!((u_value(5, 1, b) - b as f64).abs() < 1e-12);
        }
    }

    #[test]
    fn real48_zero_and_known() {
        assert_eq!(real48(0.0), 0.0);
        // A small positive value round-trips within Real48 precision.
        let v = 5.2_f64 - (-0.67f64 * 1.2f64 + 2.4f64).exp();
        let r = real48(clamp(v, 0.0, 5.0));
        assert!(r.is_finite() && r >= 0.0);
    }

    #[test]
    fn second_grade_init_is_real48_of_literal() {
        let opt = fresh_optimizer();
        for i in 0..18 {
            let expected = real48(SECOND_GRADE_INIT[i]);
            assert!((opt.second_grade[i] - expected).abs() < 1e-12, "idx {i}");
        }
    }

    /// The validated chained scenario from `sm20_model2.py`'s `__main__` block.
    /// These are the exact stability / A / U / reps / lapses values emitted by
    /// the Python reference, which was itself live-validated against sm20.exe.
    #[test]
    fn chained_scenario_matches_python_reference() {
        let mut opt = fresh_optimizer();
        let mut item = M2ItemState::default();
        // (day, grade, expected stability, expected A, expected U, reps, lapses)
        let expected: [(i32, i32, i32, f64, f64, u32, u32); 5] = [
            (0, 4, 2, 3.0000, 2.0000, 1, 0),
            (3, 4, 6, 3.0113, 2.0000, 2, 0),
            (12, 3, 15, 2.2868, 1.6667, 3, 0),
            (20, 2, 4, 1.8521, 4.0000, 1, 1),
            (22, 4, 4, 2.3112, 1.3333, 2, 1),
        ];
        for (i, &(day, grade, m2, a, u, reps, lapses)) in expected.iter().enumerate() {
            let mut rng = seeded_rng();
            let mut result = opt.review(&item, day, grade, 10, true, &mut rng);
            assert_eq!(
                result.stability, m2,
                "step {i}: stability {} != expected {m2}",
                result.stability
            );
            assert!(
                (result.new_a_factor - a).abs() < 5e-4,
                "step {i}: A-factor {} != expected {a}",
                result.new_a_factor
            );
            assert!(
                (result.new_u_factor - u).abs() < 5e-4,
                "step {i}: U-factor {} != expected {u}",
                result.new_u_factor
            );
            assert_eq!(result.repetitions, reps, "step {i}: reps");
            assert_eq!(result.lapses, lapses, "step {i}: lapses");
            // Mirror the Python demo: assign final ensemble interval to previous_interval.
            result.next_item.previous_interval = result.stability;
            item = result.next_item;
        }
    }

    /// `commit = false` must not mutate the optimizer.
    #[test]
    fn non_commit_review_does_not_mutate_optimizer() {
        let mut opt = fresh_optimizer();
        let snapshot = opt.clone();
        let item = M2ItemState {
            last_review_day: 0,
            previous_interval: 2,
            repetitions: 2,
            lapses: 0,
            a_factor: 3.0,
            u_factor: 2.0,
        };
        let mut rng = seeded_rng();
        let _ = opt.review(&item, 5, 4, 10, false, &mut rng);
        assert_eq!(opt, snapshot, "optimizer mutated despite commit=false");
    }

    /// `commit = true` must mutate the optimizer (cell cases grow).
    #[test]
    fn commit_review_mutates_optimizer() {
        let mut opt = fresh_optimizer();
        let before = opt.clone();
        let item = M2ItemState {
            last_review_day: 0,
            previous_interval: 2,
            repetitions: 2,
            lapses: 0,
            a_factor: 3.0,
            u_factor: 2.0,
        };
        let mut rng = seeded_rng();
        let _ = opt.review(&item, 5, 4, 10, true, &mut rng);
        assert_ne!(opt, before, "optimizer did not mutate despite commit=true");
    }

    /// First review (repetitions == 0) uses the closed-form A-factor path.
    #[test]
    fn first_review_uses_closed_form_a_factor() {
        let mut opt = fresh_optimizer();
        let item = M2ItemState::default();
        let mut rng = seeded_rng();
        let r = opt.review(&item, 0, 4, 10, false, &mut rng);
        // ((4 - 4) * 0.3 + 3.0) * 0.6 + 0.4 * 3.0 = 1.8 + 1.2 = 3.0
        assert!((r.new_a_factor - 3.0).abs() < 1e-12);
        assert_eq!(r.repetitions, 1);
    }

    #[test]
    fn model_2_entry_point_matches_review() {
        let mut opt1 = fresh_optimizer();
        let mut opt2 = fresh_optimizer();
        let item = M2ItemState::default();
        let mut rng1 = seeded_rng();
        let mut rng2 = seeded_rng();
        let a = model_2(&item, &mut opt1, 0, 4, 10, true, &mut rng1);
        let b = opt2.review(&item, 0, 4, 10, true, &mut rng2);
        assert_eq!(a, b);
    }

    #[test]
    fn q_clamps_to_word_range() {
        assert_eq!(q(70.0, 1000.0), 65.535); // 70000 -> 65535/1000
        assert_eq!(q(-1.0, 1000.0), 0.0);
        assert_eq!(q(0.0015, 1000.0), 0.002); // round(1.5) = 2 (banker's? Python uses round-half-to-even)
    }

    #[test]
    fn correct_early_factor_no_correction_when_used_ge_scheduled() {
        let (f, u) = ClassicM2Optimizer::correct_early_factor(2.5, 10, 10);
        assert!((f - 2.5).abs() < 1e-12);
        assert_eq!(u, 10);
        let (f, u) = ClassicM2Optimizer::correct_early_factor(2.5, 10, 12);
        assert!((f - 2.5).abs() < 1e-12);
        assert_eq!(u, 12);
    }
}
