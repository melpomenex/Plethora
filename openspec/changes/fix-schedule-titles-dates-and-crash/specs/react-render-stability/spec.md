## ADDED Requirements

### Requirement: Pane normalization SHALL be referentially stable for valid layouts

`normalizePane` SHALL return the existing pane object when a pane and all of its descendants already satisfy the persisted pane shape, including valid split-pane children and sizes. It SHALL allocate a replacement only when normalization changes the pane data.

#### Scenario: Valid split pane is normalized repeatedly

- **WHEN** the same valid split pane is normalized across repeated renders
- **THEN** the normalized result retains the original pane identity and does not create a new equivalent child array on each call

#### Scenario: Invalid pane data is normalized

- **WHEN** persisted pane data has invalid children, active tab IDs, or split sizes
- **THEN** normalization returns a valid pane structure while preserving stable identity on subsequent calls once the structure is valid

### Requirement: Main layout active-pane synchronization SHALL be idempotent

The MainLayout effect that mirrors the first tab pane’s active tab into local state SHALL only schedule a state update when the active tab ID differs from the current local value.

#### Scenario: Active pane ID is unchanged

- **WHEN** MainLayout re-renders without a change to the first pane’s active tab
- **THEN** the synchronization effect does not schedule another local state update

#### Scenario: Split layout is mounted

- **WHEN** MainLayout mounts with a persisted split-pane layout and completes its normal renders
- **THEN** the UI remains mounted without React error #185 or a maximum-update-depth loop
