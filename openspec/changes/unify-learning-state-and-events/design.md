# Design: Unify Learning State and Events

## 1. Architecture Overview

The unified learning state and event spine establishes a single append-only, schema-versioned event log (`learning_events`) in `plethora.db` as the canonical observation stream for all learning activity across Plethora, paired with durable consumer checkpoints (`learning_event_checkpoints`) and a unified frontend event bus (`learningEventBus.ts`).

```text
Domain Mutations (single SQLite TX)
  ├── FSRS-7 Review Commit / Undo (review.rs, extract_review.rs)
  ├── Reading Progress & Extracts (document_repository.rs, study_mode.rs)
  ├── Guided Reading & Formative Checks (study_trail_repository.rs)
  ├── Exam Grade Commit / Invalidation (exam_grading_repository.rs)
  └── Manual Mastery / Goal Mutations (learner_model, learning_goals)
          │
          ▼  append_learning_event_tx(tx, input) [idempotent, privacy-checked]
  ┌───────────────────────────┐
  │     learning_events       │ ──► sync::journal::journal_entity (if !is_local_only)
  │  (seq, idempotency_key)   │
  └───────────────────────────┘
          │
          ├──► Tauri event ("learning-event:committed") ──► learningEventBus.ts
          │                                                    ├──► reviewSync.ts bridge
          │                                                    ├──► queueStore / reviewStore / ScrollMode
          │                                                    └──► Active LearningSession / Today UI
          │
          └──► Durable Projectors (via learning_event_checkpoints.last_seq)
                 ├──► Learner Model (5D competency projection)
                 ├──► Unified Learning Goals (progress & feasibility)
                 ├──► DAQE Cache Invalidation
                 └──► Optional Motivation (idempotent XP / streaks)
```

### Key Architectural Decisions

1. **FSRS-7 Remains Sole Authoritative Item Scheduler:** `learning_events` observes review commits and undos; it never computes intervals, stability, difficulty, or due dates. FSRS-7 (`src-tauri/src/algorithms/fsrs7/` & `src/algorithms/fsrs7/`) remains the single authority for item scheduling.
2. **Append-Only with Explicit Retraction (Never In-Place Mutation):** Undoing a review or invalidating an exam grade appends a compensating event (`review_undone`, `assessment_grade_invalidated`) and sets `retracted_by_event_id` on the superseded event row. Consumers can always reconstruct exact point-in-time state and undo cleanly.
3. **Deterministic Idempotency Keys:** Every event carries a caller-supplied `idempotency_key` (e.g., `review_commit:<review_result_id>`, `exam_grade:<grade_id>`, `reading_segment:<doc_id>:<segment_hash>:<session_id>`). Duplicate emissions (from retries, UI double-clicks, or E2EE sync replays) resolve via `ON CONFLICT(idempotency_key) DO NOTHING` and return the existing event ID without double-emitting or double-counting.
4. **Transactional Privacy Inheritance:** Inside `append_learning_event_tx`, if `document_id` is present (or resolvable from `entity_kind`/`entity_id`), the repository queries `documents.is_local_only` and `documents.is_ai_excluded` on the same transaction. If `is_local_only = 1`, the event is stored locally with `is_local_only = 1`, recorded in `private_sync_ownership`, and skipped by `sync::journal::journal_entity`.
5. **Health Vault Hard Boundary:** `learning_events` lives exclusively in `plethora.db` and forbids any `entity_kind` or `event_type` referencing `health/health.db` tables or wearable metrics.

---

## 2. SQLite Schema (`168_unify_learning_state_events`)

Added sequentially in `src-tauri/src/database/migrations.rs` immediately after `167_podcast_chapters_and_ad_settings`:

