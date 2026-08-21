//! Model 4 — the 35-parameter FSRS review kernel (25% ensemble weight).
//!
//! `FUN_00af9420` — the novel 3-expert forgetting-curve mixture model that
//! SM-20 adds over SM-18. Every formula is decoded line-for-line from
//! Ghidra-decompiled C, with the two most critical formulas additionally
//! verified against raw x86-64 assembly.
//!
//! Evidence: `[C][ASM][BIN]`
//!
//! Call graph:
//! ```text
//! review_kernel(t, grade, D, S)
//!   1. A = expert_mixture(t, S, D)          — predicted recall probability
//!   2. D_new = difficulty_update(D, S, A)   — adjust difficulty
//!   3. S_new = stability_update(D_new, S, A, t, grade)
//!        ├─ grade < 3 → lapse_stability
//!        └─ grade ≥ 3 → recall_stability
//! ```

use super::helpers::*;

// =============================================================================
// CONSTANTS — 35 doubles at VA 0x10cad90 [BIN]
// ============================================================================

/// The 35 FSRS parameters, read directly from the binary's `.data` section.
pub const P: [f64; 35] = [
    0.9286298950420208,  // [0]  expert1 power-law base (P0)
    347.85204578386566,  // [1]  mixture weight: S denominator
    0.30270230764837086, // [2]  mixture weight: D denominator for w1
    0.4078726801204931,  // [3]  mixture weight: D denominator for w2
    767.8438603670941,   // [4]  mixture weight: S denominator for w3
    7.894742385544259,   // [5]  init_s default
    4.08242569493503,    // [6]  init_s[0]
    1.996431220980246,   // [7]  init_s[1]
    9.170585471775675,   // [8]  init_s[2]
    1.1425608073008684,  // [9]  init_s[3]
    17.65771045770738,   // [10] init_s[4]
    77.77877780253718,   // [11] init_s[5]
    0.5921926894783989,  // [12] init_d default
    0.6895479373487655,  // [13] init_d[0]
    0.6472785530963361,  // [14] init_d[1]
    0.4208423230793679,  // [15] init_d[2]
    0.5186353666458963,  // [16] init_d[3]
    0.27244747048223983, // [17] init_d[4]
    0.3261492383691367,  // [18] init_d[5]
    1.680034668443124,   // [19] lapse stability: base scale
    5.928185533585771,   // [20] lapse stability: S weight denominator
    2.0150955428514656,  // [21] lapse stability: S multiplier
    0.2555216135743039,  // [22] lapse stability: retrov denominator
    1.9926553104343092,  // [23] lapse stability: retrov multiplier
    95.04137758278812,   // [24] difficulty update: S weight denominator
    42.21989471200275,   // [25] recall stability: blend high (easy)
    3.1089639864486682,  // [26] recall stability: blend low (hard)
    1.3558071518966488,  // [27] recall stability: base factor
    0.9250460852489478,  // [28] recall stability: hard bonus base
    0.8538692150895362,  // [29] recall stability: hard bonus weight
    0.9559110660552212,  // [30] recall stability: hard bonus ratio denom
    -0.6915519353695037, // [31] recall stability: time exponent
    1.0037797256248404,  // [32] recall stability: recall signal D coefficient
    1.393910494789472,   // [33] recall stability: recall signal offset
    0.12374729387559685, // [34] recall stability: grade multiplier
];

// Embedded .text constants [BIN]
const DAT_ZERO: f64 = 0.0;
const DAT_ONE: f64 = 1.0;
const DAT_0_9: f64 = 0.9;
const DAT_2_0: f64 = 2.0;
const DAT_ONE_SHIFT: f64 = 1.0;
const DAT_DECAY: f64 = 0.10536051565782628; // = ln(10/9) = -ln(0.9)

// Derived constants
#[allow(dead_code)]
const LN_2: f64 = 0.6931471805599453; // ln(2)
/// ln(0.9)/ln(2), as the f64 the binary computes at runtime (the previous
/// literal `-0.15200309344505` parsed to the neighboring f64, 1 ulp off).
const LOG2_09: f64 = -0.15200309344504997;

// =============================================================================
// EXPERT FUNCTIONS
// =============================================================================

