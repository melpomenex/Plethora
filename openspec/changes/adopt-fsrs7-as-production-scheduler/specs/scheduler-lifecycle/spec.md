## ADDED Requirements

### Requirement: Scheduler lifecycle status
Each scheduler ID SHALL have a lifecycle status: Production, Legacy, or Internal.

#### Scenario: Production scheduler
- **WHEN** querying lifecycle for `fsrs`
- **THEN** status is Production with user-facing label FSRS-7

#### Scenario: Legacy schedulers
- **WHEN** querying lifecycle for `precision`, `adaptive`, or `classic`
- **THEN** status is Legacy and not selectable in production UI

### Requirement: Production dispatch normalization
Stale persisted scheduler settings SHALL be normalized to `fsrs` before scheduling.

#### Scenario: Stale precision setting
- **WHEN** settings contain `algorithm = precision`
- **THEN** production review dispatch uses FSRS-7 with `algorithm_type = fsrs`
