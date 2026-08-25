## Why

The Plethora Precision algorithm module ships all three formula variants (V2/V4/V6), the Bayesian smoothing core, and an FSRS-family branch — but in production only the V2 (Classic 19 compatible) formula ever runs, and the Bayesian matrices and FSRS branch are unreachable dead code. A user who selects the `precision` algorithm is silently getting Classic 19 scheduling, which contradicts the label and the documented behavior (`docs/USER_HANDBOOK.md:265`). The Bayesian learning feature — Plethora Precision's defining capability — has never functioned because the 9,261-element matrices are neither persisted nor passed into the scheduling functions. This was confirmed against the authoritative reverse-engineering reference (`precision_reference.py` / `precision_algorithm.py` from the `precision-kernel-re` project) re-derived directly from `precision-kernel-reference.exe`.

## What Changes

- **Activate V4 as the Plethora Precision formula**: The `precision` algorithm type runs `interval_v4` (the Plethora Precision proper polynomial) instead of defaulting to V2. The version-dispatch field is removed from the per-item state contract; the V4 path is hardcoded for the `precision` algorithm. V2/Classic 19 stays available as the separate, existing `classic` algorithm choice.
- **Confirm V4 math against the reference**: The existing `clamp(stability * sinc, ...)` final step is **correct** — verified against the reference's `compute_next_interval` (`precision_reference.py:463-465`), which applies the identical `stability * sinc` multiply for V2, V4, and V6. V4's output is a stability-increase multiplier (SInc), not an absolute interval. No change to that line; the bug report's "interval explosion" concern is unfounded for V4 as wired.
- **Wire the Bayesian matrices to persistent storage**: Add a per-collection (or per-user) store for the 9,261-element `interval_matrix` (f64) and `count_matrix` (u32). Load them into memory during a review, pass them into `compute_next_interval`, and call `record_review` after each graded review so Plethora Precision actually learns from the user's history.
- **Remove the unreachable FSRS-family branch**: The `algorithm_branch == 1` path (`review_fsrs`, `fsrs_expert_mixture`, `fsrs_review_kernel`, `fsrs_difficulty_update`, `fsrs_lapse_stability`, `fsrs_recall_stability`, `fsrs_init_item`, and the 35-element `FSRS_PARAMS` block) is dead in production — `algorithm_branch` is only ever set to `1` by `fsrs_init_item`, which is only called in tests. This repo already ships a separate, default FSRS-6 implementation (`fsrs::FSRS`), so the embedded FSRS-family code is redundant and not faithful to the reference (the repo's `fsrs_expert_mixture` takes 3 params; the reference's takes 2). Remove it to reduce the module to its actual responsibility.
- **Migration for existing Plethora Precision items**: Items currently stored with `algorithm_type == "precision"` have persisted state with `version: 2`. These continue to compute correctly (V4 will simply produce different, Plethora Precision-correct intervals on the next review). No data migration required; the `version` field becomes ignored/no-op.

## Capabilities

### New Capabilities
- `precision-scheduling-activation`: The runtime behavior contract for the Plethora Precision algorithm — V4 is the active formula, the version field is no longer a runtime switch, and the Bayesian matrices flow from persistent storage through the scheduling path.

### Modified Capabilities
<!-- No existing Plethora Precision spec to modify; the prior `fix-precision-algorithm` change's specs were never archived into openspec/specs/. -->

## Impact

- **`src-tauri/src/algorithms/precision.rs`**: Remove the version-dispatch (`match version`), hardcode V4; delete the FSRS-family branch and `FSRS_PARAMS`; thread matrix persistence through `review`/`review_classic`. ~300 lines removed, signature changes on internal functions.
- **`src/lib/precisionScheduler.ts`**: Matching TypeScript changes for the browser/PWA backend. Same scope as the Rust file.
- **`src-tauri/src/commands/review.rs`**: `apply_precision_review` and `parse_precision_state` updated to load/persist matrices; `parse_precision_state` drops the `version` field (or ignores it).
- **Storage**: New persistence for the two 9,261-element matrices — likely a new SQLite table or a per-collection blob column (design.md decides). Migration required.
- **No breaking API changes**: The Tauri command signatures (`submit_review`, `preview_review_intervals`) and the public `PrecisionState`/`PrecisionReviewResult` types remain stable. The `version` field stays in `PrecisionState` for backward-compatible deserialization but is no longer consulted.
- **Behavior change for existing `precision` users**: Intervals will shift from Classic 19 (V2) values to Plethora Precision (V4) values on subsequent reviews. This is the intended correction, but worth calling out in release notes.
- **Tests**: The pinned `ref_compute_next_interval_v4_v6_fallback` test and FSRS-family tests need updating; V4 reference values are re-validated against `precision_reference.py`.
