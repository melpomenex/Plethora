## MODIFIED Requirements

### Requirement: Persistence of Scheduling Data
Document scheduling data MUST be persisted to the database. When a document has an `interval_modifier` other than 1.0, the computed FSRS interval SHALL be multiplied by the modifier before persisting.

#### Scenario: Document scheduling persistence
- **Given** a document is rated
- **When** the rating is processed
- **Then** the document's `next_reading_date`, `stability`, `difficulty`, `reps`, and `total_time_spent` should be updated in the database
- **And** the new schedule should be reflected in the Queue view

#### Scenario: Document with interval modifier
- **WHEN** a document with `interval_modifier = 2.0` is rated and FSRS computes a 10-day interval
- **THEN** the persisted `next_reading_date` SHALL be 20 days from now (10 * 2.0)
