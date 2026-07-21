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
//! raw      = dispersal(adjusted)              (normal path,    cf5100)
//!          | post_lapse(adjusted, priority%)  (lapse w/ prior rep, ce2fe0)
//! interval = clamp(round(clamp(raw, 0.7, 44530)), 1, 44530)
//! interval = min_growth_guard(interval, used) (pass w/ prior rep, cf4b90)
//! defaults : w = [6, 14, 45, 25, 10]
//! ```
//!
//! The post-lapse/normal choice is made per review from THIS review's grade
//! and the pre-review counters (`FUN_00ce7380` markers are same-pass
//! scratch — see `review()`); post-lapse therefore shortens the lapsed
//! review's own interval, never the following pass.
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

/// Stable public identifiers for the five Algorithm Arena competitors.
/// The order is part of the preview and persisted-provenance contract.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ArenaModelId {
    Sm2,
    Sm15,
    Sm19,
    Sm20,
    Fsrs,
}

pub const ARENA_MODEL_IDS: [ArenaModelId; 5] = [
    ArenaModelId::Sm2,
    ArenaModelId::Sm15,
    ArenaModelId::Sm19,
    ArenaModelId::Sm20,
    ArenaModelId::Fsrs,
];

impl ArenaModelId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Sm2 => "sm2",
            Self::Sm15 => "sm15",
            Self::Sm19 => "sm19",
            Self::Sm20 => "sm20",
            Self::Fsrs => "fsrs",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::Sm2 => "SM-2",
            Self::Sm15 => "SM-15",
            Self::Sm19 => "SM-19",
            Self::Sm20 => "SM-20",
            Self::Fsrs => "FSRS",
        }
    }

    pub const fn index(self) -> usize {
        match self {
            Self::Sm2 => 0,
            Self::Sm15 => 1,
            Self::Sm19 => 2,
            Self::Sm20 => 3,
            Self::Fsrs => 4,
        }
    }
}

