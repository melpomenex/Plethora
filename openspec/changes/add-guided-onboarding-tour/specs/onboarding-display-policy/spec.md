## ADDED Requirements

### Requirement: Bounded automatic display

The tour SHALL auto-open at startup on at most 3 launches following installation. A launch counter SHALL increment once per app start, and once the counter exceeds the limit auto-display SHALL be permanently disabled.

#### Scenario: First launch after install

- **WHEN** the app starts with no stored onboarding state
- **THEN** the launch counter is set to 1 and the tour auto-opens once the shell is ready

#### Scenario: Second and third launches without engagement

- **WHEN** the user dismisses the tour via `Esc` or the overlay on launch 1, then starts the app again
- **THEN** the launch counter increments and the tour auto-opens again, up to and including launch 3

#### Scenario: Fourth launch

- **WHEN** the app starts and the launch counter has already reached 3
- **THEN** the tour does not auto-open, and it never auto-opens again on any subsequent launch

#### Scenario: One auto-open per session

- **WHEN** the tour has already auto-opened during the current app session
- **THEN** it does not auto-open again in that session regardless of navigation, reload of a view, or window focus changes

### Requirement: Terminal states disable auto-display permanently

Completing the tour, using the explicit skip control, or opting out SHALL permanently disable auto-display, regardless of the remaining launch budget.

#### Scenario: Completion

- **WHEN** the user reaches the final step and clicks "Done" on launch 1
- **THEN** auto-display is permanently disabled and the tour does not auto-open on launch 2

#### Scenario: Explicit skip

- **WHEN** the user clicks "Skip tour" on launch 1
- **THEN** auto-display is permanently disabled and the tour does not auto-open on launch 2

#### Scenario: Soft dismissal keeps the remaining budget

- **WHEN** the user closes the tour with `Esc` or an overlay click rather than the skip control
- **THEN** auto-display is not permanently disabled and the tour may auto-open on the remaining launches within the budget

#### Scenario: Don't show again

- **WHEN** the user activates a "Don't show this again" control on the tour
- **THEN** auto-display is permanently disabled immediately

### Requirement: Auto-display only at a safe startup moment

The tour SHALL auto-open only after the application shell has rendered and no other blocking surface is present, and SHALL NOT interrupt work already in progress.

#### Scenario: Waits for the shell

- **WHEN** the app is still initialising the main layout
- **THEN** the tour does not open until the shell has rendered and its tour anchors are mounted

#### Scenario: Yields to startup notices

- **WHEN** a startup notice, restore prompt, or migration dialog is displayed at launch
- **THEN** the tour does not auto-open during that session, and the launch budget is not consumed by that session

#### Scenario: Does not interrupt deep links

- **WHEN** the app is launched directly into a document, a review session, or the screenshot-overlay route
- **THEN** the tour does not auto-open for that session, and the launch budget is not consumed

#### Scenario: No mid-session auto-open

- **WHEN** the app has been running and the user navigates between views
- **THEN** the tour never opens on its own outside of the startup moment

### Requirement: Always available on demand

The tour SHALL remain launchable by the user at any time after auto-display has stopped.

#### Scenario: Settings entry point

- **WHEN** the user activates "Replay guided tour" in Settings
- **THEN** the tour opens from step 1 with progress reset, regardless of completion, skip, or launch-budget state

#### Scenario: Command palette entry point

- **WHEN** the user searches the command palette for the guided tour command and runs it
- **THEN** the tour opens

#### Scenario: On-demand opening does not change auto-display state

- **WHEN** the user opens the tour on demand and completes or closes it
- **THEN** the launch counter is unchanged and auto-display remains permanently disabled

### Requirement: Persistent, synced, and self-healing state

Onboarding state SHALL persist across restarts, travel with the user's synced settings, and tolerate corruption.

#### Scenario: State survives restart

- **WHEN** the user completes the tour and restarts the app
- **THEN** the completed state is still recorded and the tour does not auto-open

#### Scenario: State is registered for sync

- **WHEN** settings synchronisation runs
- **THEN** the onboarding state key is included in the synchronised key set so a second device does not re-show the tour to an existing user

#### Scenario: Corrupt or unparseable state

- **WHEN** the stored onboarding state is missing required fields or fails to parse
- **THEN** it is treated as a fresh install with a zeroed launch counter, and no error is surfaced to the user

#### Scenario: Unknown future state version

- **WHEN** the stored state carries a version newer than the running app understands
- **THEN** auto-display is suppressed rather than reset, so a downgraded client does not re-onboard an existing user

### Requirement: Older state versions migrate forward without resetting the budget

When the stored state is well-formed but carries a version older than the schema version the running app understands, the app SHALL migrate the record to the current schema rather than treating it as corrupt. The launch counter, `autoDisplayDisabled` flag, resume position, and completion timestamp SHALL be carried forward as-is; only fields introduced by the newer schema are populated with defaults. This applies on any app update that changes the record's shape, not only the current schema version.

#### Scenario: Older version record after a schema change

- **WHEN** the stored state carries a version older than the running app's current schema version, and every field defined at that older version is present and well-typed
- **THEN** the record is migrated to the current version, preserving `launchCount`, `autoDisplayDisabled`, `furthestStepId`, and `completedAt`, rather than being reset to a fresh install

#### Scenario: Exhausted budget or terminal state survives a schema migration

- **WHEN** a user has exhausted the launch budget, or has completed or skipped the tour, under an older schema version
- **THEN** after the app migrates the record on update, auto-display remains permanently disabled or budget-exhausted exactly as it was before the update — the update never grants additional auto-opens

#### Scenario: Genuinely malformed old-version data still resets

- **WHEN** a stored state's version is older than current AND a field required at that older version is missing or wrong-typed
- **THEN** it is treated as corrupt per "Corrupt or unparseable state" and reset to a fresh install, distinguishing this from a well-formed record that is merely on an older schema

### Requirement: Resettable for testing and support

The onboarding state SHALL be resettable so that the first-run experience can be reproduced.

#### Scenario: Reset control

- **WHEN** the user activates "Reset onboarding" in Settings
- **THEN** the launch counter, completion flag, skip flag, and resume position are cleared, and the tour auto-opens on the next launch as if freshly installed
