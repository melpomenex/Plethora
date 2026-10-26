## MODIFIED Requirements

### Requirement: Passage extract-worthiness

The system SHALL optionally classify passages (fundamental claim, definition, important
example, key argument, formula, process, comparison, supporting detail, transition,
bibliography, low value) with an extract-worthiness score, suggested action, and reason.
Scoring SHALL be computed on demand for recently read viewport content (not pre-computed for
whole documents), cached by chunk hash, surfaced only above a high threshold as an
unobtrusive margin indicator, and fully disableable. When passage scoring is disabled, no
scoring indicators or scoring status warnings SHALL be visible, and transient scoring UI
state SHALL be cleared immediately. When passage scoring is enabled, status warnings for
unavailable model dependencies or missing remote authorization SHALL remain eligible for
display even when scoring cannot run.

#### Scenario: High-worth passage indicator
- **WHEN** a read passage scores above the indicator threshold
- **THEN** a subtle margin indicator appears with one-tap conversion into an extract/card
  candidate

#### Scenario: Bibliography stays quiet
- **WHEN** the user reads bibliography or transition passages
- **THEN** no worthiness indicators appear

#### Scenario: Feature disabled
- **WHEN** the user disables extract suggestions
- **THEN** no scoring runs, no indicators or scoring status warnings appear, and any visible
  scoring UI state is cleared immediately

#### Scenario: Remote authorization warning is cleared when scoring is disabled
- **WHEN** passage scoring is enabled, remote authorization is denied, the authorization
  warning is displayed, and the user then disables passage scoring
- **THEN** the warning disappears immediately and no scoring overlay remains visible

#### Scenario: Model readiness warning while scoring is enabled
- **WHEN** passage scoring is enabled but its model dependency is unavailable
- **THEN** the model-unavailable warning is displayed even though scoring is not ready to run
