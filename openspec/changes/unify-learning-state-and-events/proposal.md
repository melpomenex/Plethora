# Proposal: Unify Learning State and Events

## Why

Plethora's learning activity and state are currently fragmented across four SQLite tables (`review_results`, `review_log`, `item_activity_log`, `video_extract_review_events`), an in-memory frontend bus (`src/lib/reviewSync.ts`), per-item mutation locks (`src/api/learningItemMutationCoordinator.ts`), unimplemented `reading_goals.rs` stubs, and competing `localStorage` stores (`knowledgeGraphStore.ts`, `knowledgeHealthStore.ts`). Because there is no canonical, persisted, versioned learning event stream:

1. **Cross-surface drift:** Reviewing a card in Queue, Scroll Mode, Quick Review, Study Mode, or an upcoming Unified Session can leave stale due lists, inconsistent counters, or dropped updates across restarts.
2. **Double-counting and non-idempotent consumers:** Downstream systems (learner model, goals, DAQE, motivation, analytics) have no single idempotency key or causal correlation ID to guarantee at-most-once state projection across retries, undos, and E2EE sync replays.
3. **Siloed signals:** Reading progress, extract creation, FSRS-7 review outcomes, guided reading checks, Socratic practice, and exam grades are stored in incompatible shapes, preventing a unified learner model or cross-surface orchestration.

Establishing a canonical, versioned `learning_events` log in SQLite paired with a unified frontend event bus and transactional emission hooks provides the durable event spine required by the entire Unified Personal Learning Operating System.

## What Changes

1. **SQLite Migration `168_unify_learning_state_events`:**
   - Adds append-only `learning_events` table with monotonic sequence/revision metadata, deterministic `idempotency_key` uniqueness, `schema_version`, `event_type`, `actor`, `surface`, `session_id`, `goal_id`, `entity_kind`, `entity_id`, `document_id`, `privacy_flags`, `payload_json`, `occurred_at`, `created_at`, and optional `retracted_by_event_id`.
   - Adds `learning_event_checkpoints` table so downstream projectors (Learner Model, Goals, DAQE, Motivation) track their durable high-water mark (`last_seq`) for incremental replay and crash recovery.
   - Preserves all existing tables (`review_results`, `review_log`, `item_activity_log`, `video_extract_review_events`) untouched for full backward compatibility.
2. **Rust Canonical Event Repository & Transactional Emission:**
   - Adds `src-tauri/src/database/learning_event_repository.rs` and `src-tauri/src/models/learning_event.rs`.
   - Provides `append_learning_event_tx(tx, input)` so domain mutations (FSRS-7 review commit/undo in `review.rs` & `extract_review.rs`, reading progress, extract creation, study mode actions, guided reading checks, exam grade commits) emit canonical events inside the exact same SQLite transaction.
   - Integrates with `document_privacy.rs` and `sync/journal.rs` (`EntityType::LearningEvent` / `SyncOperation::AppendEvent`) so `is_local_only` and `is_ai_excluded` documents are strictly enforced at write and sync boundaries.
3. **Unified Frontend Event Bus & Cross-Surface State Reconciliation:**
   - Evolves `src/lib/reviewSync.ts` and `src/api/learningItemMutationCoordinator.ts` to bridge onto a canonical `src/lib/learning/learningEventBus.ts` (with Tauri backend event subscription + PWA/test local fallback).
   - Ensures Review, Scroll Mode, Queue, Study Mode, and Unified Sessions reconcile immediately from committed canonical events without resurrecting stale due items.
4. **Canonical State Projection Boundaries:**
   - Marks SQLite as the sole canonical source of truth for learning events and derived projections; deprecates direct `localStorage` canonical writes in `knowledgeGraphStore.ts` and `knowledgeHealthStore.ts` in favor of read-through caches hydrated from SQLite.

## Capabilities

### New Capabilities
- `learning-state-and-events`: Canonical, versioned, idempotent `learning_events` persistence, transactional domain emission, durable consumer checkpoints, privacy-aware sync journaling, and unified cross-surface frontend reconciliation.

