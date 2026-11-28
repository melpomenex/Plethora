# Tasks: Unify Learning Activity Runtime

## 1. Schema & Migration (`171_learning_activity_runtime`)
- [ ] Add transactional, idempotent SQLite migration `171_learning_activity_runtime` in `src-tauri/src/database/migrations.rs` creating `learning_sessions` and `learning_session_items` with constraints and indexes.
- [ ] Add migration unit test verifying fresh creation, idempotent re-run, and zero impact on existing tables (`documents`, `extracts`, `learning_items`, `review_results`, `study_plans`, `exam_sessions`).

## 2. Backend Models, Repository & Tauri Commands
- [ ] Define Rust structs/enums (`LearningActivity`, `LearningActivityKind`, `LearningActivityLifecycleState`, `LearningSession`, `LearningSessionItem`) in `src-tauri/src/models/learning_activity.rs`.
- [ ] Implement `src-tauri/src/database/learning_session_repository.rs` supporting session creation (with `dedupeKey` collapsing and monotonic `is_local_only` computation), item state transitions, checkpoint persistence, active/paused session lookup, and cross-surface `dedupeKey` reconciliation.
- [ ] Wire `document_privacy.rs` checks on session create/resume so `is_local_only` upgrades monotonically and local-only sessions are excluded from `sync/journal.rs`.
- [ ] Expose Tauri commands in `src-tauri/src/commands/learning_session.rs` (`create_learning_session`, `get_active_learning_session`, `resume_learning_session`, `pause_learning_session`, `complete_learning_session_item`, `skip_or_defer_learning_session_item`, `end_learning_session`) and register them in `src-tauri/src/lib.rs`.

## 3. Frontend Domain Engine, Store & Event Reconciliation
- [ ] Create canonical TypeScript types and deterministic `dedupeKey` builders in `src/types/learningActivity.ts` and `src/lib/learning-runtime/dedupeKey.ts`.
- [ ] Implement the TypeScript `LearningSessionEngine` in `src/lib/learning-runtime/sessionEngine.ts` with Tauri command bindings and local fallback persistence for PWA/Vitest environments.
- [ ] Create `src/stores/learningSessionStore.ts` managing active/paused session state, elapsed active time tracking, idempotent completion dispatch, and subscription to the Phase 1 `learning_events` bus for live duplicate-work reconciliation.

## 4. Surface Adapters & Exam-Mode Isolation
- [ ] Implement `LearningActivityAdapterRegistry` in `src/lib/learning-runtime/adapterRegistry.ts` with availability validation and graceful `skipped_unavailable` fallback.
- [ ] Implement thin adapters for `incremental_read` / `study_workspace` (reusing `DocumentViewerWrapper.tsx` `study-canonical-reader-host`), `srs_review` (delegating to FSRS-7 review pipeline), `guided_reading` (reusing `trailController.ts`), `exam_attempt` (reusing resumable Examination runner), `remediation`, `practice_check`, `exploration_feed`, and `language_practice`.
- [ ] Implement `src/components/learning-session/LearningSessionHost.tsx` with session header/progress bar, pause/resume/skip/defer controls, and strict `exam_isolated` mode that hides `AssistantPanel`, Socratic tutor, hints, and casual navigation during `exam_attempt` activities.

## 5. Verification & Privacy Audits
- [ ] Add Rust unit tests covering migration `171`, session persistence/resume, `dedupeKey` reconciliation, `is_local_only` sync exclusion, and zero `health.db` coupling.
- [ ] Add Vitest suites covering heterogeneous session lifecycle, cross-surface duplicate-work prevention (ReviewTab/QueueScrollPage -> paused session), single `study-canonical-reader-host` reuse, exam-mode isolation, and offline/zero-AI execution.
- [ ] Run `npx tsc --noEmit`, targeted Vitest suites, and `cd src-tauri && cargo test --lib learning_session` to verify all checks pass.
