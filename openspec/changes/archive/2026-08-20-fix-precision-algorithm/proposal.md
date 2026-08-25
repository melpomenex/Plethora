## Why

The Plethora Precision algorithm implementation (Rust + TypeScript) deviates from the reverse-engineered reference in several critical ways that produce materially different interval schedules. The quantized index-conversion steps for both difficulty and stability are missing, causing the penalty exponent to use raw [0,1] difficulty instead of the reference's [0.05, 0.5] range — making high-difficulty items far too punishing. The stability pre-transform is absent, allowing invalid stability values through the formula. These are correctness bugs, not style differences.

## What Changes

- Fix `difficulty_to_fraction` to quantize through index conversion: `floor(D * 19) + 1` clamped to [1, 10], then divide by 20, yielding [0.05, 0.5]
- Fix `transformed_stability` to quantize through the two-step index process: pre-transform → power(1/STABILITY_POWER) → floor + 1 → pow(STABILITY_POWER) + 2.0, matching the reference's discretization behavior
- Add the missing stability pre-transform (`_stability_pretransform`): clamp NaN/Inf to 44530, values in (-1, 0.7) to 0.7
- Add the `interval_initial` (Bayesian prior) formula with its own constant set (INIT), used for first-review intervals
- Add V4 (7-parameter polynomial) and V6 (FSRS-style double-exponential) formula variants alongside existing V2
- Add the Bayesian 3×3×3 neighbor smoothing core with 21³ interval/count matrices
- Add the UFactor table (20 difficulty-scaled values) for interval calculation
- Add rounding logic with narrow/wide modes (`apply_rounding`)
- Keep existing `success_multiplier`, `rating_to_quality`, `next_difficulty`, and lapse logic as app-level approximations (these have no reference counterpart and are reasonable design choices)
- Update existing tests and add new reference-value tests to lock in correct behavior

## Capabilities

### New Capabilities
- `precision-index-conversions`: Quantized index conversions for difficulty, stability, and retrievability matching the reference's discretization
- `precision-bayesian-smoothing`: 3×3×3 neighbor smoothing core with 21³ matrices and Bayesian prior formula
- `precision-multi-version`: V4 and V6 interval formula variants alongside existing V2

### Modified Capabilities
<!-- No existing Plethora Precision spec to modify -->

## Impact

- **`src-tauri/src/algorithms/precision.rs`**: Core algorithm rewrite — new index conversion functions, interval formulas, Bayesian smoothing, pre-transform
- **`src/lib/precisionScheduler.ts`**: Matching TypeScript implementation for browser/PWA backend
- **`src/lib/__tests__/precisionScheduler.test.ts`**: Updated tests for corrected behavior
- **`src-tauri/src/algorithms/precision.rs` (tests)**: Rust tests updated
- **No breaking API changes**: The `PrecisionState`, `PrecisionReviewResult`, `PrecisionPreviewIntervals` interfaces and the `review()`/`preview()` function signatures remain identical. Existing users' persisted state (stability, difficulty, repetition values) is forward-compatible.
