//! SuperMemo 20 scheduling — the **Algorithm Arena** implementation.
//!
//! Decoded from `sm20.exe` (SHA-256 `b5cd214e...`). SuperMemo 20 schedules
//! with a weighted blend of **five competing algorithms** — the "Algorithm
//! Arena" feature. The binary persists the five weights as per-user settings
//! (`[Algorithm] PA2/PA15/PA19/PA20/PAF`, loader `d7f350`, saver `d71070`)
//! with compile-time defaults written at unit-init by `FUN_00af4580`:
//!
//! ```text
//! blend    = (w₁·SM2 + w₂·SM15 + w₃·SM19 + w₄·SM20 + w₅·FSRS) / Σw
//! adjusted = ln(1 - FI/100) / ln(0.9) · blend
//! interval = clamp(round(clamp(adjusted, 0.7, 44530)), 1, 44530)
//! defaults : w = [6, 14, 45, 25, 10]
//! ```
//!
//! All 5 competitors, the blend, retention adjustment, dispersal, post-lapse,
//! finalization, and the runtime weight adaptation (`FUN_00af40d0`) are
//! decoded and live-validated against the running `sm20.exe` binary via
//! Frida injection.
//!
//! ## The five competitors (slot order = item struct offsets)
//!
//! | Slot | Key | Default | Function | Algorithm |
//! |------|------|---------|----------|-----------|
//! | M1 (+0x73) | `PA2` | 6% | `d43e00` | **SM-2** (EF 2.5/1.3, I(2)=6, classic EF update) |
//! | M2 (+0x77) | `PA15` | 14% | `a651f0`→`a605a0` | **SM-15** (A-factor/OF-matrix optimizer) |
//! | M3 (+0x7b) | `PA19` | 45% | `cea5a0` | **SM-19** (Bayesian 21³ D/S/R matrices) |
//! | M4 (+0x83) | `PA20` | 25% | `af9420` | **SM-20 proper** (35-param theory-based kernel, no matrices) |
//! | M5 (+0x8b) | `PAF` | 10% | `ce6c70`→`ce71b0` | **FSRS** (19/81 power curve, near-default weights) |
//!
//! The Arena weights adapt to the user's own review history via the decoded
//! `FUN_00af40d0` (see [`arena`]): on every committed review past the first,
//! the per-review stats orchestrator `FUN_00ce4470` computes each model's
//! signed prediction error `(outcome - R_i)` and nudges the weights toward
//! models that predicted the outcome better. Both trainable competitors can
//! additionally be fitted to the user's own review log (see [`optimize`] for
//! SM-20/M4, and the fsrs crate integration for M5).
//!
//! Evidence: `[C]` = decompiled C, `[ASM]` = assembly, `[BIN]` = binary extraction

pub mod arena;
pub mod ensemble;
pub mod helpers;
pub mod kernel;
pub mod model1;
pub mod model2;
pub mod model3;
pub mod model5;
pub mod optimize;

use serde::{Deserialize, Serialize};

use arena::ArenaState;
use ensemble::*;
use kernel::review_kernel_with;
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

    // --- Post-lapse scheduling markers (binary item[+0xb7] / [+0xb9]) ---
    // Written by the binary's interval_dispatch (FUN_00ce7380) and read by
    // the finalizer (FUN_00cf5b50:28) to select the post-lapse path
    // (FUN_00ce2fe0) over the normal dispersal path (FUN_00cf5100). The
    // trigger is: post_lapse_family == 1 AND lapse_ordinal != 0.
    #[serde(default)]
    pub post_lapse_family: u32,
    #[serde(default)]
    pub lapse_ordinal: u32,

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

    // --- Algorithm Arena support ---
    /// The five models' stability outputs at the last review
    /// (SM-2/SM-15/SM-19/SM-20/FSRS slot order). Used to score each
    /// competitor's recall prediction at the next review.
    #[serde(default)]
    pub slot_stabilities: Option<[f64; 5]>,
    /// Per-item memory state for the personalized-FSRS M5 path (only
    /// populated once user-optimized FSRS parameters exist).
    #[serde(default)]
    pub m5_memory: Option<M5Memory>,
}

/// FSRS memory state carried per item for the personalized M5 competitor.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct M5Memory {
    pub stability: f64,
    pub difficulty: f64,
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
            post_lapse_family: 0,
            lapse_ordinal: 0,
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
            slot_stabilities: None,
            m5_memory: None,
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
    /// Algorithm Arena weights + R-Metric accumulators (mutated on commit).
    pub arena: ArenaState,
    /// Per-user FSRS parameters from the optimizer. When present, the M5
    /// competitor runs real FSRS with these weights instead of the binary's
    /// stock FSRS formulas.
    pub fsrs_params: Option<Vec<f32>>,
    /// Per-user SM-20 kernel parameters (35 doubles) from the optimizer.
    /// When present, M4 runs with these instead of the shipped defaults.
    pub m4_params: Option<Vec<f64>>,
}

