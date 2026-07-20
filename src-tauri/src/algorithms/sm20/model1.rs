//! Model 1 — legacy SM-2 scheduler (6% ensemble weight).
//!
//! `FUN_00d43e00`. A deterministic legacy multiplier with two history fields.
//! Live-validated: 40/40 vectors match exactly.
//!
//! Evidence: `[C][BIN]`

use serde::{Deserialize, Serialize};

const TARGET_R: f64 = 0.9;

/// The two fields read from the most recent replay record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct M1HistoryPoint {
    pub factor: f64,
    pub stability: f64,
}

impl Default for M1HistoryPoint {
    fn default() -> Self {
        Self { factor: 2.5, stability: 1.0 }
    }
}

/// Per-item state for M1.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct M1ItemState {
    pub last_review_day: i32,
    pub previous_interval: i32,
    pub repetitions: u32,
    pub lapses: u32,
}

impl Default for M1ItemState {
    fn default() -> Self {
        Self { last_review_day: -1, previous_interval: 0, repetitions: 0, lapses: 0 }
    }
}

/// Result of an M1 review.
#[derive(Debug, Clone)]
pub struct M1ReviewResult {
    pub interval: i32,
    pub used_interval: i32,
    pub base_factor: f64,
    pub grade_adjusted_factor: f64,
    pub retrievability: f64,
    pub repetitions: u32,
    pub lapses: u32,
    pub next_item: M1ItemState,
    pub next_history: M1HistoryPoint,
}

fn fresh_factor(previous_interval: i32, repetitions: u32) -> f64 {
    if repetitions < 3 {
        return 2.5;
    }
    let value = (previous_interval as f64 / 6.0).powf(1.0 / (repetitions as f64 - 2.0));
    value.clamp(1.3, 2.5)
}

fn adjust_factor_for_grade(factor: f64, grade: i32) -> f64 {
    if grade < 3 {
        return factor;
    }
    let distance = 5.0 - grade as f64;
    let adjustment = 0.1 - distance * (distance * 0.02 + 0.08);
    (factor + adjustment).clamp(1.3, 2.5)
}

/// Run the M1 interval path for one review. `FUN_00d43e00`. `[C][BIN]`
pub fn model_1(item: &M1ItemState, today: i32, grade: i32, history: Option<&M1HistoryPoint>) -> M1ReviewResult {
    assert!((0..=5).contains(&grade), "grade must be in 0..=5");

    // Used interval. `FUN_00a62080` GetUsedInterval: `today - last_review_day`,
    // floored at 1 (the binary NEVER returns 0; values <= 0 become 1). Only
    // computed when `previous_interval != 0`; otherwise the binary leaves the
    // caller's pre-loaded value, which we mirror as 1. [C][ASM]
    let used = if item.previous_interval != 0 {
        let raw = today - item.last_review_day;
        if raw < -1 {
            // Binary: fatal "UsedInterval is less than 1". We panic to match.
            panic!("UsedInterval < -1 (today={}, last_review_day={})", today, item.last_review_day);
        }
        if raw < 1 { 1 } else { raw }
    } else {
        1
    };

    let factor = if let Some(h) = history {
        h.factor
    } else {
        fresh_factor(item.previous_interval, item.repetitions)
    };

    let stability = if let Some(h) = history {
        h.stability
    } else if item.repetitions >= 2 && item.previous_interval >= 1 {
        item.previous_interval as f64
    } else {
        1.0
    };
    let stability = stability.max(1.0);

    let (repetitions, lapses) = if grade >= 3 {
        (item.repetitions.saturating_add(1).min(65535), item.lapses)
    } else {
        let new_lapses = if item.repetitions == 0 {
            0
        } else {
            item.lapses.saturating_add(1).min(65535)
        };
        (1, new_lapses)
    };

    let retrievability = if history.is_none() {
        if item.previous_interval < 1 {
            0.85
        } else {
            (TARGET_R.ln() * used as f64 / item.previous_interval as f64).exp()
        }
    } else {
        (TARGET_R.ln() * used as f64 / stability).exp()
    };

    let interval = if repetitions == 1 {
        1
    } else if repetitions == 2 {
        used.max(6)
    } else {
        // Rounded via FUN_0040c5d0 = Delphi Round = ties-to-even (e.g.
        // used=5 × factor=2.5 → 12.5 → 12, not 13).
        let base = (used as f64).max(used as f64 * factor);
        base.round_ties_even() as i32
    };

    let adjusted_factor = adjust_factor_for_grade(factor, grade);

    let next_item = M1ItemState {
        last_review_day: today,
        previous_interval: 0, // pipeline overwrites with final ensemble interval
        repetitions,
        lapses,
    };

    M1ReviewResult {
        interval,
        used_interval: used,
        base_factor: factor,
        grade_adjusted_factor: adjusted_factor,
        retrievability,
        repetitions,
        lapses,
        next_item,
        next_history: M1HistoryPoint {
            factor: adjusted_factor,
            stability: interval as f64, // pipeline overwrites with final interval
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `FUN_00a62080` GetUsedInterval NEVER returns 0 — values `<= 0` become 1.
    /// The binary only calls it when `previous_interval != 0`; otherwise the
    /// caller's pre-loaded value is used, which we mirror as 1. Verified
    /// against the Python canonical package (40/40 live vectors).
    #[test]
    fn used_interval_floors_at_one() {
        // previous_interval == 0: used = 1 regardless of dates (binary skips
        // GetUsedInterval and leaves the pre-loaded 1).
        let item = M1ItemState { last_review_day: 100, previous_interval: 0, repetitions: 0, lapses: 0 };
        let r = model_1(&item, 100, 4, None);
        assert_eq!(r.used_interval, 1, "prev_interval=0 should give used=1");

        // previous_interval != 0 but today == last_review_day: raw delta is 0,
        // floored to 1 (binary never returns 0).
        let item = M1ItemState { last_review_day: 100, previous_interval: 5, repetitions: 3, lapses: 0 };
        let r = model_1(&item, 100, 4, None);
        assert_eq!(r.used_interval, 1, "today==last_review_day should floor to 1");

        // Normal case: delta is 7, returned as-is.
        let r = model_1(&item, 107, 4, None);
        assert_eq!(r.used_interval, 7, "normal delta should pass through");
    }

    /// `raw < -1` (today before last_review_day by more than 1) is a fatal
    /// error in the binary ("UsedInterval is less than 1"). We panic to match.
    #[test]
    #[should_panic(expected = "UsedInterval < -1")]
    fn used_interval_negative_delta_panics() {
        let item = M1ItemState { last_review_day: 100, previous_interval: 5, repetitions: 3, lapses: 0 };
        // today=98 -> raw = 98-100 = -2 < -1 -> panic
        model_1(&item, 98, 4, None);
    }

    /// `FUN_0040c5d0` (Delphi Round) rounds ties to even: used=5 × factor=2.5
    /// = 12.5 must give 12, not 13. Confirmed against the Python reference
    /// (banker's `round()`); the old `.round()` (ties away from zero) gave 13.
    #[test]
    fn interval_rounds_ties_to_even() {
        let item = M1ItemState { last_review_day: 0, previous_interval: 5, repetitions: 3, lapses: 0 };
        let history = M1HistoryPoint { factor: 2.5, stability: 5.0 };
        let r = model_1(&item, 5, 5, Some(&history));
        assert_eq!(r.used_interval, 5);
        assert_eq!(r.interval, 12, "12.5 rounds to even (12), matching the binary");
    }
}
