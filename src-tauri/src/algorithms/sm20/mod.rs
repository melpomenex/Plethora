//! SM-20 Algorithm — True 5-Model Ensemble Implementation
//!
//! This module implements the actual SM-20 scheduling algorithm as decoded
//! from `sm20.exe` (SHA-256 `b5cd214e...`). SM-20 is NOT a single formula —
//! it is a **5-model weighted ensemble** that blends five independent
//! prediction models:
//!
//! ```text
//! ensemble = (6·M1 + 14·M2 + 45·M3 + 25·M4 + 10·M5) / 100
//! adjusted = ln(1 - FI/100) / ln(0.9) · ensemble
//! interval = clamp(round(clamp(adjusted, 0.7, 44530)), 1, 44530)
//! ```
//!
//! All 5 models, the ensemble, retention adjustment, dispersal, post-lapse,
//! and finalization are decoded and live-validated against the running
//! `sm20.exe` binary via Frida injection.
//!
//! ## Model Summary
//!
//! | Model | Weight | Function | Description |
//! |-------|--------|----------|-------------|
//! | M1 | 6% | `d43e00` | Legacy SM-15 scheduler (deterministic multiplier) |
//! | M2 | 14% | `a651f0`→`a605a0` | Classic SM-15/16 scheduler (matrix optimizer) |
//! | M3 | 45% | `cea5a0` | SM-15 raw matrix scheduler (Bayesian 21³ matrices) |
//! | M4 | 25% | `af9420` | 35-param FSRS mixture kernel (3-expert forgetting model) |
//! | M5 | 10% | `ce6c70`→`ce71b0` | Analytic stability formula |
//!
//! Evidence: `[C]` = decompiled C, `[ASM]` = assembly, `[BIN]` = binary extraction

pub mod ensemble;
pub mod helpers;
pub mod kernel;
pub mod model1;
pub mod model2;
pub mod model3;
pub mod model5;

use serde::{Deserialize, Serialize};

use ensemble::*;
use kernel::review_kernel;
use model1::{model_1, M1HistoryPoint, M1ItemState};
use model2::{model_2, ClassicM2Optimizer, M2ItemState};
use model3::{model_3_stateful, M3ItemState, M3MatrixState};
use model5::model_5;

// Re-export index mappers for backward compatibility with the old sm20.rs API
pub use model3::{d_index as difficulty_to_index, r_index};
pub use kernel::init_new_item as init_kernel_item;

// =============================================================================
// LEGACY V4 DIAGNOSTIC TYPES — kept for backward-compatible DB deserialization.
// The ensemble does not use these; they exist only so the old
// sm20_recall_cells / sm20_optimizer_profiles tables can still be queried.
// =============================================================================
pub const SM20_MODEL_VERSION: i32 = 4;
pub const SM20_OPTIMIZER_VERSION: i32 = 1;
pub const SM20_MIN_OPTIMIZER_SAMPLES: u32 = 200;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Copy)]
pub struct SM20RecallCoefficients {
    pub coefficient_1: f64,
    pub coefficient_2: f64,
    pub coefficient_3: f64,
    pub coefficient_4: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SM20RecallCell {
    pub retrievability_bucket: u8,
    pub difficulty_bucket: u8,
    pub total_count: u32,
    pub pass_count: u32,
}

// =============================================================================
// CONSTANTS
// =============================================================================

pub const STABILITY_MAX: f64 = 44530.0;
pub const STABILITY_CAP: f64 = 0.7;

/// Default forgetting index (10% → 90% retention → factor 1.0).
pub const DEFAULT_FI: u8 = 10;

// =============================================================================
// DATA TYPES
// =============================================================================

/// Per-item SM-20 scheduling state.
///
/// Backward-compatible with the previous `SM20State` — all old fields are
/// retained with `#[serde(default)]` so existing items deserialize cleanly.
/// New fields hold the per-item state for models M1, M2, and M3.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SM20State {
    pub stability: f64,
    pub difficulty: f64,
    pub repetition: u32,
    pub lapses: u32,
    pub interval: f64,

    // --- Deprecated fields (kept for backward-compatible deserialization) ---
    #[serde(default)]
    pub version: u8,
    #[serde(default)]
    pub last_quality: f64,
    #[serde(default)]
    pub algorithm_branch: u8,
    #[serde(default)]
    pub retrov: f64,
    #[serde(default = "default_one")]
    pub s_factor: f64,
    #[serde(default = "default_one")]
    pub multiplier: f64,

    // --- Per-item model state (new) ---
    #[serde(default)]
    pub m1_state: M1ItemState,
    #[serde(default)]
    pub m1_history: Option<M1HistoryPoint>,
    #[serde(default)]
    pub m2_state: M2ItemState,
    #[serde(default)]
    pub m3_state: M3ItemState,
}

fn default_one() -> f64 {
    1.0
}