impl Default for SM20CollectionState {
    fn default() -> Self {
        Self {
            m2_optimizer: ClassicM2Optimizer::fresh(),
            m3_matrices: M3MatrixState::default(),
            arena: ArenaState::default(),
            fsrs_params: None,
            m4_params: None,
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
// PERSONALIZED MODEL PLUMBING
// =============================================================================

/// Resolve the M4 (Algorithm SM-20) parameter block: the per-user fit when a
/// valid one exists, otherwise the binary's shipped defaults.
fn resolve_m4_params(custom: Option<&[f64]>) -> [f64; 35] {
    if let Some(p) = custom {
        if p.len() == 35 && p.iter().all(|v| v.is_finite()) {
            let mut out = [0.0f64; 35];
            out.copy_from_slice(p);
            return out;
        }
    }
    kernel::P
}

/// Run the M5 competitor as real FSRS with per-user parameters.
///
/// Returns the new slot stability and the item's next FSRS memory state, or
/// `None` when the parameters are unusable (caller falls back to the stock
/// M5 formulas).
fn fsrs_m5(
    params: &[f32],
    memory: Option<M5Memory>,
    elapsed_days: f64,
    grade: i32,
) -> Option<(f64, M5Memory)> {
    let engine = fsrs::FSRS::new(Some(params)).ok()?;
    let mem = memory.map(|m| fsrs::MemoryState {
        stability: m.stability as f32,
        difficulty: m.difficulty as f32,
    });
    let elapsed = elapsed_days.round().max(0.0) as u32;
    let states = engine.next_states(mem, 0.9, elapsed).ok()?;
    // Grade → FSRS rating: 0-2 fail → Again, 3 → Hard, 4 → Good, 5 → Easy.
    let chosen = match grade {
        g if g < 3 => states.again,
        3 => states.hard,
        4 => states.good,
        _ => states.easy,
    };
    let stability = chosen.memory.stability as f64;
    if !stability.is_finite() || stability <= 0.0 {
        return None;
    }
    let next = M5Memory {
        stability,
        difficulty: chosen.memory.difficulty as f64,
    };
    Some((stability, next))
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
    pure_m4: bool,
) -> SM20ReviewResult {
    let grade = grade.clamp(0, 5);
    let t = elapsed_days;
    let s = state.stability;
    let d = state.difficulty;

    // --- M4: Algorithm SM-20 — the 35-param kernel (default weight 25%) ---
    // Runs with the per-user parameter fit when one exists, else the
    // binary's shipped pretrained block.
    let m4_p = resolve_m4_params(collection.m4_params.as_deref());
    let m4_result = review_kernel_with(&m4_p, t, grade, d, s);
    let m4 = m4_result.s_new;

    // --- M5: FSRS (default weight 10%) ---
    // With per-user FSRS parameters, run real FSRS (the thing the optimizer
    // trained) on the item's own FSRS memory state. Otherwise keep the
    // binary's stock FSRS formulas — byte-faithful to the verified port.
    let (m5, next_m5_memory) = match collection
        .fsrs_params
        .as_deref()
        .and_then(|w| fsrs_m5(w, state.m5_memory, t, grade))
    {
        Some((slot, mem)) => (slot, Some(mem)),
        None => (model_5(t, grade, s), state.m5_memory),
    };

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

    // --- Ensemble (Algorithm Arena blend at the live per-user weights or Pure SM-20 M4) ---
    let ensemble_val = if pure_m4 {
        m4
    } else {
        ensemble_stability_weighted(&collection.arena.weights, m1, m2, m3, m4, m5)
    };

    // --- Determine post-lapse mode (FUN_00cf5b50:28) ---
    // The binary takes the post-lapse path (FUN_00ce2fe0) when
    // item[+0xb9] (lapse_ordinal) != 0 AND item[+0xb7]
    // (post_lapse_family) == 1. These are written by interval_dispatch
    // (FUN_00ce7380): +0xb7==1 marks the post-lapse branch (a subsequent
    // post-lapse re-review, not the first repetition), and +0xb9 is 0 only
    // on the very first repetition of an item.
    let post_lapse_mode = state.lapse_ordinal != 0 && state.post_lapse_family == 1;

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

    // --- Algorithm Arena: score the five competitors on this outcome ---
    // Uses the slot stabilities persisted at the item's PREVIOUS review, so
    // each model is judged on the prediction it actually made. Runs after the
    // blend (this review scheduled with the pre-update weights, keeping
    // preview() and commit identical); the updated weights apply from the
    // next review on.
    if commit {
        if let Some(slots) = &state.slot_stabilities {
            collection.arena.observe(slots, elapsed_days, grade >= 3);
        }
    }

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
    let new_repetition: u32 = if grade >= 3 {
        state.repetition.saturating_add(1)
    } else {
        0
    };
    // Post-lapse scheduling markers (FUN_00ce7380 writes item[+0xb7]/[+0xb9]).
    // +0xb7 (post_lapse_family) == 1 marks the post-lapse branch; other values
    // are repetition_count+1. +0xb9 (lapse_ordinal) is 0 only on the very first
    // repetition. The post-lapse path fires on a lapse (grade<3) that is NOT the
    // item's first repetition; otherwise the normal dispersal branch runs.
    let (post_lapse_family, lapse_ordinal) = if grade < 3 && state.repetition != 0 {
        (1, state.repetition.saturating_add(1).min(65535))
    } else {
        let family = if new_repetition > 0 {
            (new_repetition + 1).min(65535)
        } else {
            0
        };
        let ordinal = if state.repetition == 0 {
            0
        } else {
            state.repetition.saturating_add(1).min(65535)
        };
        (family, ordinal)
    };
    let new_state = SM20State {
        stability: m4_result.s_new,
        difficulty: m4_result.d_new,
        repetition: new_repetition,
        lapses: if grade < 3 {
            state.lapses.saturating_add(1)
        } else {
            state.lapses
        },
        interval: final_interval as f64,
        post_lapse_family,
        lapse_ordinal,
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
        // Arena: persist each competitor's stability so its recall
        // prediction can be scored at the next review.
        slot_stabilities: Some([m1, m2, m3, m4, m5]),
        m5_memory: next_m5_memory,
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
    pure_m4: bool,
) -> SM20PreviewIntervals {
    let grades = preview_grades(state, elapsed_days, fi, collection, today, rng, pure_m4);
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
    pure_m4: bool,
) -> [f64; 6] {
    // Clone collection state so we don't mutate it during preview
    let mut coll = SM20CollectionState {
        m2_optimizer: collection.m2_optimizer.clone(),
        m3_matrices: collection.m3_matrices.clone(),
        arena: collection.arena.clone(),
        fsrs_params: collection.fsrs_params.clone(),
        m4_params: collection.m4_params.clone(),
    };

    let mut out = [0.0f64; 6];
    for grade in 0..6 {
        out[grade as usize] =
            review(state, grade, elapsed_days, fi, &mut coll, today, false, false, rng, pure_m4)
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

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    fn rng() -> StdRng {
        StdRng::seed_from_u64(0)
    }

    /// The post-lapse path (FUN_00ce2fe0) fires only on a lapse that is NOT
    /// the item's first repetition. The binary trigger (FUN_00cf5b50:28) is
    /// `item[+0xb9] (lapse_ordinal) != 0 AND item[+0xb7]
    /// (post_lapse_family) == 1`. The prior Rust code used the inverted
    /// heuristic `grade < 3 && repetition == 0` (first-repetition lapses),
    /// which is essentially backwards. Verified against the Python canonical
    /// package (sm20/pipeline.py:287-328).
    #[test]
    fn post_lapse_fires_on_subsequent_lapse_not_first_repetition() {
        let mut coll = SM20CollectionState::default();

        // First review of a fresh item (repetition=0), grade=1 (lapse).
        // This is the item's FIRST repetition -> NOT post-lapse, even though
        // it's a lapse. post_lapse_family should be set, but lapse_ordinal
        // stays 0 (the binary: +0xb9 is 0 only on the very first repetition).
        let fresh = SM20State::default();
        let r1 = review(&fresh, 1, 0.0, 10, &mut coll, 0, true, false, &mut rng(), false);
        // After a first-repetition lapse: ordinal stays 0, so trigger is false.
        assert_eq!(
            r1.state.post_lapse_family, 0,
            "first-repetition lapse: family should be 0 (repetition was 0)"
        );
        assert_eq!(
            r1.state.lapse_ordinal, 0,
            "first-repetition lapse: ordinal should be 0"
        );

        // Now take an established item (repetition=3, so prior reviews exist)
        // and lapse it. This is a SUBSEQUENT lapse -> post-lapse markers set.
        let established = SM20State {
            stability: 30.0,
            difficulty: 0.4,
            repetition: 3,
            lapses: 0,
            interval: 30.0,
            ..Default::default()
        };
        let r2 = review(&established, 1, 30.0, 10, &mut coll, 30, true, false, &mut rng(), false);
        assert_eq!(
            r2.state.post_lapse_family, 1,
            "subsequent lapse: family must be 1 (post-lapse branch)"
        );
        assert_eq!(
            r2.state.lapse_ordinal, 4,
            "subsequent lapse: ordinal = prior repetition + 1"
        );

        // A recall (grade>=3) on an established item does NOT set post-lapse.
        let r3 = review(&established, 4, 30.0, 10, &mut coll, 30, true, false, &mut rng(), false);
        assert_ne!(
            r3.state.post_lapse_family, 1,
            "recall must not set the post-lapse branch"
        );
    }
}
