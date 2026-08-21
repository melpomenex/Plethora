## ADDED Requirements

### Requirement: SM-20 runs the V4 interval formula

The `sm20` algorithm type SHALL compute every scheduled interval using the V4 (SM-20 proper) seven-parameter polynomial formula. The implementation SHALL NOT select the V2 (SM-19 compatible) or V6 (FSRS-style) formula for any `sm20` item, regardless of any `version` value present in persisted state.

#### Scenario: New SM-20 item schedules via V4

- **WHEN** a learning item with `algorithm_type = "sm20"` is reviewed for the first time with a passing grade
- **THEN** the next interval SHALL be computed by `interval_v4` applied as a stability-increase multiplier (the final `stability * sinc` step), matching the reference `sm20_reference.py` semantics
- **AND** the result SHALL differ from what the V2 formula would produce for the same DSR inputs

#### Scenario: Persisted version field is ignored

- **WHEN** a learning item's `algorithm_state` JSON contains `"version": 2` (the historical default) and the item is reviewed as `sm20`
- **THEN** the scheduler SHALL still use the V4 formula
- **AND** no error SHALL be raised about the ignored field

#### Scenario: V4 parameter mapping matches the reference

- **WHEN** `compute_next_interval(5.0, 0.3, 3)` is invoked with the SM-20 version
- **THEN** the intermediate `interval_v4` SHALL be called with `(diff_frac, stab_xform, 0.8, 0.0, 0.9, stab_xform, repetition)` and the result SHALL equal `33.54` (±1e-8) after the `stability * sinc` multiply, pinning the parameter order against `sm20_reference.py`

### Requirement: V4 final step multiplies by previous stability

The SM-20 implementation SHALL compute the next interval as `clamp(stability * sinc, 1.0, STABILITY_MAX)` for all formula versions, where `sinc` is the output of the version-specific formula. This multiply is correct per the reference and SHALL NOT be removed or made conditional on the version.

#### Scenario: Stability multiply is applied for V4

- **WHEN** a V4 `sinc` value of `6.708` is computed for an item with `stability = 5.0`
- **THEN** the resulting new stability SHALL be `33.54` (5.0 × 6.708), not `6.708`

### Requirement: Bayesian matrices are persisted across sessions

The SM-20 implementation SHALL persist the 9,261-element `interval_matrix` (f64) and `count_matrix` (u32) to durable storage, keyed globally, so that observations from prior review sessions influence scheduling in later sessions.

#### Scenario: Matrices survive an app restart

- **WHEN** a user reviews an SM-20 item, then closes and reopens the app, then reviews another SM-20 item
- **THEN** the second review's Bayesian smoothing SHALL incorporate the observation recorded by the first review
- **AND** the `count_matrix` cell for the first review's (repetition, stability, difficulty) index SHALL be at least 1 after the restart

#### Scenario: First-run cold start

- **WHEN** the app launches with no persisted matrices and a user reviews an SM-20 item
- **THEN** the review SHALL succeed using the Bayesian prior (`interval_initial`) for the relevant cell
- **AND** an `sm20_matrices` row SHALL be created with the updated matrices

### Requirement: Each graded review updates the matrices

After computing a scheduled interval for an `sm20` item, the implementation SHALL call the matrix-update routine (`record_review`) with the item's pre-review stability, difficulty, repetition, and the interval actually used, then persist the updated matrices.

#### Scenario: Successful review increments the count matrix

- **WHEN** an SM-20 item with `difficulty = 0.3`, `stability = 5.0`, `repetition = 3` is reviewed and scheduled to a 25-day interval
- **THEN** the `count_matrix` cell at the corresponding `(repetition-1, stability_to_index-1, difficulty_to_index-1)` index SHALL increment by 1
- **AND** the `interval_matrix` cell SHALL hold the running average incorporating 25.0

#### Scenario: Matrix update does not corrupt unrelated cells

- **WHEN** an SM-20 review records an observation
- **THEN** only the single cell corresponding to the item's pre-review indices SHALL change
- **AND** all other cells SHALL retain their prior values

### Requirement: FSRS-family branch is absent from the SM-20 module

The SM-20 module SHALL NOT contain the FSRS-family expert-mixture code path (the three-expert forgetting model, its 35-element parameter block, the per-item `algorithm_branch` dispatch, or the `review_fsrs` function). FSRS scheduling remains available via the separate `fsrs` algorithm type.

#### Scenario: algorithm_branch field is ignored

- **WHEN** a persisted `algorithm_state` JSON contains `"algorithm_branch": 1`
- **THEN** the SM-20 scheduler SHALL ignore it and run the classic V4 path
- **AND** no FSRS-family function SHALL be invoked

#### Scenario: Deserialization compatibility is preserved

- **WHEN** an `algorithm_state` JSON blob containing `algorithm_branch` and `version` fields is deserialized
- **THEN** deserialization SHALL succeed
- **AND** the scheduler SHALL proceed using V4 with no FSRS dispatch

### Requirement: SM-19 remains available via the sm2 algorithm

Users who want SM-19-style scheduling SHALL select the `sm2` algorithm type. The `sm2` algorithm's existing behavior SHALL be unchanged by this change.

#### Scenario: sm2 item is unaffected

- **WHEN** a learning item with `algorithm_type = "sm2"` is reviewed
- **THEN** the `SM2Algorithm::next_state` path SHALL be used
- **AND** the SM-20 V4 changes SHALL not alter the computed interval
