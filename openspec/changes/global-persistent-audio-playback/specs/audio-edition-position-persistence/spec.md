## MODIFIED Requirements

### Requirement: Exact Audio Edition playback location persistence
The system SHALL track and persist the current Audio Edition section index (`partIndex`), time within that section (`timeInPart`), cumulative playback timestamp (`globalTimeSec`), total duration when known, and modification timestamp. Listening position SHALL remain independent from visual EPUB CFI/page/scroll position and visual reading progress. One playback owner SHALL schedule changed-position saves at least every five seconds and flush on pause, seek completion, part/source change and orderly shutdown; view unmount SHALL NOT own or stop playback or its persistence schedule.

#### Scenario: User pauses playback in multi-part edition
- **WHEN** the user reaches halfway through section index 1 and pauses or stops playback
- **THEN** the system saves section index 1, its elapsed time, cumulative global seconds and update timestamp

#### Scenario: Periodic auto-save during continuous playback
- **WHEN** an Audio Edition plays continuously while its source view is unmounted
- **THEN** position is persisted at least every five seconds by the playback owner
- **AND** a view teardown requests a coalesced flush while playback continues
- **AND** an orderly owner shutdown flushes the latest position

#### Scenario: Position persistence on section jump
- **WHEN** the user seeks to another chapter or section
- **THEN** the persisted checkpoint records the new section index and its section-local seek offset

#### Scenario: Reading and listening to the same text source
- **WHEN** an Audio Edition plays while the user reads and annotates its underlying EPUB or PDF
- **THEN** listening saves do not change visual position or reading progress
- **AND** reading saves do not overwrite audio part/time position

### Requirement: Seamless multi-part Audio Edition resume
Creating a new listening session for an Audio Edition SHALL restore its saved part and section-local position after its playlist is initialized. Attaching an additional UI to an already active edition SHALL use the current session without source reload or re-seek. Cold restart SHALL restore paused; explicit Listen or Listen from Beginning SHALL determine playback intent.

#### Scenario: Resuming playback from library or player
- **WHEN** the user selects Listen to Audio Edition with a saved position halfway through section index 1
- **THEN** the session loads section index 1 and seeks to its saved local offset rather than starting section 0

#### Scenario: Explicit restart from beginning
- **WHEN** the user explicitly selects Listen from Beginning
- **THEN** the session sets section index 0 and time 0.0 seconds and begins playback from the edition start

#### Scenario: Reopen a live edition view
- **WHEN** an edition advances to section 3 while its source view is closed and the user reopens that view
- **THEN** the view reflects current section 3 position without restoring an older checkpoint

## ADDED Requirements

### Requirement: Local session recovery without new synchronization semantics
The application SHALL recover the current media identity, queue/order, speed and valid source position from versioned local checkpoints while preserving existing legacy progress/bookmark data. Cold recovery SHALL require explicit Play; a live native service SHALL remain authoritative on reconnection. The change SHALL preserve existing document-position synchronization without synchronizing session intent or claiming new cross-device sync for locally stored edition positions.

#### Scenario: Restart and live service reconnection
- **WHEN** the application reopens after full termination
- **THEN** valid identity, queue, speed and position restore paused
- **AND** when instead reconnecting to an already-running Android service, its current source and playing state are reflected without restarting it

#### Scenario: Remote progress merge during playback
- **WHEN** a remote document progress update arrives during a loaded local session
- **THEN** the live engine is not re-seeked or restarted
- **AND** normal existing synchronized progress is considered when a subsequent new session is explicitly loaded

#### Scenario: Invalid or stale local data
- **WHEN** saved state references a removed source, invalid part, nonfinite position or incompatible media revision
- **THEN** it is validated and pruned or restored using a safe compatible source position with an explanation
- **AND** valid visual reading positions and legacy bookmarks are retained
