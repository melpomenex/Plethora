## ADDED Requirements

### Requirement: Review history replay migration
The system SHALL reconstruct FSRS-7 memory state by replaying canonical review history, not by converting legacy stability/difficulty values.

#### Scenario: Mature user migration
- **WHEN** an item with 5000+ historical reviews is migrated
- **THEN** FSRS-7 state is derived from replayed 1–4 ratings with fractional elapsed intervals
- **AND** review count is unchanged
- **AND** due date is preserved

#### Scenario: Idempotent migration
- **WHEN** migration runs twice on the same item
- **THEN** the second run produces identical FSRS-7 state

### Requirement: Legacy state preservation for rollback
The system SHALL archive pre-migration `algorithm_type` and `algorithm_state` before overwriting to FSRS-7.

#### Scenario: Precision item migration
- **WHEN** an item with `algorithm_type = precision` is migrated
- **THEN** `legacy_algorithm_type` is set to `precision`
- **AND** `algorithm_type` becomes `fsrs`

### Requirement: Legacy parameter invalidation
FSRS parameter vectors of length 17, 19, or 21 SHALL NOT be passed to FSRS-7.

#### Scenario: Old personalized weights
- **WHEN** stored weights have length 21
- **THEN** FSRS-7 uses default 34-parameter vector until re-optimized
