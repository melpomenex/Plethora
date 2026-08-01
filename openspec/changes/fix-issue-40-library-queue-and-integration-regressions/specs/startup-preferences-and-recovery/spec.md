## ADDED Requirements

### Requirement: The default startup view preference is honored

The Default View preference in Settings SHALL be persisted when changed and SHALL determine which view the application opens on startup. The control SHALL display the currently persisted value when Settings is opened, not a hardcoded default.

#### Scenario: The preference is applied on the next launch

- **WHEN** the user sets Default View to Documents and restarts the application
- **THEN** the application opens the Documents view

#### Scenario: The control reflects the persisted value

- **WHEN** the user has set Default View to Documents and reopens Settings
- **THEN** the control shows Documents

#### Scenario: The preference survives a restart

- **WHEN** the user sets Default View to Documents and restarts twice
- **THEN** the application opens the Documents view both times

### Requirement: Settings controls are bound or visibly unavailable

Every interactive control rendered in Settings SHALL either persist and apply its value, or be rendered in a disabled state that indicates it is not yet available. A control SHALL NOT appear functional while discarding the user's input.

#### Scenario: No Settings control silently discards input

- **WHEN** the Settings controls are audited
- **THEN** every enabled control persists and applies its value
- **AND** any control that is not yet implemented is rendered disabled with an explanation

### Requirement: Degraded startup is observable and recoverable without a restart

When a startup subsystem fails or times out and the application continues in a degraded state, that state SHALL be recorded in observable application state and surfaced to the user in a non-blocking way, with an action to retry initialization. Reporting the degradation only to the developer console SHALL NOT satisfy this requirement.

Retrying SHALL re-run the failed initialization and, on success, clear the degraded state without requiring an application restart.

#### Scenario: A degraded boot is visible to the user

- **WHEN** a startup subsystem times out and the application continues in degraded mode
- **THEN** the degraded state is exposed in application state
- **AND** a non-blocking indicator informs the user

#### Scenario: The user can recover without restarting

- **WHEN** the application is in a degraded startup state and the user chooses to retry
- **THEN** initialization is attempted again
- **AND** the degraded state clears if the retry succeeds

#### Scenario: A healthy boot shows no indicator

- **WHEN** startup completes with no subsystem failure
- **THEN** no degradation indicator is shown

### Requirement: A degraded startup snapshot is not cached as authoritative

Data loaded during a degraded startup SHALL NOT be served for the remainder of the session as though it were complete. When the application recovers from a degraded startup, the affected data SHALL be refetched so that views depending on it — including the Reading Queue and document listings — reflect complete data without an application restart.

#### Scenario: Recovery refreshes data captured while degraded

- **WHEN** a startup snapshot is captured during a degraded boot and initialization later succeeds
- **THEN** the snapshot is refetched
- **AND** views depending on it show the complete data

#### Scenario: Incomplete data is not presented as complete

- **WHEN** a startup snapshot is captured during a degraded boot
- **THEN** the application does not report that data as fully loaded

### Requirement: Startup phases are measurable

The application SHALL record timing for its startup phases through the existing sync telemetry, including whether each phase completed normally, timed out, or failed. These measurements SHALL be retrievable for diagnosis so that reports of slow or wedged startup can be attributed to a phase rather than inferred.

#### Scenario: Phase timings and outcomes are recorded

- **WHEN** the application starts
- **THEN** each startup phase records its duration and outcome

#### Scenario: A timed-out phase is identifiable

- **WHEN** a startup phase times out
- **THEN** the recorded telemetry identifies which phase timed out