// Re-export index mappers for backward compatibility with the old sm20.rs API
pub use kernel::init_new_item as init_kernel_item;
pub use model3::{d_index as difficulty_to_index, r_index};

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
    /// Deterministically finalized intervals for SM-2/SM-15/SM-19/SM-20/FSRS.
    /// These are diagnostics and choices; the adaptive weights are still
    /// trained only from recall outcomes.
    pub model_intervals: [f64; 5],
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
/// 6. Applies retention adjustment, then dispersal — or, when THIS review is
///    a lapse on an item with a prior repetition, the post-lapse curve
///    (`FUN_00ce2fe0`; the markers are same-pass scratch, see below) — then
///    clamping, and on passes with a prior repetition the minimum-growth
///    guard (`FUN_00cf4b90`)
/// 7. Writes back `previous_interval` for M1/M2/M3 state
///
/// `post_lapse_x` is the element's priority percent (0-100) — the binary's
/// `item[+0x16]`, loaded from the priority queue (`FUN_00cb0400`). It only
/// affects the post-lapse curve: 0 (top priority) keeps the short adjusted
/// interval, 100 pulls it toward the 9-day target. Pass 0.0 when the host
/// has no priority concept.
///
/// For `preview()` (showing the user what each button will give), use
/// `commit=false` — this runs all models in scratch mode without mutating
/// collection state. When `disperse` is false the result is fully
/// deterministic: the rng is withheld from finalization so neither dispersal
/// nor the post-lapse jitter fires (previews must not re-roll on every fetch).
#[allow(clippy::too_many_arguments)]
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
    post_lapse_x: f64,
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

    // --- M3: SM-19 raw matrix scheduler (45%) ---
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

    // --- Scheduling-family markers (FUN_00ce7380, decoded 2026-07-20) ---
    // The binary rewrites item[+0xb7]/[+0xb9] on EVERY review — from the
    // current grade and the PRE-review repetition/lapse counters — before
    // computing the M4 slot, and the finalizer (FUN_00cf5b50:28) reads them
    // later in the SAME pass (the record builder FUN_00d88ef0 never
    // initializes them, so a cross-review read would see garbage). They are
    // per-review scratch, NOT cross-review state:
    //   lapse: family = 1, ordinal = 0 if pre_reps == 0 else pre_lapses + 1
    //   pass:  family = pre_reps + 1, ordinal = pre_lapses
    // Post-lapse trigger: ordinal != 0 && family == 1 — i.e. THIS review is
    // a lapse on an item with a prior repetition; the curve applies to the
    // lapsed review's own interval. The min-growth guard (FUN_00cf4b90 via
    // FUN_00cf5b50:53) fires when family > 1 — a pass with a prior
    // repetition. Pre-review counters = the binary's item[+0x22]/[+0x24];
    // m3_state tracks exactly those semantics (as does m1_state).
    let pre_reps = state.m3_state.repetitions;
    let pre_lapses = state.m3_state.lapses;
    let (post_lapse_family, lapse_ordinal) = if grade < 3 {
        (
            1u32,
            if pre_reps == 0 {
                0
            } else {
                pre_lapses.saturating_add(1).min(65535)
            },
        )
    } else {
        (pre_reps.saturating_add(1).min(65535), pre_lapses.min(65535))
    };
    let post_lapse_mode = lapse_ordinal != 0 && post_lapse_family == 1;

    // --- Finalize ---
    // Only hand the rng to finalization on the stochastic (committed) path.
    // Previews call with disperse=false and must stay deterministic — the
    // post-lapse jitter would otherwise re-roll the shown interval every fetch.
    let fin = finalize(
        ensemble_val,
        fi,
        post_lapse_mode,
        post_lapse_x,
        disperse,
        if disperse { Some(rng) } else { None },
        m1_review.used_interval,
        post_lapse_family > 1,
    );

    let slot_stabilities = [m1, m2, m3, m4, m5];
    let model_intervals = slot_stabilities.map(|slot| {
        finalize(
            slot,
            fi,
            post_lapse_mode,
            post_lapse_x,
            false,
            None::<&mut rand::rngs::StdRng>,
            m1_review.used_interval,
            post_lapse_family > 1,
        )
        .interval as f64
    });

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
    // The dispatch markers computed above are persisted (the binary keeps
    // them in the item record) but are never read back for scheduling — the
    // next review recomputes them from its own grade + pre-review counters.
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
        slot_stabilities: Some(slot_stabilities),
        m5_memory: next_m5_memory,
    };

    SM20ReviewResult {
        state: new_state,
        interval_days: final_interval as f64,
        retrievability: m4_result.a,
        model_intervals,
    }
}

