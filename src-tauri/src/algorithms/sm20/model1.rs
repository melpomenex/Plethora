//! Model 1 — legacy SM-15 scheduler (6% ensemble weight).
//!
//! `FUN_00d43e00`. A deterministic legacy multiplier with two history fields.
//! Live-validated: 40/40 vectors match exactly.
//!
//! Evidence: `[C][BIN]`

use serde::{Deserialize, Serialize};

const TARGET_R: f64 = 0.9;

/// The two fields read from the most recent replay record.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct M1HistoryPoint {
    pub factor: f64,
    pub stability: f64,
}

/// Per-item state for M1.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct M1ItemState {
    pub last_review_day: i32,
    pub previous_interval: i32,
    pub repetitions: u32,
    pub lapses: u32,
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

    let used = if item.last_review_day < 0 {
        0
    } else {
        (today - item.last_review_day).max(0)
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
        let base = (used as f64).max(used as f64 * factor);
        base.round() as i32
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