```sql
-- Migration 168_unify_learning_state_events
CREATE TABLE IF NOT EXISTS learning_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    schema_version INTEGER NOT NULL DEFAULT 1,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'review_committed',
        'review_undone',
        'reading_progressed',
        'reading_completed',
        'extract_created',
        'card_created',
        'guided_check_completed',
        'practice_attempted',
        'assessment_submitted',
        'assessment_graded',
        'assessment_grade_invalidated',
        'concept_mastery_declared',
        'goal_created',
        'goal_updated',
        'goal_completed',
        'session_started',
        'session_paused',
        'session_resumed',
        'session_completed',
        'remediation_completed'
    )),
    actor TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('user', 'system', 'sync')),
    surface TEXT NOT NULL DEFAULT 'unknown' CHECK (surface IN (
        'review', 'scroll_mode', 'quick_review', 'zen_review', 'queue',
        'reader', 'study_mode', 'guided_trail', 'exam', 'unified_session',
        'knowledge_atlas', 'today_dashboard', 'background', 'sync', 'unknown'
    )),
    session_id TEXT,
    goal_id TEXT,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'learning_item', 'extract', 'document', 'concept', 'study_plan',
        'study_plan_node', 'assessment_attempt', 'exam_grade', 'guided_trail',
        'learning_goal', 'learning_session', 'remediation'
    )),
    entity_id TEXT NOT NULL,
    document_id TEXT,
    is_local_only INTEGER NOT NULL DEFAULT 0 CHECK (is_local_only IN (0, 1)),
    is_ai_excluded INTEGER NOT NULL DEFAULT 0 CHECK (is_ai_excluded IN (0, 1)),
    payload_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    retracted_by_event_id TEXT REFERENCES learning_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_events_entity
    ON learning_events(entity_kind, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_type_occurred
    ON learning_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_document
    ON learning_events(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_learning_events_session
    ON learning_events(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_learning_events_goal
    ON learning_events(goal_id) WHERE goal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS learning_event_checkpoints (
    consumer_id TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0,
    policy_version TEXT NOT NULL DEFAULT 'v1',
    updated_at TEXT NOT NULL
);
```

### Privacy & Sync Extension

- Extend `EntityType` in `src-tauri/src/sync/types.rs` with `EntityType::LearningEvent` (`"learning_event"`).
- Extend `document_privacy::sync_entity_allowed` to include `EntityType::LearningEvent` in the privacy-checked entity set, checking both `private_sync_ownership` and `learning_events.is_local_only = 1`.
- Sync payloads for `EntityType::LearningEvent` use `SyncOperation::AppendEvent` and `MergeStrategy::AppendOnly`, deduplicated on remote merge by `idempotency_key`.

---

## 3. Rust & TypeScript Interfaces

### Rust (`src-tauri/src/models/learning_event.rs`)

```rust
use serde::{Deserialize, Serialize};

pub const LEARNING_EVENT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LearningEventType {
    ReviewCommitted,
    ReviewUndone,
    ReadingProgressed,
    ReadingCompleted,
    ExtractCreated,
    CardCreated,
    GuidedCheckCompleted,
    PracticeAttempted,
    AssessmentSubmitted,
    AssessmentGraded,
    AssessmentGradeInvalidated,
    ConceptMasteryDeclared,
    GoalCreated,
    GoalUpdated,
    GoalCompleted,
    SessionStarted,
    SessionPaused,
    SessionResumed,
    SessionCompleted,
    RemediationCompleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningEvent {
    pub seq: i64,
    pub id: String,
    pub idempotency_key: String,
    pub schema_version: i64,
    pub event_type: LearningEventType,
    pub actor: String,
    pub surface: String,
    pub session_id: Option<String>,
    pub goal_id: Option<String>,
    pub entity_kind: String,
    pub entity_id: String,
    pub document_id: Option<String>,
    pub is_local_only: bool,
    pub is_ai_excluded: bool,
    pub payload: serde_json::Value,
    pub occurred_at: String,
    pub created_at: String,
    pub retracted_by_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendLearningEventInput {
    pub idempotency_key: String,
    pub event_type: LearningEventType,
    pub actor: Option<String>,
    pub surface: String,
    pub session_id: Option<String>,
    pub goal_id: Option<String>,
    pub entity_kind: String,
    pub entity_id: String,
    pub document_id: Option<String>,
    pub payload: serde_json::Value,
    pub occurred_at: Option<String>,
    pub retracts_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendLearningEventResult {
    pub event: LearningEvent,
    pub inserted: bool, // false when idempotency_key matched an existing row
}
```

### TypeScript (`src/lib/learning/learningEventTypes.ts` & `learningEventBus.ts`)

