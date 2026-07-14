//! Model 5 — analytic stability (10% ensemble weight).
//!
//! `FUN_00ce6c70` → `FUN_00ce71b0`. A closed-form stability update with no
//! persistent state. All constants from param block `0x10e8e90` `[BIN]`;
//! recall exponent `-0.1192` confirmed `[ASM]` (pxor sign-flip at `ce6582`).
//!
//! Evidence: `[C][ASM][BIN]`

use super::helpers::*;

/// Analytic stability model (M5). Returns a new stability.
///
/// Note: the `s_new` intermediate is actually the new difficulty (D_new from
/// `ce68e0`); it feeds the recall branch as `(11 - D_new)`.
pub fn model_5(t: f64, grade: i32, s_old: f64) -> f64 {
    let retrov = ((t / s_old) * 0.2345679012 + 1.0).powf(-0.5);
    let idx: usize = if grade < 3 {
        0
    } else if grade == 3 {
        1
    } else if grade == 4 {
        2
    } else {
        3
    };
    let scale = clamp((7.1949 - (0.5345f64 * 3.0f64).exp()) + 1.0, 1.0, 10.0);
    let depth = -1.4604 * ([1.0, 2.0, 3.0, 4.0][idx] - 3.0);
    let blend = s_old + depth * (10.0 - s_old) / 9.0;
    let s_new = clamp(0.0046 * scale + 0.9954 * blend, 1.0, 10.0);

    if idx == 0 {
        // forgot
        let product = s_old.powf(-0.11)
            * ((s_old + 1.0).powf(0.29605) - 1.0)
            * (2.2698 * (1.0 - retrov)).exp()
            * 1.9395;
        clamp(product, 0.1, s_old)
    } else {
        // remembered
        let gate1 = if idx == 1 { 0.2315 } else { 1.0 };
        let gate2 = if idx == 3 { 2.9898 } else { 1.0 };
        let inner = (11.0 - s_new)
            * s_old.powf(-0.1192)
            * ((1.01925 * (1.0 - retrov)).exp() - 1.0)
            * gate1
            * gate2
            * 1.54575f64.exp()
            + 1.0;
        s_old * inner
    }
}