### Modified Capabilities
- None (existing FSRS-7 review tables, `reviewSync.ts` API surface, and `learningItemMutationCoordinator.ts` lock semantics remain backward compatible while delegating to the canonical event spine).

## Dependencies

- **Upstream:** None (Phase 1 foundational change).
- **Downstream Consumers:** `establish-persistent-learner-model`, `unify-learning-goals-and-study-plans`, `unify-learning-activity-runtime`, `extend-daqe-learning-orchestration`, `implement-optional-motivational-systems`, `validate-unified-learning-experience-end-to-end`.

## Non-Goals

- Replacing or altering FSRS-7 (`src-tauri/src/algorithms/fsrs7/` & `src/algorithms/fsrs7/`) as the sole authoritative item scheduler.
- Dropping or migrating away from legacy `review_results`, `review_log`, `item_activity_log`, or `video_extract_review_events` tables.
- Ingesting or referencing any data from the physically isolated Health Vault (`health/health.db`).
- Computing 5-dimension competency estimates (owned by `establish-persistent-learner-model`) or goal progress (owned by `unify-learning-goals-and-study-plans`).

## Privacy & Security

- **Local-Only & AI-Excluded Enforcement:** Every `learning_events` row resolves its owning `document_id` (directly or via `learning_items`/`extracts`) inside the write transaction. Events linked to `is_local_only = 1` documents are marked `is_local_only = 1`, registered in `private_sync_ownership`, and NEVER enqueued into `sync_outbox` (`document_privacy::sync_entity_allowed`). Events linked to `is_ai_excluded = 1` documents are marked `is_ai_excluded = 1` and stripped before any cloud AI context assembly.
- **Health Vault Isolation:** `learning_events` has zero foreign keys, event types, or payload fields referencing `health/health.db`. Wearable/sleep records remain strictly isolated.
- **Payload Hygiene:** Event payloads carry structured IDs, numeric metrics, and enum outcomes—never raw document text, private excerpts, or user credentials.

## Migration & Backward Compatibility

- Migration `168_unify_learning_state_events` is purely additive (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) and executes transactionally inside `src-tauri/src/database/migrations.rs`.
- Existing databases with 0 to millions of `review_results` rows upgrade with zero data loss and zero mandatory blocking backfill; optional background checkpointed backfill can seed historical events idempotently using deterministic `idempotency_key`s (`backfill:review_result:<id>`).
- Existing `reviewSync.ts` subscribers continue to receive `review-committed` and `review-undone` events bridged seamlessly from the canonical `learningEventBus`.

## Performance

- Transactional event insertion adds a single indexed `INSERT` (< 0.5 ms on SQLite WAL) inside the existing domain write transaction.
- Composite indexes on `(seq)`, `(entity_kind, entity_id, occurred_at)`, `(event_type, occurred_at)`, and `(document_id)` keep incremental checkpoint queries and entity timelines under 5 ms even at 500,000+ events.
- Frontend event bus dispatches synchronously to subscribed stores with monotonic sequence deduplication, preventing redundant refetch storms.

## Rollback / Recovery

- Because migration `168_unify_learning_state_events` is strictly additive and legacy tables remain authoritative for FSRS-7 scheduling, disabling event consumers or reverting application code leaves all existing review schedules, documents, extracts, and study plans intact.
- If a downstream projection corrupts or falls behind, resetting its row in `learning_event_checkpoints` to `last_seq = 0` replays the append-only `learning_events` log deterministically.

## Impact

- **Database:** `src-tauri/src/database/migrations.rs` (migration `168_unify_learning_state_events`), new `learning_event_repository.rs`, `document_privacy.rs` (`EntityType::LearningEvent`), `sync/types.rs` & `sync/journal.rs`.
- **Backend Commands:** `src-tauri/src/commands/learning_events.rs`, emission hooks in `review.rs`, `extract_review.rs`, `study_mode.rs`, `exam_grading_repository.rs`, `study_reading_repository.rs`.
- **Frontend:** `src/lib/learning/learningEventBus.ts`, `src/lib/reviewSync.ts`, `src/api/learningItemMutationCoordinator.ts`, `src/api/learning-events.ts`, read-through cache guards in `knowledgeGraphStore.ts` & `knowledgeHealthStore.ts`.
