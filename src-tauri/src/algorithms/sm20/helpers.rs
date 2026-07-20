//! Shared math helpers for the SM-20 ensemble.
//!
//! All functions mirror the Delphi RTL routines used by `sm20.exe` and are
//! confirmed against decompiled C / assembly.

/// Clamp `v` to `[lo, hi]`.
#[inline]
pub fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

/// `2^x` clamped to `[-38, 38]` — prevents overflow/underflow. `FUN_00f614b0`.
#[inline]
pub fn exp2_clamped(x: f64) -> f64 {
    let x = clamp(x, -38.0, 38.0);
    2.0f64.powf(x)
}

/// `x / (x + y)`, returns `0.0` if `x + y == 0`. `FUN_00af8a80`. NOT a logistic sigmoid.
#[inline]
pub fn sigmoid_ratio(x: f64, y: f64) -> f64 {
    let s = x + y;
    if s == 0.0 {
        0.0
    } else {
        x / s
    }
}

/// Delphi `Exp()` = `e^x` (natural exponential). `FUN_0040b0e0`. Clamped to prevent overflow.
#[inline]
pub fn delphi_exp(x: f64) -> f64 {
    if x > 709.0 {
        f64::INFINITY
    } else if x < -745.0 {
        0.0
    } else {
        x.exp()
    }
}

/// Delphi `Ln()` = natural log. `FUN_0040c140`.
#[inline]
pub fn delphi_ln(x: f64) -> f64 {
    x.ln()
}

/// Delphi `pow(base, exp)`. `FUN_00477180` / `FUN_004772a0`.
/// Internally: if `base > 0`: `exp(exp * ln(base))`; else `0`.
#[inline]
pub fn delphi_pow(base: f64, exp: f64) -> f64 {
    if base > 0.0 {
        delphi_exp(exp * delphi_ln(base))
    } else {
        0.0
    }
}

/// XOR with `-0.0` (IEEE 754 sign bit) — negation. Used by the binary for sign flips.
#[inline]
pub fn sign_flip(value: f64) -> f64 {
    -value
}

/// Delphi `Round` = round half to even (banker's rounding). `FUN_0040c5d0`
/// decompiles to `(longlong)ROUND(param_1)` — the SSE2 convert under the
/// default MXCSR mode, i.e. ties-to-even. (An earlier build used
/// `f64::round()`, which rounds ties away from zero: 12.5 → 13 instead of
/// the binary's 12.)
#[inline]
pub fn delphi_round(v: f64) -> i64 {
    v.round_ties_even() as i64
}
