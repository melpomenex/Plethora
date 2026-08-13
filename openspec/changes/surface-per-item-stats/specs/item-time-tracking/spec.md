## Purpose

Records how much active time a user has invested in each individual learning item — documents, extracts, and flashcards — and keeps enough per-event history that the investment can be shown as a timeline rather than a single running total.

## ADDED Requirements

### Requirement: Active time is the unit of measurement

Time attributed to an item SHALL be *active* time: the portion of elapsed time during which the user was plausibly engaged with that item. The system SHALL stop accruing time to an item when the user is idle, when the item is no longer the foreground item, or when the application window loses focus, and SHALL resume accruing on the next sign of engagement.

Idle is determined by an inactivity threshold. Scrolling, pointer movement, key presses, playback progress of audio or video content, and rating actions all count as engagement.

#### Scenario: Idle time is not counted

- **WHEN** a user opens a document, reads for 4 minutes, leaves it open and untouched for 3 hours, then returns and rates it
- **THEN** the time recorded for that document SHALL be approximately 4 minutes plus any active time after returning, and SHALL NOT include the 3 idle hours

#### Scenario: Backgrounded application stops accruing

- **WHEN** a user has an item open and switches to another application for 20 minutes, then switches back
- **THEN** no time SHALL accrue to that item for the 20 minutes the window was not focused

#### Scenario: Only the foreground item accrues

- **WHEN** two documents are open in separate tabs and the user is reading one of them
- **THEN** time SHALL accrue only to the document the user is viewing, and SHALL NOT accrue to the background one

#### Scenario: Media playback counts as engagement

- **WHEN** a user is playing a video or audiobook item and does not touch the keyboard or pointer for longer than the inactivity threshold
- **THEN** time SHALL continue to accrue to that item while playback is progressing

### Requirement: Every reviewable item type accumulates time

Documents, extracts, and flashcards SHALL each maintain a persisted cumulative active-time total. Time measured during a review or reading interaction SHALL NOT be discarded for any of these item types.

#### Scenario: Extract review time is persisted

- **WHEN** a user spends 45 seconds on an extract in the Queue and rates it
- **THEN** the extract's cumulative time total SHALL increase by approximately 45 seconds and SHALL be readable afterwards

#### Scenario: Flashcard review time is attributable per card

- **WHEN** a user reviews a flashcard and rates it
- **THEN** the elapsed active time for that review SHALL be persisted against that card and SHALL be retrievable as part of the card's cumulative total

#### Scenario: Document time accrues from reading as well as rating

- **WHEN** a user opens a document in the Reader, reads actively for 10 minutes, and closes it without rating it
- **THEN** the document's cumulative time total SHALL increase by approximately 10 minutes

### Requirement: Per-item event history is recorded

Each accrual of time or completion of a review SHALL produce a durable history record for that item, carrying at minimum: the timestamp, the active duration, the surface the interaction happened on (queue or reader), and — where the interaction was a review — the rating given and the resulting scheduling interval. Documents SHALL additionally record the reading-progress delta for the interaction.

#### Scenario: Review produces a history record

- **WHEN** a user rates any reviewable item
- **THEN** a history record SHALL be written containing the timestamp, active duration, surface, rating, and resulting interval

#### Scenario: Reading without rating produces a history record

- **WHEN** a user reads a document in the Reader for an active period and then navigates away without rating it
- **THEN** a history record SHALL be written containing the timestamp, active duration, surface `reader`, progress delta, and no rating

#### Scenario: History survives restart

- **WHEN** a user records interactions with an item and then restarts the application
- **THEN** the previously written history records for that item SHALL still be readable

### Requirement: Interrupted sessions do not lose or inflate time

If the application exits, crashes, or is terminated while an item is open, the time accrued up to the last recorded engagement SHALL be preserved, and no time SHALL be attributed for the period between the last engagement and the next application start.

#### Scenario: Crash mid-session

- **WHEN** a user reads a document for 12 active minutes and the application is force-quit, and the user reopens the application an hour later
- **THEN** the document SHALL show approximately 12 minutes more time than before, not 12 minutes plus the hour

#### Scenario: Stale open session is closed on next start

- **WHEN** the application starts and finds a reading session that was never ended
- **THEN** that session SHALL be closed using the last recorded engagement time as its end, and SHALL NOT remain open accruing time

### Requirement: Existing totals are preserved

The introduction of per-item history SHALL NOT reset, recompute, or discard time totals that were already accumulated before this capability existed. Items with no history records SHALL still report their pre-existing cumulative total.

#### Scenario: Pre-existing document total is retained

- **WHEN** a document had accumulated time recorded before this change and has no history records
- **THEN** its cumulative time total SHALL still report that pre-existing value

#### Scenario: New history adds to the pre-existing total

- **WHEN** a document with a pre-existing cumulative total is read for 5 more active minutes
- **THEN** its cumulative total SHALL be the pre-existing value plus approximately 5 minutes
