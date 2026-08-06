## ADDED Requirements

### Requirement: Per-document interval modifier
Each document SHALL have an `interval_modifier` property (range: 0.1 to 5.0, default 1.0) that multiplies the calculated scheduling interval after FSRS processing.

#### Scenario: Default modifier has no effect
- **WHEN** a document has `interval_modifier = 1.0` and FSRS computes a 10-day interval
- **THEN** the final interval SHALL be 10 days

#### Scenario: Modifier accelerates review pace
- **WHEN** a document has `interval_modifier = 0.5` and FSRS computes a 10-day interval
- **THEN** the final interval SHALL be 5 days (rounded)

#### Scenario: Modifier slows review pace
- **WHEN** a document has `interval_modifier = 3.0` and FSRS computes a 10-day interval
- **THEN** the final interval SHALL be 30 days

### Requirement: Interval modifier UI control
The interval modifier SHALL be editable via a numeric input in the Document Details panel and the Reader Header, with range 0.1x to 5.0x and step 0.1.

#### Scenario: User adjusts interval modifier
- **WHEN** the user changes the interval modifier from 1.0x to 2.0x in Document Details
- **THEN** the value SHALL persist to the database and apply to the next rating/scheduling action

#### Scenario: Extreme value warning
- **WHEN** the user sets the interval modifier below 0.3x or above 3.0x
- **THEN** the UI SHALL display a warning indicating the extreme pacing change
