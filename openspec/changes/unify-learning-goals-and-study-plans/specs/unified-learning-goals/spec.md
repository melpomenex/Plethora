# Unified Learning Goals Specification

## ADDED Requirements

### Requirement: Composable Unified Learning Goals Persistence
The system SHALL persist composable learning goals in `learning_goals`, many-to-many source links in `learning_goal_sources`, and optional checkpoints in `learning_goal_milestones` via migration `170_unified_learning_goals`, supporting `exploration`, `retention`, `mastery`, `deadline`, `skill`, `continuous`, and `language` goals with optional attachment to existing `study_plans`.

#### Scenario: Existing Study Plan bridges seamlessly into a Learning Goal
- **GIVEN** an existing `study_plans` row `plan-42` created prior to migration `170_unified_learning_goals`
- **WHEN** the learner opens or lists unified Learning Goals
- **THEN** `plan-42` MUST be representable as a `learning_goals` record linked via `study_plan_id = "plan-42"`
- **AND** all existing `study_plans`, `study_plan_versions`, and `study_plan_nodes` rows MUST remain unmodified

#### Scenario: Goal evolves in-place from exploration to deadline mastery
- **GIVEN** an active `exploration` goal `goal-1` linked to three documents and two concepts
- **WHEN** the learner evolves `goal-1` to `kind = "deadline"`, attaches `study_plan_id = "plan-99"`, and sets `target_date` and `daily_minutes_budget`
- **THEN** `goal-1` MUST retain its original `id` and all existing `learning_goal_sources` rows
- **AND** a `goal_updated` event MUST be appended transactionally to `learning_events`

### Requirement: Zero-Duplication Multi-Goal Sharing and Smart Feed Boundary
The system SHALL allow any document, collection, saved queue, concept, or tag to be linked to multiple `learning_goals` without duplicating underlying entities, and SHALL enforce that `smart_feed` sources attach exclusively with `source_role = "exploration_candidate"` and never auto-create SRS review obligations.

#### Scenario: Deleting one goal preserves shared sources and other goals
- **GIVEN** document `doc-7` and concept `c-7` are linked to both `goal-A` and `goal-B`
- **WHEN** `goal-A` is deleted
- **THEN** `goal-A`'s rows in `learning_goal_sources` MUST cascade delete
- **AND** `doc-7`, `c-7`, and `goal-B`'s source links MUST remain completely intact

#### Scenario: Smart Feed attaches only as an exploration candidate
- **GIVEN** an active `continuous` goal `goal-feed` and a Smart Feed `sf-1`
- **WHEN** `sf-1` is linked to `goal-feed`
- **THEN** the link MUST only be accepted when `source_role = "exploration_candidate"` (rejecting `"primary"` or `"supplemental"`)
- **AND** linking `sf-1` MUST NOT auto-create any `learning_items` or FSRS-7 review schedules

### Requirement: Competency-Aware Progress and Deterministic Deadline Feasibility
The system SHALL compute goal progress and deadline feasibility deterministically from the 5-dimension `competency_projections` (reusing prior demonstrated evidence), remaining primary reading workload, and read-only FSRS-7 due forecasts, classifying feasibility as `unbounded`, `on_track`, `tight`, `at_risk`, or `infeasible` with non-mutating adjustment suggestions.

#### Scenario: Prior demonstrated competency reduces remaining goal effort
- **GIVEN** a `mastery` goal `goal-2` targeting concepts `c-1` and `c-2` on `comprehension` and `retention`
- **AND** the Persistent Learner Model already records `c-1` as `status = "demonstrated"` above `target_mastery_threshold` on both dimensions
- **WHEN** goal progress and feasibility are evaluated for `goal-2`
- **THEN** `c-1` MUST contribute `0` remaining concept minutes and increment `prior_mastered_concept_count`
- **AND** remaining effort MUST reflect only `c-2` and uncompleted reading/review workload

#### Scenario: Infeasible deadline produces non-mutating adjustment recommendations
- **GIVEN** a `deadline` goal `goal-3` with `remaining_minutes = 600`, `days_remaining = 5`, and `daily_minutes_budget = 30` (`available_minutes = 150`)
- **WHEN** deadline feasibility is evaluated
- **THEN** `status` MUST be `"infeasible"` with `required_daily_minutes = 120`
- **AND** `recommendations` MUST include non-mutating `increase_daily_budget` and `extend_deadline` suggestions without altering any FSRS-7 schedules or dropping sources

#### Scenario: Exploration goal without target date reports unbounded feasibility
- **GIVEN** an `exploration` goal `goal-4` with `target_date = null`
- **WHEN** feasibility is evaluated
- **THEN** `status` MUST be `"unbounded"` and `required_daily_minutes` MUST be `null`

### Requirement: Zero-Goal Freedom and Privacy Isolation
The system SHALL allow learners to read documents, create extracts, and review flashcards without creating any Learning Goal, SHALL exclude `is_ai_excluded = 1` sources from cloud AI goal summaries, and SHALL maintain complete isolation from `health/health.db`.

#### Scenario: Casual learner operates with zero goals
- **GIVEN** a library with zero rows in `learning_goals`
- **WHEN** the learner reads a document or completes FSRS-7 reviews
- **THEN** all reading, extraction, and review workflows MUST operate normally with zero forced goal-creation prompts

#### Scenario: AI-excluded sources are omitted from cloud AI goal context
- **GIVEN** `goal-priv` links both a normal document `doc-pub` and an `is_ai_excluded = 1` document `doc-priv`
- **WHEN** a cloud AI context builder requests a summary of `goal-priv`
- **THEN** `doc-priv` MUST be omitted from the AI-visible source list while remaining visible in local UI views
