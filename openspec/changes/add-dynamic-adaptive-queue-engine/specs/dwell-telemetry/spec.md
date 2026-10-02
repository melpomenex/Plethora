## Purpose

Defines how the system distinguishes genuine engagement from absence while an
item is open: an idle/away state machine with a user-configurable timeout, and a
per-item dwell record that separates verified active time from discarded idle
time and carries the interaction evidence the friction penalty and the adaptive
learning loop consume.

## ADDED Requirements

### Requirement: Dwell accrues only while the user is plausibly engaged

Time attributed to an item SHALL be *active* time. Accrual SHALL stop when the
user is idle, when the item is no longer the foreground item, or when the
application window loses focus or the document becomes hidden, and SHALL resume
on the next sign of engagement. Scrolling, pointer movement, key presses,
text selection, playback progress, and rating actions SHALL each count as
engagement.

#### Scenario: Window loses focus

- **GIVEN** an item is open and active time is accruing
- **WHEN** the application window loses focus
- **THEN** accrual SHALL pause
- **AND** no time SHALL be attributed for the unfocused period

#### Scenario: Engagement resumes

- **GIVEN** accrual paused because the user became idle
- **WHEN** any qualifying engagement signal occurs
- **THEN** accrual SHALL resume
- **AND** the resumed dwell SHALL be recorded as active time only

#### Scenario: Background item does not accrue

- **GIVEN** item A is the foreground item and item B is open behind it
- **WHEN** active time is recorded for the session
- **THEN** it SHALL be attributed to item A only

### Requirement: Idle and away state is detected by a configurable timeout

The system SHALL evaluate engagement on a 1 000 ms heartbeat. When no
engagement signal has occurred for the configured idle timeout, engagement state
SHALL transition from `active` to `idle`, accrual SHALL stop, and the idle
block SHALL be recorded as discarded rather than active. The idle timeout SHALL
be user-configurable from 15 000 ms to 120 000 ms and SHALL default to 45 000 ms.
A transition back to active SHALL be triggered only by a confirmed interaction,
not by the passage of time.

#### Scenario: Idle after the configured timeout

- **GIVEN** `afkIdleTimeoutMs` is 45 000 and no engagement signal occurs
- **WHEN** 45 000 ms elapse
- **THEN** engagement state SHALL become `idle`
- **AND** the elapsed period SHALL be recorded as idle time, not active dwell

#### Scenario: Timeout bounds are enforced

- **WHEN** the user sets `afkIdleTimeoutMs` below 15 000 or above 120 000
- **THEN** the value SHALL be rejected and the setting SHALL retain its previous valid value

#### Scenario: Time alone never re-engages

- **GIVEN** engagement state is `idle`
- **WHEN** no interaction occurs
- **THEN** engagement state SHALL remain `idle`
- **AND** no active dwell SHALL accrue

#### Scenario: Return from away is acknowledged

- **GIVEN** dwell tracking paused because the user was away for longer than the idle timeout
- **WHEN** the user returns and is detected as active again
- **THEN** the system SHALL offer a subtle, dismissible notice that dwell tracking was paused
- **AND** the notice SHALL NOT block the current item

### Requirement: Idle time is discarded, never counted as dwell

The idle block preceding a transition to `idle` SHALL be retroactively clamped
out of the active dwell total, so an idle period SHALL never inflate an item's
recorded reading time. Recorded `idleTimeMs` and `activeDwellMs` SHALL sum to
the elapsed wall-clock time of the observed session. If the application exits or
is terminated while an item is open, time accrued up to the last recorded
engagement SHALL be preserved and no time SHALL be attributed for the gap.

#### Scenario: Idle block is excluded from dwell

- **GIVEN** an item was open for 300 000 ms and the user was idle for the final 120 000 ms
- **WHEN** the dwell record is written
- **THEN** `activeDwellMs` SHALL be at most 180 000 ms and SHALL exclude the idle block
- **AND** `idleTimeMs` SHALL account for the discarded period

#### Scenario: Unclean termination preserves observed time

- **GIVEN** an item was open and the application was terminated without an explicit exit
- **WHEN** the session is next opened
- **THEN** the previously accrued active time SHALL be preserved
- **AND** the period between the last engagement and the next application start SHALL NOT be attributed

### Requirement: Dwell records carry interaction evidence

For each observed session the system SHALL record, against the target item: the
item identifier, `activeDwellMs`, `idleTimeMs`, `scrollDepthRatio` in `[0,1]`,
`interactionDensity` as the count of highlights or extracts per minute, and the
`exitAction` that ended the session. `scrollDepthRatio` SHALL be derived from
document traversal. An `exitAction` SHALL be one of `extract-created`,
`next-item`, `postpone`, `dismiss`, `re-prioritize`, or `session-end`.

#### Scenario: Traversal ratio is recorded

- **GIVEN** a user reads a document from the start to 70% of its length
- **WHEN** the dwell record is written
- **THEN** `scrollDepthRatio` SHALL be approximately `0.7`

#### Scenario: Extraction raises interaction density

- **GIVEN** a user creates two extracts during a session
- **WHEN** the dwell record is written
- **THEN** `interactionDensity` SHALL reflect two interactions over the session's `activeDwellMs`

#### Scenario: Exit action is one of the defined values

- **WHEN** a dwell session ends
- **THEN** `exitAction` SHALL be exactly one of the defined exit actions
- **AND** an unrecognised action SHALL NOT be stored

#### Scenario: Untracked is expressed as untracked

- **WHEN** a metric such as `scrollDepthRatio` cannot be determined for an item type
- **THEN** it SHALL be stored as explicitly untracked rather than as `0` or an imputed value

### Requirement: Dwell records are available to ranking and learning surfaces

Recorded dwell SHALL be readable by the friction penalty and by the adaptive
learning loop, and SHALL be surfaced on per-item statistics. Dwell aggregation
SHALL NOT be the source of truth for scheduling: scheduling continues to use
the existing scheduler's own metrics.

#### Scenario: Friction reads recorded dwell

- **WHEN** the friction penalty is computed for an item
- **THEN** it SHALL use recorded `activeDwellMs`, `idleTimeMs`, postponements, and abandonment history
- **AND** it SHALL not infer resistance from item type alone

#### Scenario: Item statistics show dwell

- **WHEN** a user opens per-item statistics for an item with recorded dwell
- **THEN** total active dwell, discarded idle time, and interaction density SHALL be shown separately

#### Scenario: Aggregation does not reschedule

- **WHEN** dwell records are aggregated for analytics
- **THEN** no interval, stability, or due date SHALL be modified as a result