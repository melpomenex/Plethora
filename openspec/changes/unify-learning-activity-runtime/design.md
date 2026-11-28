# Design: Unify Learning Activity Runtime

## Context

Plethora already contains mature, production-tested execution surfaces for reading (`DocumentViewerWrapper.tsx` hosting the single canonical `BaseDocumentViewer` inside `study-canonical-reader-host`), spaced-repetition review (`ReviewTab`, `reviewStore.ts`, FSRS-7), incremental scroll (`QueueScrollPage.tsx`), Guided Reading Trails (`src/lib/study-plans/reading/*`), and resumable Examinations (`exam_session_repository.rs`). However, each surface manages its own launch path, progress state, and completion lifecycle.

This design introduces a unified, persisted `LearningActivity` and `LearningSession` runtime that orchestrates these existing surfaces through thin adapters while enforcing duplicate-work prevention, exam-mode isolation, offline-first durability, and strict privacy propagation.

## Goals / Non-Goals

- **Goals:**
  - Provide one canonical `LearningActivity` discriminated contract usable by DAQE, Today dashboard, Study Plans, and standalone launchers.
  - Persist resumable heterogeneous `LearningSession` state in SQLite (`171_learning_activity_runtime`) with a mirrored TypeScript domain engine for PWA/Vitest parity.
  - Prevent duplicate work when an item is completed inside a session or concurrently in Review / Scroll Mode / standalone reader.
  - Guarantee strict exam-mode isolation whenever an `exam_attempt` activity is active.
  - Preserve zero-friction casual reading and 100% offline / zero-AI operation.
- **Non-Goals:**
  - Re-implementing FSRS-7 scheduling, document viewers, or exam grading logic.
  - Defining DAQE scoring formulas or session focus profiles (see `extend-daqe-learning-orchestration`).
  - Defining Today dashboard visual layout (see `redesign-today-learning-dashboard`).

## Architecture & Contracts

### 1. Canonical `LearningActivity` Contract

Every schedulable or executable unit of learning conforms to a versioned `LearningActivity` descriptor:

```ts
export type LearningActivityKind =
  | "incremental_read"
  | "srs_review"
  | "guided_reading"
  | "study_workspace"
  | "practice_check"
  | "exam_attempt"
  | "remediation"
  | "exploration_feed"
  | "language_practice";

export type LearningActivityLifecycleState =
  | "queued"
  | "active"
  | "paused"
  | "completed"
  | "skipped"
  | "deferred"
  | "skipped_unavailable";

export interface LearningActivityPrivacy {
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  privacyVersion: number;
}

export interface LearningActivity {
  activityId: string;               // Stable deterministic or UUID identifier
  dedupeKey: string;                // Canonical work key, e.g. "srs_review:card:<id>:<dueEpoch>"
  kind: LearningActivityKind;
  title: string;
  subtitle?: string;
  targetRef: {
    entityType:
      | "document"
      | "extract"
      | "learning_item"
      | "study_trail_segment"
      | "exam_blueprint"
      | "exam_session"
      | "remediation"
      | "smart_feed_item"
      | "language_drill";
    entityId: string;
    documentId?: string;
    goalId?: string;
    studyPlanId?: string;
    conceptIds?: string[];
  };
  estimatedMinutes: number;         // Clamped [1, 180], deterministic fallback by kind
  requiresExamIsolation: boolean;   // Always true for kind === "exam_attempt"
  requiresOnline: boolean;          // False for all local activities
  requiresAi: boolean;              // False for core reading/review/exam activities
  privacy: LearningActivityPrivacy;
  launchPayload?: Record<string, unknown>; // Adapter-specific jump/range/mode hints
  explanation?: {
    providerId: string;
    summary: string;
    factors: Array<{ key: string; label: string; contribution: number }>;
  };
}
```

### 2. Persisted `LearningSession` Contract

A `LearningSession` represents an ordered, resumable sequence of heterogeneous `LearningActivity` items with explicit pause/resume checkpoints and time-budget tracking:

