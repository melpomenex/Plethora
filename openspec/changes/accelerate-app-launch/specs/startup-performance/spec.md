## ADDED Requirements

### Requirement: Production launches meet end-to-end latency budgets

The app SHALL meet the following p95 budgets on documented reference environments for normal process-cold release launches with an already-migrated local profile. Time starts when the launch is requested through the normal platform entry point. Both endpoints include all earlier launcher, framework, and application startup time.

| Platform | Interactive shell | Usable local screen |
| --- | ---: | ---: |
| Linux AppImage and native packages, macOS, Windows | 1,000 ms | 2,000 ms |
| Installed PWA with its normal installed asset cache | 1,000 ms | 2,000 ms |
| Android and iOS | 1,500 ms | 3,000 ms |

The interactive shell SHALL be visible in the foreground, have painted, and accept at least one primary navigation action while any pending local data is explicitly shown as loading. The usable local screen SHALL also show current content for the selected surface and active collection or a confirmed empty state, have painted that state, and respond to input. Splash screens, loaders without usable navigation, a process-start signal, and recovery screens SHALL NOT satisfy the usable-local-screen endpoint.

#### Scenario: Linux AppImage launches from its distributed package

- **WHEN** the reference host invokes the release AppImage through its normal launcher with Plethora stopped
- **THEN** the AppImage satisfies both desktop budgets with package activation included in the elapsed times
- **AND** an unpacked binary launch is reported separately if used for diagnosis

#### Scenario: Local launch with services unavailable

- **WHEN** a supported client opens a populated reference profile offline with optional integrations configured and unavailable
- **THEN** the first usable local screen meets the applicable budget with data for the active collection
- **AND** the same budgets apply with startup animation enabled and disabled where supported

#### Scenario: An existing runtime returns to the foreground

- **WHEN** a running instance is reopened or resumed without replacing its application runtime
- **THEN** it returns to its current usable state without replaying startup presentation or redoing startup hydration

### Requirement: Launch presentation yields to usable controls

The app SHALL reveal usable navigation as soon as the foreground shell can paint and accept input. Once the shell or the active local screen is ready, startup presentation MUST NOT cover the ready controls, intercept input, or require the user to wait for a fixed dwell, a remaining animation beat, or a fade before using them. The user's animation preference and reduced-motion behavior SHALL be respected.

#### Scenario: The shell is ready while startup presentation is playing

- **WHEN** a shell navigation control becomes usable during startup presentation
- **THEN** the control is visible and available for pointer or touch input and, where supported, keyboard input on its ready frame
- **AND** any remaining decoration leaves ready controls visible and input unobstructed

### Requirement: Safe local initialization and bounded recovery

Data-dependent actions SHALL remain gated on safe database or local storage readiness. The app SHALL distinguish loading, populated, confirmed empty, and recoverable failure. A terminal startup failure SHALL expose a visible recovery action promptly. An unresolved main application load or local readiness attempt SHALL expose retry or reload within 15 seconds of frontend bootstrap, using a path that can respond without the stalled operation. A retry SHALL supersede the prior frontend attempt while required native migrations continue safely.

#### Scenario: Initial data is delayed by a required migration

- **WHEN** a required migration is still running after the shell becomes interactive
- **THEN** navigation remains usable and data-dependent actions wait for actual readiness
- **AND** if the launch attempt reaches its deadline, recovery appears while the migration continues without exposing a partially initialized store

#### Scenario: A later attempt or collection change supersedes initial loading

- **WHEN** the user retries startup or switches collection while an earlier request is pending
- **THEN** the earlier result cannot replace the current surface state, change the selected collection, or conceal the current recovery state

### Requirement: Packaged launch performance is reproducible

The project SHALL provide a local release startup check that records every sample and reports median, nearest-rank p95, failures, build and environment identity, and the phase timings available on that platform. The check SHALL time at least 20 launches per reference configuration and fail on missing endpoints, failed launches, insufficient samples, or budgets exceeded. Launch traces SHALL be bounded and contain phases, durations, outcomes, and non-content counters without collecting personal data or command payloads. A stalled application command bridge MUST NOT suppress frontend timing or recovery evidence.

#### Scenario: The reference launch check completes

- **WHEN** the documented reference configurations are tested using release artifacts and an isolated populated fixture
- **THEN** the check reports comparable launch-to-shell and launch-to-local measurements for each platform
- **AND** a delayed launcher or an input-blocking overlay increases the measured duration even if startup data is ready

#### Scenario: A launch times out or produces a partial trace

- **WHEN** an endpoint is absent or a launch fails before the usable local screen
- **THEN** the check retains the failed sample and available phase evidence and fails the run

## MODIFIED Requirements

### Requirement: Deferred non-critical startup work

The system SHALL defer automatic non-critical startup work, including sync handshakes, RSS polling, analytics, update checks, and AI model preloading, until the first usable local screen. It SHALL schedule the work at a subsequent idle opportunity with a 3-second fallback counted from local readiness and use bounded work that yields to input. Required work for an explicit user action or a supported incoming intent MAY initialize on demand. Incoming intents SHALL be retained while their required state is loading.

#### Scenario: App starts with deferred background work

- **WHEN** the application launches with optional integrations enabled
- **THEN** the first local screen renders and accepts input before automatic optional work starts
- **AND** failure or unavailability of an optional integration leaves the local screen usable

#### Scenario: Deferred work completes within timeout

- **WHEN** no idle opportunity occurs within 3 seconds of local readiness
- **THEN** the fallback schedules eligible tasks in bounded units that yield to input

#### Scenario: Launch receives an external open or share intent

- **WHEN** a supported file, deep link, or share arrives before its required state is ready
- **THEN** the app retains it and processes it once the required state is available without waiting for unrelated optional integrations