/// Expert 1 — power-law forgetting. `FUN_00af8ac0`. `[C][ASM][BIN]`
///
/// `result = P0 * (S/(S+t))^log2(P0/0.9)`
#[inline]
pub fn expert1(p0: f64, t: f64, s: f64) -> f64 {
    if !(DAT_ZERO < p0 && DAT_ZERO < s) {
        return 0.0;
    }
    let exp_pow = delphi_ln(p0 / DAT_0_9) / delphi_ln(DAT_2_0);
    let ratio = s / (s + t);
    p0 * delphi_pow(ratio, exp_pow)
}

/// Expert 2 — shifted power-law forgetting. `FUN_00af8bb0`. `[C][BIN]`
///
/// `result = (1 + t/S)^log2(0.9)` = `(1+t/S)^(-0.152)`
#[inline]
pub fn expert2(t: f64, s: f64) -> f64 {
    if s <= 0.0 {
        return 0.0;
    }
    let shifted = t / s + DAT_ONE_SHIFT;
    if !(DAT_ZERO < shifted) {
        return 0.0;
    }
    delphi_pow(shifted, LOG2_09)
}

/// Expert 3 — exponential forgetting. `FUN_00af8c90`. `[C][BIN]`
///
/// `result = exp(-0.10536 * t/S)` = `0.9^(t/S)`
#[inline]
pub fn expert3(t: f64, s: f64) -> f64 {
    if !(DAT_ZERO < s) {
        return 0.0;
    }
    let ratio = t / s;
    let neg_ratio = sign_flip(ratio);
    delphi_exp(neg_ratio * DAT_DECAY)
}

/// 3-expert weighted average → retrievability proxy A, with explicit
/// parameter block (personalized or default). `FUN_00af8d00`. `[C][ASM][BIN]`
///
/// Weights use **S** for the time component and **D** for the stability component.
pub fn expert_mixture_with(p: &[f64; 35], t: f64, s: f64, d: f64) -> f64 {
    let e1 = expert1(p[0], t, s);
    let e2 = expert2(t, s);
    let e3 = expert3(t, s);

    let s_weight = sigmoid_ratio(s, p[1]);
    let d_weight1 = sigmoid_ratio(d, p[2]);
    let d_weight2 = sigmoid_ratio(d, p[3]);
    let s_weight3 = sigmoid_ratio(s, p[4]);

    let w1 = ((DAT_ONE - s_weight) + d_weight1) / DAT_2_0;
    let w2 = ((DAT_ONE - s_weight) + d_weight2) / DAT_2_0;
    let w3 = s_weight3;

    let w_sum = w1 + w2 + w3;
    if w_sum != 0.0 {
        (w1 * e1 + w2 * e2 + w3 * e3) / w_sum
    } else {
        0.0
    }
}

/// [`expert_mixture_with`] at the binary's shipped parameter block.
pub fn expert_mixture(t: f64, s: f64, d: f64) -> f64 {
    expert_mixture_with(&P, t, s, d)
}

// =============================================================================
// DIFFICULTY UPDATE
// =============================================================================

/// Update difficulty based on review outcome. `FUN_00af90f0`. `[C][BIN]`
///
/// `w = S/(S+P[24])`, `target = 1.0 if grade>2 else 0.0`,
/// `D_new = clamp(w*D + (1-w)*(D - (target - A)), 0, 1)`
pub fn difficulty_update_with(p: &[f64; 35], d: f64, s: f64, a: f64, grade: i32) -> f64 {
    let w = sigmoid_ratio(s, p[24]); // P[24]=95.04
    let target = if grade > 2 { DAT_ONE } else { DAT_ZERO };
    let d_new = w * d + (DAT_ONE - w) * (d - (target - a));
    clamp(d_new, 0.0, 1.0)
}

/// [`difficulty_update_with`] at the shipped parameter block.
pub fn difficulty_update(d: f64, s: f64, a: f64, grade: i32) -> f64 {
    difficulty_update_with(&P, d, s, a, grade)
}

// =============================================================================
// STABILITY UPDATES
// =============================================================================

/// Stability update for lapse (grade < 3). `FUN_00af9010`. `[C][BIN]`
///
/// Third term is **added**, not multiplied.
pub fn lapse_stability_with(p: &[f64; 35], d: f64, s: f64, a: f64) -> f64 {
    let base = (DAT_ONE - d) * p[19] + DAT_ONE;
    let w = sigmoid_ratio(s, p[20]);
    let mult = w * p[21] + DAT_ONE;
    let retro = sigmoid_ratio(DAT_ONE - a, p[22]);
    base * mult + retro * p[23] + DAT_ONE
}

