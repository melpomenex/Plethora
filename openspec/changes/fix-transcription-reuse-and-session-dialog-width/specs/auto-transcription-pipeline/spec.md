## ADDED Requirements

### Requirement: Completed queue transcripts are reusable across linked media views

The system SHALL display a completed queue transcript when the same media item is opened through its document or linked podcast episode. Saved text, segment ordering, timestamps, and available word timings SHALL be preserved. Opening or reopening the transcript SHALL NOT invoke a transcription provider or enqueue another job when a usable saved transcript exists, regardless of the currently selected provider or installed models.

#### Scenario: Queued podcast opened from its document
- **WHEN** a podcast document finishes transcription in the Transcription Queue
- **AND** the user opens that document's transcript
- **THEN** the saved transcript appears without starting transcription again
- **AND** its saved segment timings remain available for seeking and highlighting

#### Scenario: Same episode opened from Podcasts
- **WHEN** a linked podcast document has a completed queue transcript
- **AND** the user opens the same episode from Podcasts
- **THEN** the episode displays that saved transcript without another provider invocation

#### Scenario: Results from an earlier app version
- **WHEN** the episode's transcript store is empty but a linked document has a completed transcript produced before this fix
- **THEN** the existing transcript is available without retranscribing the audio

#### Scenario: Restart and queue cleanup
- **WHEN** the app restarts or the user clears finished transcription queue entries
- **AND** the user opens an item whose transcript was already saved
- **THEN** the transcript remains available without relying on an in-memory cache or a retained queue entry

#### Scenario: Ordinary audiobook or local media document
- **WHEN** a non-podcast media document with a completed queue transcript is opened
- **THEN** its saved transcript is displayed using the correct document and chapter identity
- **AND** opening the transcript creates no new transcription job

### Requirement: Transcript resolution precedes automatic transcription

Before automatically starting transcription, the system SHALL finish resolving the current item's saved transcript and existing job state. Loading and lookup failure SHALL be distinguishable from confirmed absence. An existing pending or processing job SHALL be observed rather than duplicated, and automatic starts SHALL be serialized for the same media identity while a request is in flight.

#### Scenario: Slow persisted lookup
- **WHEN** a saved transcript or existing job lookup is still loading
- **THEN** the viewer shows a loading state and does not start another transcription

#### Scenario: Transcript lookup fails
- **WHEN** a saved transcript lookup fails
- **THEN** the viewer presents a recoverable loading error
- **AND** the failure does not trigger automatic transcription

#### Scenario: Queue already processing while viewer opens
- **WHEN** an item is pending or processing in the queue and its transcript panel is opened
- **THEN** the viewer reflects the existing job's state
- **AND** completion makes the saved transcript visible without starting another job

#### Scenario: Navigation during lookup
- **WHEN** the user switches items before a lookup or job-start request finishes
- **THEN** the previous item's response cannot replace the current item's transcript or start work for the wrong item

#### Scenario: Confirmed missing transcript
- **WHEN** all applicable saved sources have been checked successfully and no transcript or active job exists
- **AND** the existing automatic-transcription policy allows a start
- **THEN** the system starts transcription once using the configured provider
- **AND** rerenders or repeated panel opens during that start do not create duplicate work

#### Scenario: Completed status without usable saved data
- **WHEN** an item is marked completed but no usable saved transcript can be loaded
- **THEN** the viewer presents the inconsistency as a recoverable error
- **AND** merely opening the panel does not silently retranscribe the audio

### Requirement: Queue completion exposes durable readable results

A queue job SHALL be reported completed only after its transcript result has been durably saved and can be resolved for the same item. Existing complete podcast transcripts SHALL remain usable when linked document data is also present, and partial data SHALL NOT replace a complete result.

#### Scenario: Completion published after persistence
- **WHEN** the queue reports successful completion
- **THEN** a fresh transcript lookup can read the saved result without running speech recognition

#### Scenario: Persistence failure
- **WHEN** persisting the transcript fails
- **THEN** the job is not reported as successfully completed

#### Scenario: Existing episode transcript
- **WHEN** the episode already has a complete saved transcript and a linked document has partial transcription data
- **THEN** opening the episode preserves the complete transcript and its available timings
