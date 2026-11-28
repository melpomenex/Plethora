# Proposal: Unify Learning Goals and Study Plans

## Why

Plethora currently supports rich, versioned, source-grounded `study_plans` (`study_plan_repository.rs`), but `study_plans` are rigidly coupled to structured multi-node curricula, while `reading_goals.rs` consists of unimplemented `TODO` stubs. Meanwhile, real learners pursue a wide spectrum of overlapping learning intentions:

1. **Diverse goal shapes:** Casual topic exploration, long-term FSRS retention of a book or deck, deep mastery of a technical subject, exam/project deadline preparation, practical skill building, continuous awareness via Smart Feeds, and language acquisition.
2. **Rigid separation:** Today, a learner exploring a folder of PDFs or following a Smart Feed cannot smoothly promote that interest into a structured Study Plan with a deadline without starting over or duplicating materials.
3. **No shared feasibility or progress lens:** There is no unified, competency-aware way to ask "Given my current 5D learner model and daily time budget, is my deadline realistic?" or to share a single document/concept/flashcard across multiple goals without duplicating records.

Unifying all learning intentions under a composable `learning_goals` layer—where `study_plans` acts as an optional structured curriculum attached to a goal—gives DAQE, the Today dashboard, adaptive curricula, and the personal coach one coherent goal abstraction while preserving 100% of existing `study_plans` functionality.

## What Changes

1. **SQLite Migration `170_unified_learning_goals`:**
   - Adds `learning_goals` table supporting seven first-class goal kinds (`exploration`, `retention`, `mastery`, `deadline`, `skill`, `continuous`, `language`), lifecycle states (`active`, `paused`, `completed`, `archived`), priority, optional `target_date`, optional `daily_minutes_budget`, optional `study_plan_id` (`REFERENCES study_plans(id) ON DELETE SET NULL`), optional `language_code`, and `target_competency_json`.
   - Adds `learning_goal_sources` join table linking goals to existing library entities (`document`, `collection`, `saved_queue`, `study_plan`, `smart_feed`, `concept`, `tag`) with `source_role` (`primary`, `supplemental`, `exploration_candidate`)—enabling zero-duplication many-to-many sharing across goals.
   - Adds `learning_goal_milestones` table for optional learner-defined or plan-derived checkpoints.
   - Preserves all existing `study_plans`, `study_plan_versions`, `study_plan_nodes`, and `study_plan_prerequisites` rows and IDs untouched.
2. **Goal Composability, Evolution & Zero-Duplication Sharing:**
   - Adds `src-tauri/src/database/learning_goal_repository.rs` and `src-tauri/src/models/learning_goal.rs`, integrating with `study_plan_repository.rs` so existing Study Plans automatically surface as `learning_goals` (via idempotent non-destructive linking) and any lightweight goal can evolve in-place (e.g., `exploration` $\rightarrow$ `mastery` $\rightarrow$ `deadline`) by attaching a `study_plan_id` or `target_date` without losing its ID, sources, or history.
   - Smart Feeds attach strictly with `source_role = 'exploration_candidate'` and NEVER auto-create SRS flashcards or mandatory review obligations.
3. **Deterministic Deadline Feasibility & Competency-Aware Progress (Rust + TS Parity):**
   - Implements a pure deterministic feasibility and progress engine (`src/lib/learning-goals/feasibility.ts` + Rust parity in `learning_goal_repository.rs`) that reads the learner's 5D `competency_projections` (reusing prior demonstrated evidence), estimates remaining effort in minutes, compares against `(days_remaining * daily_minutes_budget)`, and classifies feasibility (`on_track`, `tight`, `at_risk`, `infeasible`, `unbounded`) with explicit, non-mutating adjustment recommendations.
4. **Canonical Event Emission & Tauri Commands:**
   - Emits `goal_created`, `goal_updated`, and `goal_completed` into `learning_events` transactionally.
   - Exposes Tauri commands in `src-tauri/src/commands/learning_goals.rs` and TypeScript client in `src/api/learning-goals.ts`.

## Capabilities

### New Capabilities
- `unified-learning-goals`: Composable `learning_goals` spanning exploration, retention, mastery, deadline, skill, continuous, and language learning; optional `study_plans` curriculum attachment; zero-duplication multi-goal source sharing; in-place goal evolution; and deterministic competency-aware deadline feasibility.

### Modified Capabilities
- None (all existing `study_plan_repository.rs` commands, CAS revision locks, draft/publish workflows, and IDs remain intact and backward compatible).

## Dependencies

- **Upstream:** `unify-learning-state-and-events` (`learning_events`), `establish-persistent-learner-model` (`competency_projections`).
- **Downstream Consumers:** `unify-learning-activity-runtime`, `extend-daqe-learning-orchestration`, `redesign-today-learning-dashboard`, `implement-competency-based-adaptive-curricula`, `implement-personal-learning-coach`, `implement-optional-motivational-systems`.

## Non-Goals

- Replacing or rewriting `study_plan_repository.rs` draft/publish CAS workflows, Sugiyama DAG layout, or source-grounding validation.
- Forcing casual readers to create a Learning Goal before reading or reviewing (zero-goal usage remains first-class).
- Auto-creating FSRS-7 flashcards from Smart Feeds or `exploration` goals without explicit user action.
- Replacing FSRS-7 item scheduling with deadline cramming (deadline urgency influences DAQE *selection* in Phase 2, never corrupts FSRS-7 stability math).
- Reading or storing Health Vault (`health/health.db`) data.

## Privacy & Security

- **Local-Only & AI-Excluded Respect:** `learning_goal_sources` references source entities by ID only. When computing goal summaries or feasibility for cloud AI contexts, any source document with `is_ai_excluded = 1` is omitted from AI prompts and text snippets. Goals linked to `is_local_only = 1` documents are flagged locally so private document metadata never leaks into `sync_outbox`.
- **Health Vault Isolation:** Zero foreign keys or data dependencies on `health/health.db`.

## Migration & Backward Compatibility

- Migration `170_unified_learning_goals` is purely additive (`CREATE TABLE IF NOT EXISTS`) and executes transactionally after `169_persistent_learner_model`.
- Existing `study_plans` rows remain untouched; a non-destructive idempotent bridge ensures every active `study_plan` can be resolved as a `learning_goal` with `study_plan_id = study_plans.id` without altering `study_plans` primary keys or version history.

## Performance

- Goal list and progress queries join indexed `learning_goal_sources` and pre-computed `competency_projections` without full-table scans over `learning_events`, completing in < 5 ms for 50 active goals across 10,000+ concepts.
- Deadline feasibility calculation is a pure $O(N)$ pass over a goal's linked concepts/nodes/due workload (< 1 ms).

## Rollback / Recovery

- Because `170_unified_learning_goals` is strictly additive and `study_plans` retains its own schema and lifecycle (`ON DELETE SET NULL`), reverting or disabling the unified goals UI leaves all Study Plans, documents, collections, and Smart Feeds completely intact.

## Impact

- **Database:** `src-tauri/src/database/migrations.rs` (migration `170_unified_learning_goals`), new `src-tauri/src/database/learning_goal_repository.rs`, `src-tauri/src/models/learning_goal.rs`, bridge hook in `study_plan_repository.rs`.
- **Backend Commands:** `src-tauri/src/commands/learning_goals.rs` registered in `src-tauri/src/lib.rs`.
- **Frontend:** `src/lib/learning-goals/types.ts`, `src/lib/learning-goals/feasibility.ts`, `src/api/learning-goals.ts`, `src/stores/learningGoalsStore.ts`.
