# Tasks: Unify Learning State and Events

## 1. Database Schema & Privacy/Sync Plumbing
- [ ] Add migration `168_unify_learning_state_events` to `src-tauri/src/database/migrations.rs` creating `learning_events`, its indexes, and `learning_event_checkpoints`.
- [ ] Add `EntityType::LearningEvent` to `src-tauri/src/sync/types.rs` and update `src-tauri/src/database/document_privacy.rs` (`sync_entity_allowed`) to block `is_local_only = 1` learning events from `sync_outbox`.
- [ ] Add Rust migration unit tests verifying fresh install, upgrade from migration 167, `CHECK` constraints, `UNIQUE(idempotency_key)`, and `PRAGMA foreign_key_check`.

## 2. Rust Event Model, Repository & Transactional Emission
- [ ] Create `src-tauri/src/models/learning_event.rs` with `LearningEvent`, `LearningEventType`, `AppendLearningEventInput`, `AppendLearningEventResult`, and `LearningEventCheckpoint`.
- [ ] Create `src-tauri/src/database/learning_event_repository.rs` implementing `append_learning_event_tx`, `list_events_after_seq`, `list_events_for_entity`, `get_checkpoint`, `advance_checkpoint_tx`, and `reset_checkpoint`.
- [ ] Resolve `is_local_only` and `is_ai_excluded` from `documents` / `learning_items` / `extracts` inside `append_learning_event_tx` and invoke `sync::journal::journal_entity` only when permitted.
- [ ] Wire `append_learning_event_tx` into FSRS-7 review commit & undo (`src-tauri/src/commands/review.rs`, `src-tauri/src/commands/extract_review.rs`), reading progress/extract creation, study mode actions, and exam grade commits (`exam_grading_repository.rs`).
- [ ] Add Tauri commands in `src-tauri/src/commands/learning_events.rs` (`append_learning_event`, `list_learning_events`, `get_learning_event_high_water_seq`) and register them in `src-tauri/src/lib.rs`, emitting `learning-event:committed` after transaction commit.

## 3. Unified Frontend Event Bus & Cross-Surface Reconciliation
- [ ] Create `src/lib/learning/learningEventTypes.ts`, `src/api/learning-events.ts` (with Tauri invoke + PWA/test local fallback), and `src/lib/learning/learningEventBus.ts` with `idempotencyKey` deduplication and monotonic sequence tracking.
- [ ] Bridge `src/lib/reviewSync.ts` onto `learningEventBus.ts` so `review_committed` and `review_undone` synchronize `queueStore`, `reviewStore`, Scroll Mode, Quick Review, and Study Mode without stale due-item resurrection.
- [ ] Update `src/api/learningItemMutationCoordinator.ts` to attach deterministic `idempotencyKey`s to serialized mutation operations.
- [ ] Convert `src/stores/knowledgeGraphStore.ts` and `src/stores/knowledgeHealthStore.ts` to read-through caches invalidated by `learningEventBus` rather than competing canonical `localStorage` writers.

## 4. Verification & Testing
- [ ] Add Rust unit tests in `learning_event_repository.rs` covering idempotency, retraction chaining, checkpoint advancement/reset, and privacy enforcement (`is_local_only` / `is_ai_excluded`).
- [ ] Add Vitest unit tests in `src/lib/learning/__tests__/learningEventBus.test.ts` covering cross-surface reconciliation, duplicate delivery suppression, stale fetch filtering, and undo handling.
- [ ] Run `npx tsc --noEmit`, `npx vitest run src/lib/learning/`, and `cd src-tauri && cargo test --lib learning_event` to verify all checks pass.
