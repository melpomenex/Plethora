## ADDED Requirements

### Requirement: Compact sync diagnostics summary

The Sync settings view SHALL present diagnostics as a collapsed-by-default summary rather than rendering the complete telemetry history inline. The summary SHALL expose the current diagnostics state, latest phase/outcome, and whether an error is present without requiring the user to scroll past the diagnostics section.

#### Scenario: Sync settings opens with diagnostics collapsed

- **WHEN** the user opens Sync settings
- **THEN** the diagnostics card shows its compact summary and disclosure control
- **AND** the detailed telemetry rows are not expanded into the page layout
- **AND** device-sync and real-time-sync controls remain accessible without scrolling through the telemetry history

#### Scenario: User expands diagnostics

- **WHEN** the user activates the diagnostics disclosure control
- **THEN** the detailed view becomes visible in a bounded, vertically scrollable region
- **AND** the control exposes its expanded state to assistive technology
- **AND** expanding the details does not resize the entire settings page to the full retained telemetry history

#### Scenario: Recent sync error is present

- **WHEN** the latest retained sync sample has an error outcome
- **THEN** the collapsed summary visibly indicates the error state and latest phase
- **AND** the view does not unexpectedly auto-scroll or expand the diagnostics table

### Requirement: Full diagnostics report remains available

The existing Copy report action SHALL include all retained sync telemetry samples and startup request counts, regardless of whether the diagnostics details are collapsed or visually bounded.

#### Scenario: User copies diagnostics while collapsed

- **WHEN** the user activates Copy report while diagnostics are collapsed
- **THEN** the clipboard receives a serialized report containing the retained telemetry and startup request data
- **AND** the UI confirms success or reports that copying failed
