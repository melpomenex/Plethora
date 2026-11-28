# Learning Activity Runtime Specification

## ADDED Requirements

### Requirement: Canonical Typed LearningActivity Contract
The system SHALL represent every executable learning unit using a canonical `LearningActivity` contract with typed `kind`, stable `dedupeKey`, target entity reference, positive bounded `estimatedMinutes`, isolation flags (`requiresExamIsolation`, `requiresOnline`, `requiresAi`), and inherited `privacy` metadata (`isLocalOnly`, `isAiExcluded`, `privacyVersion`).

#### Scenario: Creating an activity from a local-only, AI-excluded document
- **GIVEN** a document marked `is_local_only = true` and `is_ai_excluded = true`
- **WHEN** the runtime constructs an `incremental_read` or `study_workspace` `LearningActivity` for that document
- **THEN** the activity SHALL inherit `privacy.isLocalOnly = true` and `privacy.isAiExcluded = true`
- **AND** `requiresOnline` and `requiresAi` SHALL both be `false`.

#### Scenario: Rejecting invalid activity descriptors
- **GIVEN** a candidate payload with an unknown `kind` or non-positive `estimatedMinutes`
- **WHEN** the runtime validates the `LearningActivity` before persisting a session
- **THEN** the runtime SHALL reject or clamp invalid fields deterministically according to the contract schema without corrupting persisted state.

### Requirement: Persisted Resumable Heterogeneous LearningSession
The system SHALL persist heterogeneous `LearningSession` records and their ordered `LearningSessionItem` rows in SQLite via migration `171_learning_activity_runtime`, supporting pause, restart recovery, and exact checkpoint restoration across mixed activity kinds.

#### Scenario: Pausing and resuming a heterogeneous session across app restarts
- **GIVEN** an active `LearningSession` containing an `incremental_read` item, an `srs_review` item, and a `guided_reading` item
- **WHEN** the learner completes the first item, pauses halfway through the second item, closes Plethora, and reopens it
- **THEN** the runtime SHALL restore the `LearningSession` in `paused` state with the first item `completed`, the second item `paused` with its saved `resumeCheckpointJson`, and `elapsedActiveSeconds` preserved
- **AND** resuming the session SHALL launch the second item's adapter at its saved checkpoint.

#### Scenario: Handling an unavailable activity target on resume
- **GIVEN** a persisted `LearningSession` whose next queued item references a document that has since been deleted
- **WHEN** the learner resumes the session
- **THEN** the runtime SHALL mark that item `skipped_unavailable`, persist the transition, and automatically advance to the next valid queued item without crashing.

### Requirement: Single-Surface Adapter Reuse Without Duplicating Schedulers
The runtime SHALL execute activities by delegating to adapters over existing canonical surfaces (`DocumentViewerWrapper.tsx` via `study-canonical-reader-host`, FSRS-7 review host, Guided Reading Trails, and resumable Examinations) without duplicating `BaseDocumentViewer` or bypassing FSRS-7 scheduling.

#### Scenario: Transitioning between reader-backed activities reuses the canonical reader host
- **GIVEN** an active `LearningSession` where item 0 is `incremental_read` and item 1 is `guided_reading`
- **WHEN** item 0 completes and the session advances to item 1
- **THEN** the runtime SHALL mount item 1 inside the existing `study-canonical-reader-host` without creating a second concurrent `BaseDocumentViewer` instance.

#### Scenario: Completing an SRS review activity preserves FSRS-7 as sole scheduler
- **GIVEN** an active `srs_review` item inside a `LearningSession`
- **WHEN** the learner submits a review rating
- **THEN** the adapter SHALL delegate scheduling exclusively to the canonical FSRS-7 review pipeline and record the resulting `learning_events` ID on `learning_session_items.completion_event_id`.

### Requirement: Cross-Surface Duplicate-Work Prevention
The runtime SHALL prevent duplicate work across heterogeneous sessions, standalone Review, and Scroll Mode using deterministic `dedupeKey` values and live reconciliation against canonical `learning_events`.

#### Scenario: Item completed in standalone Review while session is paused
- **GIVEN** a paused `LearningSession` containing a queued `srs_review` item for card `C1` with `dedupeKey = "srs_review:learning_item:C1:cycle-4"`
- **WHEN** the learner reviews card `C1` in standalone `ReviewTab` or `QueueScrollPage`, emitting a canonical `learning_events` completion for that same `dedupeKey`
- **THEN** the runtime SHALL reconcile the paused session by marking that item `completed` with `activeSeconds = 0` and linking `completionEventId`
- **AND** when the learner resumes the session, card `C1` SHALL NOT be presented again.

#### Scenario: Idempotent completion submission inside a session
- **GIVEN** an active `LearningSessionItem`
- **WHEN** completion is triggered twice with the same `(sessionId, itemId, dedupeKey)`
- **THEN** the runtime SHALL process the completion exactly once and SHALL NOT emit duplicate `learning_events` or double-count `elapsedActiveSeconds`.

### Requirement: Strict Exam-Mode Isolation
When an `exam_attempt` activity (or any activity with `requiresExamIsolation = true`) is active in a `LearningSession`, the runtime SHALL enforce an isolated exam boundary that suppresses study assistants, hints, answer keys, and casual navigation until the exam is submitted or paused.

#### Scenario: Entering exam-mode isolation during a mixed session
- **GIVEN** an active `LearningSession` advancing into an `exam_attempt` activity
- **WHEN** the exam adapter mounts
- **THEN** the session shell SHALL disable and hide `AssistantPanel`, Socratic tutor triggers, hint drawers, and "switch to Study Mode" actions
- **AND** the exam payload SHALL contain zero answer keys or grading rubrics.

#### Scenario: Safely pausing an isolated exam activity
- **GIVEN** an in-progress `exam_attempt` inside an isolated `LearningSession`
- **WHEN** the learner selects Pause Exam
- **THEN** the runtime SHALL persist the exam attempt checkpoint and session checkpoint, exit `exam_isolated` mode cleanly, and allow resuming the exam later without leaking answers or forfeiting progress.

### Requirement: Offline, Zero-AI, and Privacy-Preserving Execution
The activity runtime SHALL operate completely offline without any AI provider configured, SHALL enforce `is_local_only` and `is_ai_excluded` privacy propagation, and SHALL maintain strict isolation from `health/health.db`.

#### Scenario: Executing a full heterogeneous session offline with no AI provider
- **GIVEN** no network connectivity and no AI provider configured
- **WHEN** a learner starts, pauses, resumes, and completes a session containing `incremental_read`, `srs_review`, and `guided_reading` activities
- **THEN** every lifecycle operation SHALL succeed locally without network calls or AI errors.

#### Scenario: Local-only session excluded from cloud sync
- **GIVEN** a `LearningSession` containing at least one activity whose source document has `is_local_only = true`
- **WHEN** the session is persisted or updated
- **THEN** `learning_sessions.is_local_only` SHALL be set to `1`
- **AND** neither the session nor its items SHALL be enqueued into `sync/journal.rs` for remote sync.