/// [`lapse_stability_with`] at the shipped parameter block.
pub fn lapse_stability(d: f64, s: f64, a: f64) -> f64 {
    lapse_stability_with(&P, d, s, a)
}

/// Stability update for successful recall (grade ≥ 3). `FUN_00af91f0`. `[C][ASM][BIN]`
///
/// The inner term is `P[27] + (blend - P[27]) * product` (assembly-verified).
pub fn recall_stability_with(p: &[f64; 35], d: f64, s: f64, a: f64, t: f64, grade: i32) -> f64 {
    // S_min = max(S, t)
    let s_min = if s > t { s } else { t };

    // Hard bonus
    let hard_bonus = if t < s && s > 0.0 {
        let t_over_s = t / s;
        p[28] + p[29] * sigmoid_ratio(t_over_s, p[30])
    } else {
        DAT_ONE
    };

    // Time factor
    let time_factor = if s_min > 0.0 {
        delphi_pow(s_min, p[31])
    } else {
        0.0
    };

    // Recall signal: exp(-(P[32]*(1-D) + P[33]) * A)
    let inner_rs = p[32] * (DAT_ONE - d) + p[33];
    let recall_signal = delphi_exp(sign_flip(inner_rs) * a);

    // Grade factor
    let grade_factor = (grade - 4) as f64 * p[34] + DAT_ONE;

    // Difficulty blend
    let blend = p[26] + (DAT_ONE - d) * (p[25] - p[26]);

    // Final assembly
    let inner = p[27] + (blend - p[27]) * time_factor * recall_signal * grade_factor;
    s_min * hard_bonus * inner
}

/// [`recall_stability_with`] at the shipped parameter block.
pub fn recall_stability(d: f64, s: f64, a: f64, t: f64, grade: i32) -> f64 {
    recall_stability_with(&P, d, s, a, t, grade)
}

// =============================================================================
// REVIEW KERNEL
// =============================================================================

/// Result of the M4 FSRS kernel.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct KernelResult {
    pub s_new: f64,
    pub d_new: f64,
    pub a: f64,
    pub ratio: f64,
}

/// Full SM-20 review kernel with an explicit parameter block. `FUN_00af9420`. `[C][ASM][BIN]`
///
/// Args:
/// - `p`: the 35-double parameter block (shipped defaults or per-user fit)
/// - `t`: elapsed days since last review
/// - `grade`: response grade 0-5 (0-2 = lapse, 3-5 = recall)
/// - `d`: current difficulty [0.0, 1.0]
/// - `s`: current stability (days)
pub fn review_kernel_with(p: &[f64; 35], t: f64, grade: i32, d: f64, s: f64) -> KernelResult {
    // Step 1: retrievability proxy A (uses old D)
    let a = expert_mixture_with(p, t, s, d);

    // Step 2: update difficulty
    let d_new = difficulty_update_with(p, d, s, a, grade);

    // Step 3: update stability (uses new D)
    let s_new = if grade < 3 {
        lapse_stability_with(p, d_new, s, a)
    } else {
        recall_stability_with(p, d_new, s, a, t, grade)
    };

    // Step 4: ratio
    let ratio = if s > 0.0 { s_new / s } else { 0.0 };

    KernelResult {
        s_new,
        d_new,
        a,
        ratio,
    }
}

/// [`review_kernel_with`] at the binary's shipped parameter block.
pub fn review_kernel(t: f64, grade: i32, d: f64, s: f64) -> KernelResult {
    review_kernel_with(&P, t, grade, d, s)
}

/// Initialize state for a brand-new item with an explicit parameter block.
/// `FUN_00ceb590` + `FUN_00af8ed0` + `FUN_00af8f70`. `[C][BIN]`
///
/// Returns `(stability, difficulty)` for the given grade (0-5).
pub fn init_new_item_with(p: &[f64; 35], grade: i32) -> (f64, f64) {
    let g = clamp(grade as f64, 0.0, 5.0) as usize;
    let s = p[6 + g]; // init_s[grade]
    let d = p[13 + g]; // init_d[grade]
    (s, d)
}

/// [`init_new_item_with`] at the shipped parameter block.
pub fn init_new_item(grade: i32) -> (f64, f64) {
    init_new_item_with(&P, grade)
}
