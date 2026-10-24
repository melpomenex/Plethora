## Purpose

Keep saved-article scrolling responsive by bounding position persistence and Assistant context work while preserving accurate resume behavior and verifiable packaged-Linux performance.

## ADDED Requirements

### Requirement: Position persistence is atomic and independent of article size
The reader SHALL persist unified and legacy resume positions consistently in one atomic operation per saved sample. A position-only operation SHALL NOT read, serialize, return, or journal document content or article metadata. For representative valid locators, its sync payload SHALL be at most 4 KiB and its response at most 1 KiB, independent of source content size.

#### Scenario: Large article position save
- **WHEN** the reader saves the same bounded locator for small and multi-megabyte article fixtures
- **THEN** both operations meet the payload and response budgets without transporting source content or metadata
- **AND** unified and legacy resume fields describe the same saved location

#### Scenario: Transaction failure
- **WHEN** the position update or its required sync journal write fails
- **THEN** neither half is partially committed and the reader remains usable

### Requirement: Continuous scrolling has bounded ordered saves
The reader SHALL retain the latest locator with at most one save in flight and one replaceable pending sample per document. Continuous scrolling SHALL start no more than one periodic save every two seconds. The newest changed position SHALL be flushed after a 250 ms quiet period, and an older completion SHALL NOT overwrite a newer saved position. Restoring or revisiting an unchanged position SHALL NOT generate redundant writes.

#### Scenario: Continuous input outruns persistence
- **WHEN** scroll input continues while a position save is slow
- **THEN** pending samples are coalesced without growing a request queue
- **AND** the eventual final save contains the newest sampled locator

#### Scenario: Initial restoration
- **WHEN** the reader programmatically restores its saved location without user navigation
- **THEN** restoration does not journal a new position solely because it generated scroll events

### Requirement: Lifecycle transitions retain the outgoing position
Document changes, queue advance, tab deactivation, visibility loss, and supported close/suspend transitions SHALL flush the latest outgoing locator without writing it to the next document. Repeated lifecycle callbacks SHALL be idempotent. Abrupt termination SHALL have a local resume checkpoint; failed remote or local saves SHALL NOT falsely mark pending samples durable or block scrolling.

#### Scenario: Queue advances during a slow save
- **WHEN** the user advances from article A to B with a save for A in flight
- **THEN** A's newest locator is retained and B never receives A's position

#### Scenario: Duplicate cleanup and persistence failure
- **WHEN** visibility loss and tab cleanup request the same flush and persistence fails
- **THEN** the sample remains recoverable without duplicate successful records or an unbounded retry loop

### Requirement: Scrolling does not eagerly prepare Assistant prompts
Scrolling alone SHALL NOT repeatedly tokenize the full source or resolve duplicate Assistant context windows. A prompt or explicit context-preview request SHALL resolve fresh context from the active source, current selection and locator, and effective provider budget. Hidden Assistant surfaces SHALL NOT prepare context solely because the reading position changed.

#### Scenario: Assistant is closed while reading
- **WHEN** the user scrolls an article for 60 seconds with the Assistant hidden
- **THEN** no full-source tokenization is triggered solely by those scroll events

#### Scenario: Question immediately follows navigation
- **WHEN** the user scrolls, selects a passage, and immediately sends a contextual question
- **THEN** context uses that source and selection with current locator and budget rules
- **AND** an older asynchronous result cannot replace context for a different active document

### Requirement: Packaged Linux scrolling is validated with frame measurements
The change SHALL provide repeatable before/after measurements using the same installed-runtime stack and a separately built Linux AppImage. In three controlled warm 60-second runs for each documented theme/Assistant condition, p95 frame intervals SHALL remain within two display refresh periods and position bookkeeping or context preparation SHALL produce no main-thread task exceeding 50 ms. Evidence SHALL include artifact identity, workload/environment, save counts and latency, journal bytes, memory, and unresolved failures.

#### Scenario: Baseline and candidate comparison
- **WHEN** the baseline and candidate run the controlled saved-article workload
- **THEN** the verification record reports measured frame and persistence results for both
- **AND** a passing computation benchmark alone is not reported as proof of smooth scrolling

#### Scenario: Frame budget remains unmet
- **WHEN** the candidate passes behavioral tests but fails the packaged frame budget
- **THEN** the failure remains explicit and the user-visible scrolling fix is not marked verified
