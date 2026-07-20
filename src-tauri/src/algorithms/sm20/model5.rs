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
        // forgot — `ce66a0(D_new, S, retrov)`: the `^-0.11` base is `s_new`
        // (the new difficulty from `ce68e0`), NOT `s_old`. The `(x+1)^0.29605`
        // term uses `s_old`. Verified against live capture 2026-07-20.
        let product = s_new.powf(-0.11)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The forgot branch must use `s_new` (D_new) for the `^-0.11` base, not
    /// `s_old`. This was a real decode bug (caught by live capture against
    /// sm20.exe, 2026-07-20); the stale formula used `s_old.powf(-0.11)` and
    /// produced materially different outputs at large S. These vectors are the
    /// Python canonical package's output, which is itself verified against the
    /// binary's live vectors (`analysis/M5_LIVE_DIRECT.json`, 72 vectors).
    #[test]
    fn forgot_branch_uses_d_new_for_power_base() {
        // (t, grade, S) -> expected model_5 output, sampled across the full
        // S range. These are the binary's live-captured vectors
        // (analysis/M5_LIVE_DIRECT.json, forgot branch). The stale formula
        // (s_old for the ^-0.11 base) gave 4.57/2.31/0.82/0.43 for the
        // large-S cases here — materially wrong.
        let cases: [(f64, i32, f64, f64); 8] = [
            (0.5, 0, 1.0, 0.4296776895043638),
            (2.0, 2, 1.0, 0.5655224839787755),
            (10.0, 0, 5.0, 1.6401347259686294),
            (100.0, 1, 50.0, 4.933323102540478),
            (250.0, 0, 500.0, 9.017266841755799),
            (1000.0, 2, 500.0, 11.868121775025038),
            (25.0, 0, 50.0, 3.7482839892845847),
            (5.0, 1, 5.0, 1.3834887824852264),
        ];
        for (t, grade, s_old, expected) in cases {
            let got = model_5(t, grade, s_old);
            assert!(
                (got - expected).abs() < 1e-9,
                "model_5(t={}, grade={}, S={}): got {}, expected {}",
                t, grade, s_old, got, expected
            );
        }
    }
}
