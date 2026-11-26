# Study Mode End-to-End Validation Specification

## ADDED Requirements

### Requirement: Opt-In Privacy-Preserving Efficacy Measurement
Learning efficacy measurement SHALL be disabled by default and SHALL only record anonymized local `study_efficacy_events` when explicitly enabled by the user.

#### Scenario: Efficacy measurement disabled by default
- **WHEN** a user uses Study Mode with default settings
- **THEN** zero `study_efficacy_events` rows are recorded.

### Requirement: Feature-Disabled Regression Guarantee
When Study Mode is disabled in Settings, all Study Mode entry points SHALL be hidden, zero educational AI generation requests SHALL occur, and previously cached artifacts SHALL remain preserved unless explicitly deleted.

#### Scenario: Disabling Study Mode preserves existing artifacts
- **WHEN** a user creates Study Mode artifacts and subsequently disables Study Mode in Settings
- **THEN** entry points are hidden and existing `study_mode_artifacts` remain in SQLite.