```ts
export type LearningEventType =
  | "review_committed"
  | "review_undone"
  | "reading_progressed"
  | "reading_completed"
  | "extract_created"
  | "card_created"
  | "guided_check_completed"
  | "practice_attempted"
  | "assessment_submitted"
  | "assessment_graded"
  | "assessment_grade_invalidated"
  | "concept_mastery_declared"
  | "goal_created"
  | "goal_updated"
  | "goal_completed"
  | "session_started"
  | "session_paused"
  | "session_resumed"
  | "session_completed"
  | "remediation_completed";

export interface LearningEvent<TPayload = Record<string, unknown>> {
  seq: number;
  id: string;
  idempotencyKey: string;
  schemaVersion: number;
  eventType: LearningEventType;
  actor: "user" | "system" | "sync";
  surface: string;
  sessionId: string | null;
  goalId: string | null;
  entityKind: string;
  entityId: string;
  documentId: string | null;
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  payload: TPayload;
  occurredAt: string;
  createdAt: string;
  retractedByEventId: string | null;
}

export interface LearningEventBus {
  subscribe(listener: (event: LearningEvent) => void): () => void;
  publishCommitted(event: LearningEvent): boolean; // deduplicates by idempotencyKey / seq
  getHighWaterSeq(): number;
  isStaleRelativeTo(entityKind: string, entityId: string, startedAtSeq: number): boolean;
}
```

---

## 4. Event Contracts & Cross-Surface Reconciliation

### Review Commit / Undo Contract
- **Emission:** `src-tauri/src/commands/review.rs` (`submit_review`, `undo_review`) and `extract_review.rs` call `append_learning_event_tx` inside the FSRS-7 commit transaction.
- **Payload for `review_committed`:** `{ reviewResultId, rating, elapsedDays, scheduledDays, stability, difficulty, retrievability, newDueDate, isSuspended, buryExtractId, cardFamilyId }`.
- **Payload for `review_undone`:** `{ undoneReviewResultId, restoredDueDate, restoredState }`, setting `retracts_event_id` to the original `review_committed` event ID.
- **Frontend Reconciliation:** `learningEventBus` receives the committed `LearningEvent` (both from Tauri event emission and direct command return, deduplicated by `idempotencyKey`). It bridges `review_committed` / `review_undone` into `reviewSync.ts`, advancing `syncRevision` and updating `recentCommitStates` so in-flight `getDueItems` fetches in Queue, Scroll Mode, Quick Review, or Unified Sessions cannot resurrect an already-reviewed item.

### Mutation Serialization
- `src/api/learningItemMutationCoordinator.ts` continues to serialize concurrent per-item operations (`edit`, `delete`, `rate`, `restore`) in-process and tags outbound commands with a deterministic `idempotencyKey` derived from `(itemId, operation, revision)` so network/IPC retries cannot double-commit.

### Legacy `localStorage` Store Reconciliation
- `src/stores/knowledgeGraphStore.ts` and `src/stores/knowledgeHealthStore.ts` stop acting as independent canonical writers. They subscribe to `learningEventBus` invalidations and hydrate from SQLite repositories (`concept_repository.rs`, `learning_evidence_repository.rs`), using `localStorage` solely as an optional, versioned read-through UI cache that is invalidated whenever `learningEventBus.getHighWaterSeq()` advances.

---

## 5. Testing Strategy

1. **Migration Tests (`src-tauri/src/database/migrations.rs`):** Verify `168_unify_learning_state_events` applies cleanly to both fresh and pre-existing databases, enforces `CHECK` constraints, enforces `UNIQUE(idempotency_key)`, preserves all existing `review_results` rows, and passes `PRAGMA foreign_key_check`.
2. **Idempotency & Retraction Tests (`learning_event_repository.rs`):** Verify duplicate `idempotency_key` returns `inserted = false` with identical `seq`/`id`, and `retracts_event_id` links `retracted_by_event_id` atomically.
3. **Privacy & Sync Isolation Tests (`document_privacy.rs`):** Verify events referencing `is_local_only = 1` documents are flagged `is_local_only = 1`, never enter `sync_outbox`, and cannot be lowered by stale sync replays; verify `is_ai_excluded = 1` propagates onto events.
4. **Cross-Surface Frontend Reconciliation Tests (`src/lib/learning/__tests__/learningEventBus.test.ts`):** Verify `review_committed` from `scroll_mode` immediately updates `reviewStore` and `queueStore`, deduplicates duplicate deliveries, prevents stale `getDueItems` resurrection, and handles `review_undone` cleanly.
5. **Checkpoint Replay Tests:** Verify a consumer advancing `learning_event_checkpoints.last_seq` can resume after interruption and produce identical derived state upon full reset (`last_seq = 0`).
