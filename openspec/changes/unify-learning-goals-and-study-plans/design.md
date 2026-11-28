# Design: Unify Learning Goals and Study Plans

## 1. Architecture Overview

`learning_goals` introduces a lightweight, composable intent layer above Plethora's existing library, Smart Feeds, concepts, FSRS-7 decks/queues, and `study_plans`. Rather than replacing `study_plans`, a `LearningGoal` *optionally* attaches a `study_plan_id` when structured prerequisite curricula and exams are desired.

```text
                      ┌────────────────────────────┐
                      │       learning_goals       │
                      │ kind: exploration|retention│
                      │   |mastery|deadline|skill  │
                      │   |continuous|language     │
                      └──────┬──────────┬──────────┘
                             │          │ (optional 0..1)
          (0..N, zero dup)   │          ▼
     ┌───────────────────────┘    ┌───────────────┐
     ▼                            │  study_plans  │ (existing CAS-versioned DAG)
┌────────────────────────┐        └───────────────┘
│ learning_goal_sources  │
│  - document            │ ◄── Shared across multiple goals without cloning
│  - collection          │
│  - saved_queue         │
│  - concept             │ ──► reads competency_projections (5D Learner Model)
│  - smart_feed          │     (role = 'exploration_candidate' ONLY; never SRS)
│  - tag                 │
└────────────────────────┘
```

### Key Architectural Decisions

1. **Composable Goal Kinds (Not Rigid Silos):** Every goal has a `kind` (`exploration`, `retention`, `mastery`, `deadline`, `skill`, `continuous`, `language`) that provides sensible defaults (e.g., target dimensions, whether a deadline is expected, whether Smart Feeds are primary), but any goal can evolve in-place via `evolve_learning_goal` (e.g., adding a `target_date` turns an `exploration` goal into a `deadline` goal; attaching a `study_plan_id` adds structured curriculum nodes) without creating a new goal ID or losing source links.
2. **Zero-Duplication Sharing:** Documents, extracts, flashcards, concepts, collections, and Smart Feeds are linked via `learning_goal_sources(goal_id, source_kind, source_id, source_role)` with `UNIQUE(goal_id, source_kind, source_id)`. Deleting a goal cascades only `learning_goal_sources` and `learning_goal_milestones`; it NEVER deletes underlying documents, cards, Smart Feeds, or Study Plans.
3. **Smart Feed Boundary:** A `smart_feed` source MUST have `source_role = 'exploration_candidate'`. Linking a Smart Feed to a `continuous` or `exploration` goal surfaces candidate articles in exploration/DAQE feeds without ever auto-creating FSRS-7 cards or mandatory review obligations.
4. **Competency-Aware Progress:** Goal progress reads `competency_projections` from `establish-persistent-learner-model`. If a concept linked to a newly created goal already has `demonstrated` competency on the goal's target dimensions from prior learning, it counts immediately toward progress and reduces remaining workload (zero redundant rework).
5. **Non-Mutating Feasibility:** Deadline feasibility computes workload vs available time deterministically and returns structured recommendations (`increase_daily_budget`, `extend_deadline`, `narrow_scope`, `focus_weakest_dimensions`) for the learner to accept or ignore—never silently mutating FSRS-7 schedules or dropping user content.

---

## 2. SQLite Schema (`170_unified_learning_goals`)

Added sequentially in `src-tauri/src/database/migrations.rs` immediately after `169_persistent_learner_model`:

```sql
-- Migration 170_unified_learning_goals
CREATE TABLE IF NOT EXISTS learning_goals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    kind TEXT NOT NULL CHECK (kind IN (
        'exploration', 'retention', 'mastery', 'deadline', 'skill', 'continuous', 'language'
    )),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'paused', 'completed', 'archived'
    )),
    priority INTEGER NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
    study_plan_id TEXT UNIQUE REFERENCES study_plans(id) ON DELETE SET NULL,
    language_code TEXT,
    target_date TEXT,
    daily_minutes_budget INTEGER CHECK (daily_minutes_budget IS NULL OR (daily_minutes_budget >= 5 AND daily_minutes_budget <= 480)),
    target_dimensions_json TEXT NOT NULL DEFAULT '["comprehension","retention"]',
    target_mastery_threshold REAL NOT NULL DEFAULT 0.80 CHECK (target_mastery_threshold > 0.0 AND target_mastery_threshold <= 1.0),
    policy_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_learning_goals_status_priority
    ON learning_goals(status, priority DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_goals_target_date
    ON learning_goals(target_date) WHERE target_date IS NOT NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS learning_goal_sources (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES learning_goals(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK (source_kind IN (
        'document', 'collection', 'saved_queue', 'study_plan', 'smart_feed', 'concept', 'tag'
    )),
    source_id TEXT NOT NULL,
    source_role TEXT NOT NULL DEFAULT 'primary' CHECK (source_role IN (
        'primary', 'supplemental', 'exploration_candidate'
    )),
    weight REAL NOT NULL DEFAULT 1.0 CHECK (weight > 0.0 AND weight <= 5.0),
    added_at TEXT NOT NULL,
    UNIQUE(goal_id, source_kind, source_id),
    CHECK (source_kind != 'smart_feed' OR source_role = 'exploration_candidate')
);

CREATE INDEX IF NOT EXISTS idx_learning_goal_sources_goal
    ON learning_goal_sources(goal_id, source_role);
CREATE INDEX IF NOT EXISTS idx_learning_goal_sources_lookup
    ON learning_goal_sources(source_kind, source_id);

CREATE TABLE IF NOT EXISTS learning_goal_milestones (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES learning_goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    target_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
    linked_node_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_goal_milestones_goal
    ON learning_goal_milestones(goal_id, sort_order ASC);
```

---

## 3. Deadline Feasibility & Progress Algorithm

Both Rust (`learning_goal_repository.rs`) and TypeScript (`src/lib/learning-goals/feasibility.ts`) implement the exact same deterministic pure function `evaluateGoalFeasibility(input)`:

### Inputs
- `goal`: `kind`, `targetDate`, `dailyMinutesBudget` (default `30` if omitted), `targetDimensions`, `targetMasteryThreshold`.
- `conceptStates`: array of `{ conceptId, estimatedMinutesToMaster, dimensions: Record<CompetencyDimension, DimensionProjection> }`.
- `uncompletedReadingMinutes`: remaining estimated reading/guided-trail minutes across `primary` sources.
- `projectedDueReviewMinutes`: estimated FSRS-7 review minutes over the horizon (`min(daysRemaining, 30)` days, read-only from FSRS-7 due forecast).
- `nowIso`: current UTC timestamp.

### Computation
1. **Competency-Aware Remaining Concept Effort:**
   For each target concept $c$ and each target dimension $d \in \text{targetDimensions}$:
   - If `status == 'demonstrated'` and `estimate >= targetMasteryThreshold`, remaining fraction $f_{c,d} = 0.0$ (prior evidence reused!).
   - Else if `status == 'developing'`, $f_{c,d} = \max(0.15,\; 1.0 - (\text{estimate} / \text{targetMasteryThreshold}))$.
   - Else (`unknown`, `insufficient_evidence`, `needs_attention`), $f_{c,d} = 1.0$.
   - Concept remaining minutes = `estimatedMinutesToMaster` $\times \text{mean}_d(f_{c,d})$.
2. **Total Remaining Effort:**
   $$M_{\text{rem}} = M_{\text{concepts}} + M_{\text{reading}} + M_{\text{reviews}}$$
3. **Unbounded vs Deadline Classification:**
   - If `targetDate == null` (e.g., `exploration` or `continuous` goal):
     - `feasibilityStatus = "unbounded"`, `requiredDailyMinutes = null`, `utilizationRatio = null`.
   - Else let `daysRemaining = max(0, ceil((targetDate - now) / 86400s))`:
     - If `daysRemaining == 0` and $M_{\text{rem}} > 0$: `feasibilityStatus = "infeasible"`, `utilizationRatio = Infinity`.
     - Else:
       - `availableMinutes = daysRemaining * dailyMinutesBudget`
       - `requiredDailyMinutes = ceil(M_rem / daysRemaining)`
       - `utilizationRatio = M_rem / max(1, availableMinutes)`
       - Classification:
         - `utilizationRatio <= 0.80` $\rightarrow$ `"on_track"`
         - `utilizationRatio <= 1.05` $\rightarrow$ `"tight"`
         - `utilizationRatio <= 1.40` $\rightarrow$ `"at_risk"`
         - `utilizationRatio > 1.40` $\rightarrow$ `"infeasible"`