impl Default for SM20State {
    fn default() -> Self {
        Self {
            stability: 1.0,
            difficulty: 0.3,
            repetition: 0,
            lapses: 0,
            interval: 1.0,
            version: 4,
            last_quality: 0.75,
            algorithm_branch: 0,
            retrov: 0.3,
            s_factor: 1.0,
            multiplier: 1.0,
            m1_state: M1ItemState::default(),
            m1_history: None,
            m2_state: M2ItemState::default(),
            m3_state: M3ItemState::default(),
        }
    }
}

/// Result of an SM-20 review.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SM20ReviewResult {
    pub state: SM20State,
    pub interval_days: f64,
    pub retrievability: f64,
}

/// Preview intervals for each rating button.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SM20PreviewIntervals {
    pub again: f64,
    pub hard: f64,
    pub good: f64,
    pub easy: f64,
}

/// Collection-wide state that must be loaded/saved per review.
pub struct SM20CollectionState {
    pub m2_optimizer: ClassicM2Optimizer,
    pub m3_matrices: M3MatrixState,
}

impl Default for SM20CollectionState {
    fn default() -> Self {
        Self {
            m2_optimizer: ClassicM2Optimizer::fresh(),
            m3_matrices: M3MatrixState::default(),
        }
    }
}

// =============================================================================
// RETRIEVABILITY (public API — kept stable)
// =============================================================================

/// Predicted probability of recall at time `t`. `0.9^(elapsed/stability)`.
pub fn retrievability(stability: f64, elapsed_days: f64) -> f64 {
    if stability <= 0.0 {
        return 0.0;
    }
    0.9f64.powf(elapsed_days / stability)
}

/// Map retrievability to a 1-20 bucket index. `floor(20^R)` clamped to [1,20].
/// Kept for backward compatibility with the old sm20.rs API.
pub fn recall_retrievability_to_bucket(value: f64) -> u8 {
    r_index(value) as u8
}

// =============================================================================
// RATING → GRADE MAPPING
// =============================================================================

/// Map the app's 4-button rating to the SM-20 0-5 grade scale.
///
/// In SuperMemo's scale, grades 0-2 are FAIL variants and 3-5 are PASS
/// variants — every model in this module branches on `grade >= 3`. The
/// canonical Anki-buttons ↔ SM-grades mapping is therefore:
/// - Again → 0 (complete lapse)
/// - Hard → 3 (pass with serious difficulty)
/// - Good → 4 (pass after hesitation)
/// - Easy → 5 (perfect recall)
///
/// (The old mapping sent Hard to grade 2, which made Hard a *lapse* —
/// indistinguishable from Again in all five models.)
pub fn rating_to_grade(rating: i32) -> i32 {
    match rating {
        1 => 0, // Again
        2 => 3, // Hard
        3 => 4, // Good
        4 => 5, // Easy
        _ => rating.clamp(0, 5),
    }
}

// =============================================================================
// REVIEW (the main entry point)
// =============================================================================

