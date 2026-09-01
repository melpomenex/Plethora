## ADDED Requirements

### Requirement: Production scheduler is FSRS-7
The system SHALL use FSRS-7 from vendored upstream PR #426 as the sole production scheduling algorithm, constructed with exactly 34 default parameters via `FSRS::new(&DEFAULT_PARAMETERS)`.

#### Scenario: Explicit FSRS-7 construction
- **WHEN** a production review is scheduled
- **THEN** the scheduler uses 34-parameter FSRS-7 model, not FSRS-6 defaults

#### Scenario: Fractional elapsed time
- **WHEN** a review occurs 30 minutes after the previous review
- **THEN** elapsed time passed to FSRS-7 is approximately 0.0208333 days, not rounded to 0 or 1

### Requirement: Dual-trace memory state persistence
The system SHALL persist `stability`, `stability_fast`, and `difficulty` for FSRS-7 learning items.

#### Scenario: State after review
- **WHEN** a card is reviewed with FSRS-7
- **THEN** all three memory state fields are stored and survive reload/sync

### Requirement: Four-button review ratings
Production review UI SHALL expose only Again, Hard, Good, and Easy (ratings 1–4).

#### Scenario: No six-grade production UI
- **WHEN** a user reviews a flashcard in production mode
- **THEN** six-grade Precision/Adaptive controls are not shown

### Requirement: Legacy scheduler code preserved
Historical scheduler implementations SHALL remain compiled and testable but SHALL NOT be user-selectable.

#### Scenario: Selectable catalog
- **WHEN** a user views learning settings
- **THEN** only FSRS-7 is offered as the scheduler