```ts
export type LearningSessionStatus =
  | "active"
  | "paused"
  | "completed"
  | "abandoned";

export interface LearningSession {
  sessionId: string;
  profileId: string;                // e.g. "balanced", "exam_prep", "free_exploration", "custom"
  goalId: string | null;
  timeBudgetMinutes: number | null; // null = unlimited; otherwise 5..=120
  elapsedActiveSeconds: number;
  status: LearningSessionStatus;
  currentItemIndex: number;
  items: LearningSessionItem[];
  createdAt: string;                // ISO-8601 UTC
  updatedAt: string;
  pausedAt: string | null;
  completedAt: string | null;
  isLocalOnly: boolean;             // True if ANY item in session isLocalOnly
}

export interface LearningSessionItem {
  itemId: string;
  sessionId: string;
  position: number;
  activity: LearningActivity;
  state: LearningActivityLifecycleState;
  startedAt: string | null;
  completedAt: string | null;
  activeSeconds: number;
  completionEventId: string | null; // Foreign logical ref to learning_events.event_id
  resumeCheckpointJson: string | null; // Scroll/page/trail/card/exam cursor
}
```

### 3. SQLite Migration `171_learning_activity_runtime`

Added to `src-tauri/src/database/migrations.rs` as transactional, idempotent DDL:

- `learning_sessions`:
  - `id TEXT PRIMARY KEY`
  - `profile_id TEXT NOT NULL DEFAULT 'balanced'`
  - `goal_id TEXT NULL`
  - `time_budget_minutes INTEGER NULL`
  - `elapsed_active_seconds INTEGER NOT NULL DEFAULT 0`
  - `status TEXT NOT NULL CHECK (status IN ('active','paused','completed','abandoned'))`
  - `current_item_index INTEGER NOT NULL DEFAULT 0`
  - `is_local_only INTEGER NOT NULL DEFAULT 0`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
  - `paused_at TEXT NULL`
  - `completed_at TEXT NULL`
- `learning_session_items`:
  - `id TEXT PRIMARY KEY`
  - `session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE`
  - `position INTEGER NOT NULL`
  - `activity_id TEXT NOT NULL`
  - `dedupe_key TEXT NOT NULL`
  - `kind TEXT NOT NULL`
  - `target_entity_type TEXT NOT NULL`
  - `target_entity_id TEXT NOT NULL`
  - `activity_json TEXT NOT NULL`
  - `state TEXT NOT NULL CHECK (state IN ('queued','active','paused','completed','skipped','deferred','skipped_unavailable'))`
  - `started_at TEXT NULL`
  - `completed_at TEXT NULL`
  - `active_seconds INTEGER NOT NULL DEFAULT 0`
  - `completion_event_id TEXT NULL`
  - `resume_checkpoint_json TEXT NULL`
  - `UNIQUE(session_id, position)`
- Indexes:
  - `idx_learning_sessions_status_updated ON learning_sessions(status, updated_at DESC)`
  - `idx_learning_session_items_session_pos ON learning_session_items(session_id, position)`
  - `idx_learning_session_items_dedupe ON learning_session_items(dedupe_key, state)`