/// Run one review through the full SM-20 5-model ensemble pipeline.
///
/// Takes a native SM-20 `grade` (0-5; 0-2 fail, 3-5 pass). Callers holding a
/// 4-button rating map it first via [`rating_to_grade`].
///
/// This is the production review path. It:
/// 1. Computes M4 (FSRS kernel) and M5 (analytic) — both stateless, always fresh
/// 2. Computes M1 (legacy) using per-item M1 state
/// 3. Computes M2 (classic) using the collection optimizer (mutated if `commit`)
/// 4. Computes M3 (matrix) using the collection matrices (mutated if `commit`)
/// 5. Blends all 5 via the ensemble weighted average
/// 6. Applies retention adjustment, dispersal/post-lapse, clamping
/// 7. Writes back `previous_interval` for M1/M2/M3 state
///
/// For `preview()` (showing the user what each button will give), use
/// `commit=false` — this runs all models in scratch mode without mutating
/// collection state. When `disperse` is false the result is fully
/// deterministic: the rng is withheld from finalization so neither dispersal
/// nor the post-lapse jitter fires (previews must not re-roll on every fetch).
pub fn review(
    state: &SM20State,
    grade: i32,
    elapsed_days: f64,
    fi: u8,
    collection: &mut SM20CollectionState,
    today: i32,
    commit: bool,
    disperse: bool,
    rng: &mut impl rand::Rng,
) -> SM20ReviewResult {
    let grade = grade.clamp(0, 5);
    let t = elapsed_days;
    let s = state.stability;
    let d = state.difficulty;

    // --- M4: FSRS 35-param kernel (25%) — always fresh, stateless ---
    let m4_result = review_kernel(t, grade, d, s);
    let m4 = m4_result.s_new;

    // --- M5: analytic stability (10%) — always fresh, stateless ---
    let m5 = model_5(t, grade, s);

    // --- M1: legacy scheduler (6%) ---
    let m1_review = model_1(&state.m1_state, today, grade, state.m1_history.as_ref());
    let m1 = m1_review.interval as f64;

    // --- M2: classic SM-15/16 scheduler (14%) ---
    let m2_review = model_2(
        &state.m2_state,
        &mut collection.m2_optimizer,
        today,
        grade,
        fi as u32,
        commit,
        rng,
    );
    let m2 = m2_review.stability as f64;

    // --- M3: SM-15 raw matrix scheduler (45%) ---
    let m3_review = model_3_stateful(
        &state.m3_state,
        &mut collection.m3_matrices,
        today,
        grade,
        commit,
        None, // compute retrievability internally
    );
    let m3 = m3_review.stability;

    // --- Ensemble ---
    let ensemble_val = ensemble_stability(m1, m2, m3, m4, m5);

    // --- Determine post-lapse mode ---
    // In the binary: item[+0xb9] != 0 && item[+0xb7] == 1
    // This means: the item is in relearning (b9 = lapse count from last review)
    // AND this is the first repetition after the lapse (b7 == 1).
    // We approximate this: post-lapse only when the item has 0 repetitions
    // (i.e., it was just lapsed and is being re-reviewed for the first time).
    // A fail grade (0-2) on an established item does NOT trigger post-lapse.
    let post_lapse_mode = grade < 3 && state.repetition == 0;

    // --- Finalize ---
    // Only hand the rng to finalization on the stochastic (committed) path.
    // Previews call with disperse=false and must stay deterministic — the
    // post-lapse jitter would otherwise re-roll the shown interval every fetch.
    let fin = finalize(
        ensemble_val,
        fi,
        post_lapse_mode,
        0.0,
        disperse,
        if disperse { Some(rng) } else { None },
    );

    // --- Write back previous_interval for stateful models ---
    let final_interval = fin.interval;

    // Build next M1 state
    let mut next_m1_item = m1_review.next_item;
    next_m1_item.previous_interval = final_interval;
    let mut next_m1_history = m1_review.next_history;
    next_m1_history.stability = final_interval as f64;

    // Build next M2 state
    let mut next_m2_item = m2_review.next_item;
    next_m2_item.previous_interval = final_interval;

    // Build next M3 state
    let mut next_m3_item = m3_review.next_item;
    next_m3_item.previous_interval = final_interval;

    // --- Assemble new state ---
    // The DSR state (stability, difficulty) is taken from M4 (the kernel),
    // which is the canonical DSR state in the binary.
    let new_state = SM20State {
        stability: m4_result.s_new,
        difficulty: m4_result.d_new,
        repetition: if grade >= 3 {
            state.repetition.saturating_add(1)
        } else {
            0
        },
        lapses: if grade < 3 {
            state.lapses.saturating_add(1)
        } else {
            state.lapses
        },
        interval: final_interval as f64,
        // Deprecated fields — carry forward
        version: state.version,
        last_quality: state.last_quality,
        algorithm_branch: state.algorithm_branch,
        retrov: m4_result.a, // store retrievability proxy
        s_factor: state.s_factor,
        multiplier: state.multiplier,
        // New model states
        m1_state: next_m1_item,
        m1_history: Some(next_m1_history),
        m2_state: next_m2_item,
        m3_state: next_m3_item,
    };

    SM20ReviewResult {
        state: new_state,
        interval_days: final_interval as f64,
        retrievability: m4_result.a,
    }
}

/// Preview intervals for each rating button (deterministic — no dispersal).
///
/// Runs the full ensemble in scratch mode (`commit=false`) for each rating.
pub fn preview(
    state: &SM20State,
    elapsed_days: f64,
    fi: u8,
    collection: &SM20CollectionState,
    today: i32,
    rng: &mut impl rand::Rng,
) -> SM20PreviewIntervals {
    let grades = preview_grades(state, elapsed_days, fi, collection, today, rng);
    SM20PreviewIntervals {
        again: grades[rating_to_grade(1) as usize],
        hard: grades[rating_to_grade(2) as usize],
        good: grades[rating_to_grade(3) as usize],
        easy: grades[rating_to_grade(4) as usize],
    }
}

/// Preview intervals for every native SM-20 grade 0-5 (deterministic).
///
/// Returns `[interval_for_grade_0, ..., interval_for_grade_5]` in days. Runs
/// the full ensemble in scratch mode (`commit=false`) for each grade.
pub fn preview_grades(
    state: &SM20State,
    elapsed_days: f64,
    fi: u8,
    collection: &SM20CollectionState,
    today: i32,
    rng: &mut impl rand::Rng,
) -> [f64; 6] {
    // Clone collection state so we don't mutate it during preview
    let mut coll = SM20CollectionState {
        m2_optimizer: collection.m2_optimizer.clone(),
        m3_matrices: collection.m3_matrices.clone(),
    };

    let mut out = [0.0f64; 6];
    for grade in 0..6 {
        out[grade as usize] =
            review(state, grade, elapsed_days, fi, &mut coll, today, false, false, rng)
                .interval_days;
    }
    out
}

/// Initialize a new SM-20 item for the given grade. `[C][BIN]`
pub fn init_item(grade: i32) -> SM20State {
    let (s, d) = kernel::init_new_item(grade);
    SM20State {
        stability: s,
        difficulty: d,
        ..Default::default()
    }
}
