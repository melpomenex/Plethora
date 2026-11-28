# Learning State and Events Specification

## ADDED Requirements

### Requirement: Canonical Versioned Learning Event Log
The system SHALL persist all canonical learning state transitions in an append-only SQLite `learning_events` table created by migration `168_unify_learning_state_events` with monotonic `seq`, `schema_version`, deterministic `idempotency_key`, `event_type`, `surface`, `entity_kind`, `entity_id`, `payload_json`, and ISO-8601 UTC `occurred_at` timestamps.

#### Scenario: Transactional review commit emits a canonical learning event
- **GIVEN** an active flashcard managed by the FSRS-7 scheduler
- **WHEN** the learner submits a review rating from any surface (Review, Scroll Mode, Quick Review, or Unified Session)
- **THEN** the FSRS-7 schedule update in `learning_items` and `review_results` AND the `review_committed` row in `learning_events` MUST commit atomically in the same SQLite transaction
- **AND** FSRS-7 MUST remain the sole source of the card's stability, difficulty, retrievability, and `due_date`

#### Scenario: Duplicate event emission is deduplicated idempotently
- **GIVEN** a `learning_events` row already exists with `idempotency_key = "review_commit:rr-123"`
- **WHEN** a retry, double-click, or sync replay attempts to append an event with the same `idempotency_key`
- **THEN** the repository MUST NOT insert a second row
- **AND** it MUST return the existing event with `inserted = false` so downstream consumers never double-count the action

#### Scenario: Review undo appends a compensating retraction event
- **GIVEN** a committed `review_committed` event with `id = "evt-1"`
- **WHEN** the learner undoes that review
- **THEN** the system MUST append a `review_undone` event with `id = "evt-2"` inside the undo transaction
- **AND** MUST set `retracted_by_event_id = "evt-2"` on `"evt-1"` without deleting `"evt-1"`

### Requirement: Durable Consumer Checkpoints and Deterministic Replay
The system SHALL maintain a `learning_event_checkpoints` table recording `(consumer_id, last_seq, policy_version, updated_at)` so downstream projections (Learner Model, Goals, DAQE, Motivation) consume `learning_events` incrementally and recover deterministically after crash or policy upgrade.

#### Scenario: Consumer resumes from last committed sequence
- **GIVEN** consumer `learner_model_v1` has checkpoint `last_seq = 42`
- **WHEN** new events with `seq` 43 through 45 are committed and the consumer runs
- **THEN** the consumer MUST fetch only events with `seq > 42` in ascending `seq` order
- **AND** MUST advance its checkpoint to `last_seq = 45` inside the same transaction as its projection updates

#### Scenario: Resetting a consumer checkpoint replays cleanly
- **GIVEN** a consumer's derived projection needs recomputation after a policy change
- **WHEN** its checkpoint is reset to `last_seq = 0`
- **THEN** replaying `learning_events` from `seq = 1` MUST reconstruct identical derived state without duplicating side effects

### Requirement: Cross-Surface Frontend State Synchronization
The system SHALL provide a unified `learningEventBus` integrated with `src/lib/reviewSync.ts` and `src/api/learningItemMutationCoordinator.ts` so every committed learning event reconciles Review, Scroll Mode, Queue, Study Mode, and Unified Sessions without stale resurrection.

#### Scenario: Review in Scroll Mode immediately removes card from Queue and Review stores
- **GIVEN** a due flashcard `card-99` is present in both `queueStore` and `reviewStore`
- **WHEN** `card-99` is rated in `scroll_mode` and scheduled into the future, emitting `review_committed` at `seq = 10`
- **THEN** `learningEventBus` MUST notify all subscribed surfaces and advance the sync revision
- **AND** any in-flight `getDueItems` response started before `seq = 10` MUST NOT resurrect `card-99` into the due queue

#### Scenario: Duplicate IPC and local event notifications are deduplicated
- **GIVEN** a frontend command returns a committed `LearningEvent` with `idempotencyKey = "k-1"`
- **WHEN** the Tauri backend broadcast also delivers the same event `"k-1"`
- **THEN** `learningEventBus` MUST dispatch `"k-1"` to subscribers exactly once

### Requirement: Privacy Inheritance and Health Vault Isolation
The system SHALL enforce `is_local_only` and `is_ai_excluded` document privacy policies on every `learning_events` row inside the write transaction and SHALL maintain complete physical isolation from `health/health.db`.

#### Scenario: Local-only document events never enter the sync outbox
- **GIVEN** a document `doc-priv` with `is_local_only = 1`
- **WHEN** a reading, extract, or review event referencing `doc-priv` (or an item owned by `doc-priv`) is appended
- **THEN** the `learning_events` row MUST be persisted with `is_local_only = 1`
- **AND** `sync::journal::journal_entity` MUST NOT enqueue the event into `sync_outbox`

#### Scenario: AI-excluded document events carry exclusion metadata
- **GIVEN** a document `doc-noai` with `is_ai_excluded = 1`
- **WHEN** a learning event referencing `doc-noai` is appended
- **THEN** the `learning_events` row MUST be persisted with `is_ai_excluded = 1`
- **AND** any cloud AI context builder reading `learning_events` MUST exclude rows with `is_ai_excluded = 1`

#### Scenario: Health Vault remains isolated from learning events
- **GIVEN** wearable or sleep data stored in `health/health.db`
- **WHEN** `learning_events` is queried, projected, or synced
- **THEN** `learning_events` MUST contain zero Health Vault records, foreign keys, or raw biometric payloads

### Requirement: Non-Destructive Migration and Canonical Storage Boundary
The system SHALL preserve all existing review and activity tables (`review_results`, `review_log`, `item_activity_log`, `video_extract_review_events`) during migration `168_unify_learning_state_events`, and SHALL treat SQLite as the sole canonical source of truth over legacy `localStorage` stores (`knowledgeGraphStore.ts`, `knowledgeHealthStore.ts`).

#### Scenario: Upgrade preserves all pre-existing review history
- **GIVEN** an existing `plethora.db` at migration `167_podcast_chapters_and_ad_settings` containing existing `review_results`, `learning_items`, and `study_plans`
- **WHEN** migration `168_unify_learning_state_events` runs
- **THEN** all existing rows MUST remain intact with zero schema breakage and `PRAGMA foreign_key_check` MUST pass with zero violations