**Sync Privacy Rule:** When `learning_sessions.is_local_only = 1` (computed as logical OR of all contained activities' `is_local_only` flags at creation and mutation time), the session and its items are never enqueued into `sync/journal.rs`.

### 4. Surface Adapter Registry

Rather than building new viewers, the runtime mounts adapters conforming to a uniform `LearningActivityAdapter` interface:

```ts
export interface LearningActivityAdapter {
  kind: LearningActivityKind;
  canLaunchOffline: boolean;
  mountSurface(activity: LearningActivity, checkpoint: unknown | null): AdapterMountSpec;
  extractCheckpoint(surfaceState: unknown): unknown | null;
  validateAvailability(activity: LearningActivity): Promise<boolean>;
}
```

Initial adapters wrap existing canonical surfaces:
- `incremental_read` & `study_workspace` → `DocumentViewerWrapper.tsx` (`study-canonical-reader-host`), preserving single-instance `BaseDocumentViewer` mounting and exact scroll/page restoration.
- `srs_review` → existing FSRS-7 review card host (`ReviewTab` / `reviewStore.ts` + `learningItemMutationCoordinator.ts`), keeping FSRS-7 as sole scheduling authority.
- `guided_reading` → `DocumentViewerWrapper.tsx` + `useStudyTrail` (`src/lib/study-plans/reading/trailController.ts`).
- `exam_attempt` → existing resumable Examination runner (`exam_session_repository.rs`).
- `remediation` & `practice_check` → existing formative check drawer / targeted review host.
- `exploration_feed` → Smart Feeds reader surface (`smartFeedsStore.ts`) without auto-creating SRS obligations.
- `language_practice` → existing `LanguagePracticeOverlay` / language host bindings.

### 5. Duplicate-Work Prevention

To guarantee a user never repeats work they already completed across sessions, standalone Review, or Scroll Mode:

1. **Deterministic `dedupeKey`:** Every activity carries a canonical `dedupeKey` combining `(kind, targetEntityType, targetEntityId, scheduleCycleKey)` where `scheduleCycleKey` is the item's current due-epoch/review-counter for `srs_review`, segment revision for `guided_reading`, or attempt ID for `exam_attempt`.
2. **Session Assembly Deduplication:** When creating or appending to a `LearningSession`, duplicate `dedupeKey` entries are collapsed (preserving the highest-priority occurrence).
3. **Live Cross-Surface Reconciliation:** The runtime subscribes to the Phase 1 `learning_events` bus (`unify-learning-state-and-events`). When a completion event arrives for a `dedupeKey` (e.g., user rated a flashcard in `ReviewTab` or `QueueScrollPage` while a `LearningSession` was paused):
   - Any matching `queued` or `paused` item in an open `LearningSession` is automatically transitioned to `completed` with `completion_event_id` attached and `active_seconds = 0` (no double-counting).
   - If the `currentItemIndex` points to that item, the runtime advances the cursor to the next uncompleted item upon resume and displays a subtle non-blocking notice ("1 item already completed elsewhere — skipped").
4. **Idempotent Completion Emission:** Completing an item inside `LearningSession` emits a single `learning_events` record keyed by `(sessionId, itemId, dedupeKey)` so retries or double-clicks cannot double-credit FSRS reviews, learner evidence, or active time.

### 6. Exam-Mode Isolation

When `activity.kind === "exam_attempt"` or `activity.requiresExamIsolation === true`:

1. **Isolated Host Mode:** The session shell enters `exam_isolated` mode:
   - Study Mode assistant panel (`AssistantPanel.tsx`), Socratic tutor, hint drawers, and "peek source" shortcuts are disabled and unmounted.
   - Answer keys remain stripped via existing `exam_session_repository.rs` contracts; no rubric or solution text is passed in `launchPayload`.
   - Non-exam session controls ("Jump to next activity", "Switch to Study Mode", "Open Related Concept") are suppressed until the learner explicitly submits or pauses the exam attempt.
2. **Safe Pause & Resume:** Pausing an exam activity persists both the underlying `exam_sessions` checkpoint and the `learning_session_items.resume_checkpoint_json`, returning the learner to the session summary or Today workspace without forfeiting the attempt or leaking answers.
3. **Strict Boundary Exit:** Leaving `exam_isolated` mode (via submission or pause) restores normal session chrome and emits an authoritative exam completion/pause event via `learning_events`.

## Risks / Trade-offs

- **Risk: Stale checkpoints when source documents are edited or deleted.**
  - *Mitigation:* `validateAvailability` checks entity existence before mounting; missing targets transition cleanly to `skipped_unavailable` and advance the session.
- **Risk: Double-mounting `BaseDocumentViewer` during reader-to-reader transitions.**
  - *Mitigation:* Consecutive reader-backed activities (`incremental_read`, `guided_reading`, `study_workspace`) route through the single `study-canonical-reader-host` key, updating props/jump targets in place.
- **Risk: Privacy drift if a document is marked `is_local_only` after a session was created.**
  - *Mitigation:* On session resume and before sync journaling, the runtime re-checks current `document_privacy` flags from SQLite and upgrades `learning_sessions.is_local_only = 1` monotonically if any member became local-only.