4. **Deterministic Non-Mutating Adjustments (when `at_risk` or `infeasible`):**
   - `increase_daily_budget`: suggests `requiredDailyMinutes` (capped at 180 min/day).
   - `extend_deadline`: suggests `now + ceil(M_rem / (dailyMinutesBudget * 0.80))` days.
   - `narrow_scope`: lists optional `supplemental` sources or lowest-priority concepts that can be deferred.

---

## 4. Rust & TypeScript Interfaces

### Rust (`src-tauri/src/models/learning_goal.rs`)

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LearningGoalKind {
    Exploration,
    Retention,
    Mastery,
    Deadline,
    Skill,
    Continuous,
    Language,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LearningGoalStatus {
    Active,
    Paused,
    Completed,
    Archived,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalFeasibilityStatus {
    Unbounded,
    OnTrack,
    Tight,
    AtRisk,
    Infeasible,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalFeasibilityReport {
    pub goal_id: String,
    pub status: GoalFeasibilityStatus,
    pub remaining_minutes: i64,
    pub available_minutes: Option<i64>,
    pub days_remaining: Option<i64>,
    pub required_daily_minutes: Option<i64>,
    pub utilization_ratio: Option<f64>,
    pub progress_ratio: f64,
    pub prior_mastered_concept_count: i64,
    pub total_concept_count: i64,
    pub recommendations: Vec<GoalAdjustmentSuggestion>,
}
```

### TypeScript (`src/lib/learning-goals/types.ts`)

```ts
export type LearningGoalKind =
  | "exploration"
  | "retention"
  | "mastery"
  | "deadline"
  | "skill"
  | "continuous"
  | "language";

export type LearningGoalStatus = "active" | "paused" | "completed" | "archived";

export type GoalSourceKind =
  | "document"
  | "collection"
  | "saved_queue"
  | "study_plan"
  | "smart_feed"
  | "concept"
  | "tag";

export type GoalSourceRole = "primary" | "supplemental" | "exploration_candidate";

export type GoalFeasibilityStatus =
  | "unbounded"
  | "on_track"
  | "tight"
  | "at_risk"
  | "infeasible";

export interface LearningGoal {
  id: string;
  title: string;
  description: string | null;
  kind: LearningGoalKind;
  status: LearningGoalStatus;
  priority: number;
  studyPlanId: string | null;
  languageCode: string | null;
  targetDate: string | null;
  dailyMinutesBudget: number | null;
  targetDimensions: CompetencyDimension[];
  targetMasteryThreshold: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
```

---

## 5. Testing Strategy

1. **Migration Tests (`170_unified_learning_goals`):** Verify table creation, `CHECK` constraints (including `smart_feed` MUST have `source_role = 'exploration_candidate'`), `UNIQUE(goal_id, source_kind, source_id)`, `ON DELETE SET NULL` on `study_plan_id`, and `PRAGMA foreign_key_check`.
2. **Zero-Duplication & Evolution Tests (`learning_goal_repository.rs`):**
   - Attach one document and one concept to two different goals; delete Goal A and verify Goal B and the underlying document/concept remain intact.
   - Evolve an `exploration` goal into a `deadline` goal by attaching a `study_plan_id` and `target_date`; verify the goal ID and all prior source links remain unchanged and `goal_updated` is emitted to `learning_events`.
   - Verify existing `study_plans` bridge cleanly into `learning_goals` without modifying `study_plans` rows.
3. **Feasibility Parity Tests (`src/lib/learning-goals/__tests__/feasibility.parity.test.ts` + Rust tests):**
   - Verify `unbounded`, `on_track`, `tight`, `at_risk`, and `infeasible` classifications.
   - Verify already-demonstrated concepts from the 5D Learner Model reduce `remaining_minutes` to 0 for those concepts.
   - Verify non-mutating adjustment suggestions (`increase_daily_budget`, `extend_deadline`, `narrow_scope`).
4. **Privacy & Smart Feed Boundary Tests:** Verify `smart_feed` cannot be attached as `primary` (rejected by schema & repository) and never creates `learning_items`; verify `is_ai_excluded = 1` sources are omitted from AI-context goal summaries.