/// Preview intervals for each rating button (deterministic — no dispersal).
///
/// Runs the full ensemble in scratch mode (`commit=false`) for each rating.
/// `post_lapse_x` = element priority percent (see [`review`]).
pub fn preview(
    state: &SM20State,
    elapsed_days: f64,
    fi: u8,
    collection: &SM20CollectionState,
    today: i32,
    rng: &mut impl rand::Rng,
    pure_m4: bool,
    post_lapse_x: f64,
) -> SM20PreviewIntervals {
    let grades = preview_grades(
        state,
        elapsed_days,
        fi,
        collection,
        today,
        rng,
        pure_m4,
        post_lapse_x,
    );
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
#[allow(clippy::too_many_arguments)]
pub fn preview_grades(
    state: &SM20State,
    elapsed_days: f64,
    fi: u8,
    collection: &SM20CollectionState,
    today: i32,
    rng: &mut impl rand::Rng,
    pure_m4: bool,
    post_lapse_x: f64,
) -> [f64; 6] {
    preview_grade_results(
        state,
        elapsed_days,
        fi,
        collection,
        today,
        rng,
        pure_m4,
        post_lapse_x,
    )
    .map(|result| result.interval_days)
}

/// Preview the complete deterministic ensemble output for every native grade.
/// This is the Arena data source: it uses the same scratch pass as the legacy
/// interval preview and never mutates the caller's collection state.
#[allow(clippy::too_many_arguments)]
pub fn preview_grade_results(
    state: &SM20State,
    elapsed_days: f64,
    fi: u8,
    collection: &SM20CollectionState,
    today: i32,
    rng: &mut impl rand::Rng,
    pure_m4: bool,
    post_lapse_x: f64,
) -> [SM20ReviewResult; 6] {
    // Clone collection state so we don't mutate it during preview
    let mut coll = SM20CollectionState {
        m2_optimizer: collection.m2_optimizer.clone(),
        m3_matrices: collection.m3_matrices.clone(),
        arena: collection.arena.clone(),
        fsrs_params: collection.fsrs_params.clone(),
        m4_params: collection.m4_params.clone(),
    };

    std::array::from_fn(|grade| {
        review(
            state,
            grade as i32,
            elapsed_days,
            fi,
            &mut coll,
            today,
            false,
            false,
            rng,
            pure_m4,
            post_lapse_x,
        )
    })
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
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn rng() -> StdRng {
        StdRng::seed_from_u64(0)
    }

    fn established_item() -> SM20State {
        SM20State {
            stability: 30.0,
            difficulty: 0.4,
            repetition: 3,
            lapses: 0,
            interval: 30.0,
            m1_state: model1::M1ItemState {
                last_review_day: 0,
                previous_interval: 30,
                repetitions: 3,
                lapses: 0,
            },
            m2_state: model2::M2ItemState {
                last_review_day: 0,
                previous_interval: 30,
                repetitions: 3,
                lapses: 0,
                a_factor: 3.0,
                u_factor: 1.0,
            },
            m3_state: model3::M3ItemState {
                last_review_day: 0,
                previous_interval: 30,
                repetitions: 3,
                lapses: 0,
                stability: 30.0,
                difficulty: 0.4,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    /// Post-lapse timing + trigger, per the DECOMPILES (func_000000ce7380.c /
    /// func_000000cf5b50.c — NOT the Python package, which encoded the wrong
    /// deferred semantics until 2026-07-20): `FUN_00ce7380` rewrites
    /// `item[+0xb7]/[+0xb9]` on EVERY review from the current grade and the
    /// PRE-review counters, and `FUN_00cf5b50:28` reads them in the SAME
    /// pass. So the post-lapse curve applies to the lapsed review's own
    /// interval, and a first-review lapse (pre-reps == 0 → ordinal = 0)
    /// stays on the normal path.
    #[test]
    fn post_lapse_applies_to_the_lapsed_review_itself() {
        let mut coll = SM20CollectionState::default();

        // Fresh item, first review is a lapse: pre-review reps == 0 →
        // family = 1 but ordinal = 0 → NORMAL path. Markers stored exactly
        // as the binary writes them: (1, 0).
        let fresh = SM20State::default();
        let r1 = review(
            &fresh,
            1,
            0.0,
            10,
            &mut coll,
            0,
            true,
            false,
            &mut rng(),
            false,
            0.0,
        );
        assert_eq!(
            r1.state.post_lapse_family, 1,
            "lapse dispatch always writes family = 1"
        );
        assert_eq!(
            r1.state.lapse_ordinal, 0,
            "first-review lapse: ordinal = 0 (pre-reps 0)"
        );

        // Established item (pre-review m3 reps = 3), lapse: the post-lapse
        // curve fires for THIS review → interval lands in [1, 11].
        // Markers: family = 1, ordinal = pre-review lapses + 1 = 1.
        let r2 = review(
            &established_item(),
            1,
            30.0,
            10,
            &mut coll,
            30,
            true,
            false,
            &mut rng(),
            false,
            0.0,
        );
        assert!(
            (1.0..=11.0).contains(&r2.interval_days),
            "lapse on an established item must take the post-lapse path: {}",
            r2.interval_days
        );
        assert_eq!(r2.state.post_lapse_family, 1);
        assert_eq!(r2.state.lapse_ordinal, 1, "ordinal = pre-review lapses + 1");

        // A pass on the established item: normal path (family = pre_reps+1,
        // ordinal = pre_lapses) + the min-growth guard.
        let r3 = review(
            &established_item(),
            4,
            30.0,
            10,
            &mut coll,
            30,
            true,
            false,
            &mut rng(),
            false,
            0.0,
        );
        assert_eq!(r3.state.post_lapse_family, 4);
        assert_eq!(r3.state.lapse_ordinal, 0);
    }

    /// The persisted markers are per-review scratch — two states differing
    /// ONLY in the stored `+0xb7`/`+0xb9` values must schedule identically.
    /// (The prior build read them across reviews and applied post-lapse one
    /// review late, clamping the pass AFTER a lapse to ≤ 11 days — which
    /// the binary never does.)
    #[test]
    fn persisted_markers_do_not_drive_scheduling() {
        let mut coll = SM20CollectionState::default();
        let base = established_item();
        let armed = SM20State {
            post_lapse_family: 1,
            lapse_ordinal: 4,
            ..base.clone()
        };
        let ra = review(
            &armed,
            4,
            30.0,
            10,
            &mut coll,
            30,
            false,
            false,
            &mut rng(),
            false,
            0.0,
        );
        let rb = review(
            &base,
            4,
            30.0,
            10,
            &mut coll,
            30,
            false,
            false,
            &mut rng(),
            false,
            0.0,
        );
        assert_eq!(
            ra.interval_days, rb.interval_days,
            "stored markers must not affect scheduling"
        );
    }

    /// End-to-end differential pins against the Python reference package
    /// (`sm20/pipeline.py`, generated 2026-07-20 after the same-review
    /// post-lapse, min-growth, and arena-input fixes landed on both sides).
    /// Deterministic: commit=false + disperse=false, and none of these
    /// inputs reach M2's probabilistic tail-fix, so the rng is never drawn.
    ///
    /// Python values: established pass → 49; established lapse → 4;
    /// fresh lapse → 2. The lapse pin here is 3, not 4, because the
    /// reference's rng-less finalize still applies the deterministic
    /// seed-0 Delphi-LCG jitter (~×1.53) on the post-lapse path, while this
    /// port deliberately withholds jitter from previews (the un-jittered
    /// curve value: adjusted 2.7956 → round → 3). Production commits pass
    /// `disperse=true` with a live rng, so committed post-lapse intervals
    /// jitter in both implementations.
    #[test]
    fn pipeline_matches_python_reference_end_to_end() {
        // A: established pass (grade 4, elapsed 30) → 49 (exact match).
        let mut coll = SM20CollectionState::default();
        let a = review(
            &established_item(),
            4,
            30.0,
            10,
            &mut coll,
            30,
            false,
            false,
            &mut rng(),
            false,
            0.0,
        );
        assert_eq!(
            a.interval_days, 49.0,
            "established pass must match the reference"
        );

        // B: established lapse (grade 1) → post-lapse path, no-jitter → 3.
        let b = review(
            &established_item(),
            1,
            30.0,
            10,
            &mut coll,
            30,
            false,
            false,
            &mut rng(),
            false,
            0.0,
        );
        assert_eq!(
            b.interval_days, 3.0,
            "established lapse (post-lapse curve, no preview jitter)"
        );

        // C: fresh-item lapse (grade 1, elapsed 0; top-level difficulty 0.5 =
        // the reference's default) → normal path → 2 (exact match).
        let fresh = SM20State {
            difficulty: 0.5,
            ..Default::default()
        };
        let c = review(
            &fresh,
            1,
            0.0,
            10,
            &mut coll,
            0,
            false,
            false,
            &mut rng(),
            false,
            0.0,
        );
        assert_eq!(c.interval_days, 2.0, "fresh lapse must match the reference");
    }

    /// The minimum-growth guard (`FUN_00cf4b90`) applies to passes with a
    /// prior repetition: the final interval can never fall below
    /// `round(used * floor + 0.5)` where floor = max(1.7·used^-0.1, 1.1)
    /// for used < 70.
    #[test]
    fn pass_reviews_enforce_minimum_growth() {
        let mut coll = SM20CollectionState::default();
        // Reviewed 30 days after the last review: floor = 1.7 * 30^-0.1 ≈ 1.209,
        // so the interval must be ≥ round(30 * 1.209 + 0.5) = 37.
        let r = review(
            &established_item(),
            4,
            30.0,
            10,
            &mut coll,
            30,
            false,
            false,
            &mut rng(),
            false,
            0.0,
        );
        let floor = 1.7 * (30f64).powf(-0.1);
        let min_interval = (30.0 * floor + 0.5).round_ties_even();
        assert!(
            r.interval_days >= min_interval,
            "pass interval {} must respect the min-growth floor {}",
            r.interval_days,
            min_interval
        );
    }

    #[test]
    fn arena_preview_is_deterministic_complete_and_non_mutating() {
        let collection = SM20CollectionState::default();
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../src/shared/sm20ArenaParityFixture.json"
        ))
        .expect("shared Arena parity fixture");
        let state: SM20State =
            serde_json::from_value(fixture["state"].clone()).expect("shared fixture state");
        let elapsed_days = fixture["elapsed_days"].as_f64().expect("elapsed days");
        let before = serde_json::to_vec(&(
            &collection.m2_optimizer,
            &collection.m3_matrices,
            &collection.arena,
            &collection.fsrs_params,
            &collection.m4_params,
        ))
        .unwrap();

        let first = preview_grade_results(
            &state,
            elapsed_days,
            DEFAULT_FI,
            &collection,
            30,
            &mut StdRng::seed_from_u64(0),
            false,
            0.0,
        );
        let second = preview_grade_results(
            &state,
            elapsed_days,
            DEFAULT_FI,
            &collection,
            30,
            &mut StdRng::seed_from_u64(0),
            false,
            0.0,
        );

        assert_eq!(first.len(), 6);
        let fixture_model_order: Vec<&str> = fixture["model_order"]
            .as_array()
            .expect("model order")
            .iter()
            .map(|value| value.as_str().expect("model id"))
            .collect();
        assert_eq!(
            ARENA_MODEL_IDS.map(ArenaModelId::as_str).as_slice(),
            fixture_model_order.as_slice(),
        );
        assert_eq!(
            ARENA_MODEL_IDS,
            [
                ArenaModelId::Sm2,
                ArenaModelId::Sm15,
                ArenaModelId::Sm19,
                ArenaModelId::Sm20,
                ArenaModelId::Fsrs,
            ],
            "the persisted Arena slots are a public compatibility contract",
        );
        for result in &first {
            assert!(result.interval_days.is_finite() && result.interval_days >= 1.0);
            assert!(
                result.state.slot_stabilities.is_some(),
                "raw model slots stay available for later scoring"
            );
            assert!(result
                .model_intervals
                .iter()
                .all(|interval| interval.is_finite() && *interval >= 1.0));
        }
        let fixture_grades = fixture["grades"].as_array().expect("fixture grades");
        let mut expected_intervals = [0.0; 6];
        for (index, (expected, repeated)) in fixture_grades.iter().zip(&second).enumerate() {
            let interval = expected["recommendation"].as_f64().expect("recommendation");
            let slots: [f64; 5] =
                serde_json::from_value(expected["candidates"].clone()).expect("candidate fixture");
            let range: [f64; 2] =
                serde_json::from_value(expected["range"].clone()).expect("range fixture");
            expected_intervals[index] = interval;
            assert_eq!(
                first[index].interval_days, interval,
                "grade {index} ensemble fixture"
            );
            assert_eq!(
                first[index].model_intervals, slots,
                "grade {index} candidate fixture"
            );
            assert_eq!(
                slots.iter().copied().fold(f64::INFINITY, f64::min),
                range[0]
            );
            assert_eq!(
                slots.iter().copied().fold(f64::NEG_INFINITY, f64::max),
                range[1]
            );
            assert_eq!(first[index].interval_days, repeated.interval_days);
            assert_eq!(first[index].model_intervals, repeated.model_intervals);
            assert_eq!(
                first[index].state.slot_stabilities,
                repeated.state.slot_stabilities
            );
        }
        let fixture_weights: [f64; 5] =
            serde_json::from_value(fixture["weights"].clone()).expect("weight fixture");
        assert_eq!(collection.arena.weights, fixture_weights);
        assert_eq!(
            fixture["custom_bounds"]["min_days"].as_f64().unwrap(),
            1.0 / 1_440.0,
        );
        assert_eq!(
            fixture["custom_bounds"]["max_days"].as_f64().unwrap(),
            STABILITY_MAX,
        );

        let legacy = preview_grades(
            &state,
            elapsed_days,
            DEFAULT_FI,
            &collection,
            30,
            &mut StdRng::seed_from_u64(0),
            false,
            0.0,
        );
        assert_eq!(legacy, expected_intervals);

        let committed_grade = fixture["committed_grade"].as_i64().unwrap() as i32;
        let mut commit_collection = SM20CollectionState {
            m2_optimizer: collection.m2_optimizer.clone(),
            m3_matrices: collection.m3_matrices.clone(),
            arena: collection.arena.clone(),
            fsrs_params: collection.fsrs_params.clone(),
            m4_params: collection.m4_params.clone(),
        };
        let committed = review(
            &state,
            committed_grade,
            elapsed_days,
            DEFAULT_FI,
            &mut commit_collection,
            elapsed_days as i32,
            true,
            false,
            &mut StdRng::seed_from_u64(0),
            false,
            0.0,
        );
        assert_eq!(
            committed.interval_days,
            fixture["committed_interval"].as_f64().unwrap(),
        );
        assert_eq!(
            serde_json::json!({
                "stability": committed.state.stability,
                "difficulty": committed.state.difficulty,
                "m1_state": committed.state.m1_state,
                "m2_state": committed.state.m2_state,
                "m3_state": committed.state.m3_state,
                "slot_stabilities": committed.state.slot_stabilities,
            }),
            fixture["committed_state"],
        );
        assert_eq!(
            commit_collection
                .m2_optimizer
                .cell_cases
                .iter()
                .flatten()
                .sum::<u32>(),
            fixture["committed_collection"]["m2_case_count"]
                .as_u64()
                .unwrap() as u32,
        );
        assert_eq!(
            commit_collection
                .m3_matrices
                .outcome_count
                .iter()
                .sum::<u32>(),
            fixture["committed_collection"]["m3_outcome_count"]
                .as_u64()
                .unwrap() as u32,
        );
        let expected_arena: ArenaState =
            serde_json::from_value(fixture["committed_collection"]["arena"].clone()).unwrap();
        for index in 0..5 {
            assert!(
                (commit_collection.arena.weights[index] - expected_arena.weights[index]).abs()
                    < 1e-14
            );
            assert!(
                (commit_collection.arena.decayed_loss[index] - expected_arena.decayed_loss[index])
                    .abs()
                    < 1e-14
            );
        }
        assert!(
            (commit_collection.arena.decayed_blend_loss - expected_arena.decayed_blend_loss).abs()
                < 1e-14
        );
        assert!(
            (commit_collection.arena.decayed_sm19_loss - expected_arena.decayed_sm19_loss).abs()
                < 1e-14
        );
        assert_eq!(
            commit_collection.arena.total_scored,
            expected_arena.total_scored
        );
        let learned_preview = preview_grade_results(
            &committed.state,
            fixture["post_commit_elapsed_days"].as_f64().unwrap(),
            DEFAULT_FI,
            &commit_collection,
            fixture["post_commit_today"].as_i64().unwrap() as i32,
            &mut StdRng::seed_from_u64(0),
            false,
            0.0,
        );
        for (result, expected) in learned_preview
            .iter()
            .zip(fixture["post_commit_grades"].as_array().unwrap())
        {
            assert_eq!(
                result.interval_days,
                expected["recommendation"].as_f64().unwrap()
            );
            let expected_candidates: [f64; 5] =
                serde_json::from_value(expected["candidates"].clone()).unwrap();
            assert_eq!(result.model_intervals, expected_candidates);
        }
        let mut personalized_collection = SM20CollectionState::default();
        personalized_collection.fsrs_params = Some(
            serde_json::from_value(fixture["personalized_fsrs"]["parameters"].clone()).unwrap(),
        );
        let personalized = preview_grade_results(
            &state,
            elapsed_days,
            DEFAULT_FI,
            &personalized_collection,
            30,
            &mut StdRng::seed_from_u64(0),
            false,
            0.0,
        );
        for (result, expected) in personalized
            .iter()
            .zip(fixture["personalized_fsrs"]["grades"].as_array().unwrap())
        {
            assert_eq!(
                result.model_intervals[4],
                expected["interval"].as_f64().unwrap()
            );
            let actual = result.state.m5_memory.expect("personalized M5 memory");
            assert!(
                (actual.stability - expected["memory"]["stability"].as_f64().unwrap()).abs() < 1e-7
            );
            assert!(
                (actual.difficulty - expected["memory"]["difficulty"].as_f64().unwrap()).abs()
                    < 1e-7
            );
        }

        let after = serde_json::to_vec(&(
            &collection.m2_optimizer,
            &collection.m3_matrices,
            &collection.arena,
            &collection.fsrs_params,
            &collection.m4_params,
        ))
        .unwrap();
        assert_eq!(before, after, "preview must not mutate collection state");
    }
}
