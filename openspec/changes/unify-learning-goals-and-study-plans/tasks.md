# Tasks: Unify Learning Goals and Study Plans

## 1. Database Schema & Models
- [ ] Add migration `170_unified_learning_goals` to `src-tauri/src/database/migrations.rs` creating `learning_goals`, `learning_goal_sources`, `learning_goal_milestones`, and their indexes and `CHECK` constraints.
- [ ] Create `src-tauri/src/models/learning_goal.rs` with `LearningGoal`, `LearningGoalKind`, `LearningGoalStatus`, `LearningGoalSource`, `GoalSourceKind`, `GoalSourceRole`, `LearningGoalMilestone`, `GoalFeasibilityReport`, and `GoalAdjustmentSuggestion`.
- [ ] Add Rust migration tests verifying `170_unified_learning_goals` constraints (including `smart_feed` -> `exploration_candidate`), `ON DELETE SET NULL` for `study_plan_id`, cascade deletion of `learning_goal_sources`, and `PRAGMA foreign_key_check`.

## 2. Repository, Study Plan Bridge & Feasibility Engine (Rust + TS Parity)
- [ ] Create `src-tauri/src/database/learning_goal_repository.rs` implementing CRUD, `link_goal_source`, `unlink_goal_source`, `evolve_learning_goal`, `ensure_goal_for_study_plan`, milestone management, and transactional emission of `goal_created` / `goal_updated` / `goal_completed` to `learning_events`.
- [ ] Implement deterministic competency-aware progress and deadline feasibility (`evaluate_goal_feasibility`) in `learning_goal_repository.rs` reading `competency_projections` and read-only FSRS-7 due forecasts.
- [ ] Implement matching pure TypeScript types and feasibility engine in `src/lib/learning-goals/types.ts` and `src/lib/learning-goals/feasibility.ts`.
- [ ] Add privacy-filtered source projection (`ai_context: bool`) so `is_ai_excluded = 1` sources are omitted from cloud AI goal summaries.
- [ ] Add Tauri commands in `src-tauri/src/commands/learning_goals.rs` (`create_learning_goal`, `update_learning_goal`, `evolve_learning_goal`, `list_learning_goals`, `get_learning_goal_detail`, `link_learning_goal_source`, `unlink_learning_goal_source`, `get_learning_goal_feasibility`, `delete_learning_goal`) and register them in `src-tauri/src/lib.rs`.

## 3. Frontend API & Store Integration
- [ ] Create `src/api/learning-goals.ts` (Tauri invoke + PWA/test local fallback) and `src/stores/learningGoalsStore.ts` subscribed to `learningEventBus` updates.
- [ ] Ensure existing Study Plans created or published via `study_plan_repository.rs` automatically bridge to `learning_goals` without altering `study_plans` IDs or CAS workflows.

## 4. Verification & Parity Testing
- [ ] Add Rust unit tests in `learning_goal_repository.rs` covering multi-goal zero-duplication sharing, goal evolution, `smart_feed` constraint enforcement, prior-evidence workload reduction, infeasible deadline recommendations, and `ai_context` privacy filtering.
- [ ] Add Vitest parity tests in `src/lib/learning-goals/__tests__/feasibility.parity.test.ts` validating Rust/TS feasibility equivalence across `unbounded`, `on_track`, `tight`, `at_risk`, and `infeasible` cases.
- [ ] Run `npx tsc --noEmit`, `npx vitest run src/lib/learning-goals/`, and `cd src-tauri && cargo test --lib learning_goal` to verify all checks pass.
