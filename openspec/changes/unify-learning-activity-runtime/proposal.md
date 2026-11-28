# Proposal: Unify Learning Activity Runtime

## Why

Plethora currently executes reading, spaced-repetition review, scroll mode, Study Mode, Guided Reading Trails, language practice, Smart Feeds browsing, and examinations as isolated tabs and surface-specific flows. Learners cannot start a single cohesive learning session that smoothly mixes reading an extract, reviewing due flashcards, completing a guided trail segment, and returning to where they left off after a restart. Because each surface tracks its own ephemeral progress and completion state, users risk repeating already-completed work across surfaces, losing in-flight session context on restart, or encountering inconsistent Study Mode / exam boundaries.

## What Changes

- Define a canonical, strongly-typed `LearningActivity` contract covering all executable learning activities (`incremental_read`, `srs_review`, `guided_reading`, `study_workspace`, `practice_check`, `exam_attempt`, `remediation`, `exploration_feed`, `language_practice`) with uniform metadata, provenance, privacy flags, duration estimates, and completion payloads.
- Introduce a persisted, resumable heterogeneous `LearningSession` runtime backed by SQLite migration `171_learning_activity_runtime` (with an identical TypeScript domain engine and local fallback for PWA/test environments).
- Implement non-invasive runtime adapters that wrap existing canonical surfaces—including `DocumentViewerWrapper.tsx` (`study-canonical-reader-host`), `ReviewTab`, `QueueScrollPage`, Guided Reading Trails (`src/lib/study-plans/reading/*`), and resumable Examinations—without duplicating viewers or schedulers.
- Enforce deterministic duplicate-work prevention across heterogeneous sessions, standalone Review, and Scroll Mode using canonical `learning_events` completion receipts and active-activity reconciliation.
- Enforce strict exam-mode isolation when a session launches or resumes an `exam_attempt` activity so answer keys, hints, Study Mode assistant panels, and unrelated session interruptions are sealed off while preserving safe pause/resume.

## Capabilities

### New Capabilities

- `learning-activity-runtime`: Canonical `LearningActivity` and persisted `LearningSession` execution contracts, surface adapters, duplicate-work prevention, and exam-mode isolation.

### Modified Capabilities

- None (existing Study Mode, Review, Scroll Mode, Guided Reading Trails, and Examination capabilities are wrapped via adapters without breaking their standalone contracts).

## Dependencies

- `unify-learning-state-and-events` (Phase 1): Provides the canonical `learning_events` transactional log, idempotency keys, and cross-surface event bus used for completion receipts and duplicate-work prevention.
- `establish-persistent-learner-model` (Phase 1): Consumes canonical activity completion events to update 5-dimension competency evidence.
- `unify-learning-goals-and-study-plans` (Phase 1): Supplies goal and Study Plan node references attached to `LearningActivity` items and `LearningSession` scopes.

## Non-Goals

- Replacing or duplicating `BaseDocumentViewer`, `DocumentViewerWrapper.tsx` (`study-canonical-reader-host`), FSRS-7 (`src-tauri/src/algorithms/fsrs7/`), or the Examination grading engine.
- Ranking or selecting activities across providers (owned by `extend-daqe-learning-orchestration`).
- Redesigning the Today dashboard UI or global navigation chrome (owned by `redesign-today-learning-dashboard` and Phase 3 `consolidate-learning-navigation-and-workspaces`).
- Introducing third-party code-execution sandboxes or new Phase 4 specialized activity types (owned by `extend-learning-activity-types`).
- Forcing casual readers to create a `LearningSession`, set goals, or take assessments before opening a document.

## Privacy & Security

- **Health Vault Isolation:** The activity runtime MUST NEVER read, query, or store rows from `health/health.db`, nor embed biometric/sleep records into `learning_sessions` or `learning_session_items`.
- **Document Privacy Enforcement:** Every `LearningActivity` inherits `is_local_only` and `is_ai_excluded` flags from its source document/item via `src-tauri/src/database/document_privacy.rs` and `src/lib/ai/assistant/privacyGate.ts`. Local-only activities are excluded from cloud sync outbox entries (`sync/journal.rs`) and cloud AI calls; AI-excluded activities disable AI assistant actions inside the activity host.
- **Offline & Zero-AI Operation:** Starting, executing, pausing, resuming, and completing heterogeneous `LearningSession` flows MUST work 100% offline with zero AI providers configured.
- **Exam Integrity:** Active `exam_attempt` activities enforce stripped answer keys, suppress assistant/hint overlays, and isolate exam state from casual study actions.

## Migration & Backward Compatibility

- **SQLite Migration `171_learning_activity_runtime`:** Adds `learning_sessions` and `learning_session_items` tables plus indexes in `src-tauri/src/database/migrations.rs`. The migration is strictly additive, transactional, and idempotent.
- **Zero Disruption to Existing Flows:** Opening documents directly from Library, reviewing in `ReviewTab`, scrolling in `QueueScrollPage`, or launching standalone Study Plans / Exams continues to work identically. Existing `study_mode_sessions`, `exam_sessions`, `review_results`, and `saved_queues` tables remain untouched.

## Performance

- Launching or resuming a `LearningSession` and hydrating its active adapter MUST complete in under 50 ms on local SQLite (excluding underlying document rendering time).
- Advancing from one activity to the next MUST reuse the single mounted `study-canonical-reader-host` when consecutive activities target document/reader surfaces, avoiding redundant viewer teardowns.
- Session item state transitions are persisted via lightweight single-row SQLite updates without blocking the React render thread.

## Rollback & Recovery

- If a `LearningSession` fails to hydrate an adapter (e.g., deleted source document or missing exam blueprint), the runtime marks that item `skipped_unavailable`, logs a structured diagnostic, and advances cleanly to the next valid item without crashing the session.
- Because migration `171_learning_activity_runtime` is purely additive, rolling back application code leaves all legacy tables (`documents`, `extracts`, `learning_items`, `review_results`, `study_plans`, `exam_sessions`) intact and readable.

## Impact

- **Backend (Rust/Tauri):** `src-tauri/src/database/migrations.rs` (`171_learning_activity_runtime`), `src-tauri/src/models/learning_activity.rs`, `src-tauri/src/database/learning_session_repository.rs`, `src-tauri/src/commands/learning_session.rs`, and `src-tauri/src/sync/journal.rs` integration (respecting `is_local_only`).
- **Frontend (TypeScript/React):** `src/types/learningActivity.ts`, `src/lib/learning-runtime/*`, `src/stores/learningSessionStore.ts`, `src/components/learning-session/*`, and thin adapters over `DocumentViewerWrapper.tsx`, `ReviewTab`, `QueueScrollPage`, Guided Reading Trails, and Examination surfaces.
- **Tests:** Rust repository/migration/isolation tests and Vitest runtime, duplicate-work, pause/resume, and exam-isolation tests.
