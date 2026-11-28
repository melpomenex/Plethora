# Optional Motivational Systems Specification

## ADDED Requirements

### Requirement: Persistent Reading Goals and Motivation Schema
Plethora SHALL replace all `TODO` stubs in `src-tauri/src/commands/reading_goals.rs` with SQLite-backed persistence (`reading_goals`, `reading_goal_progress`, `motivation_preferences`, `motivation_xp_ledger`, `motivation_milestones`) via migration `173_coach_and_motivation_systems`.

#### Scenario: Creating and updating a daily reading goal persists across restarts
- **GIVEN** a user creates a `daily_minutes` goal with `target_value = 30` via `create_reading_goal`
- **WHEN** the user logs 30 minutes of progress via `update_goal_progress` and restarts the application
- **THEN** `get_active_reading_goal` and `get_goal_progress` return the persisted goal and `is_completed = true` from SQLite.

### Requirement: Rest-Day-Safe Streaks
Streak calculations SHALL honor user-configured planned rest days (`rest_days_mask`) and weekly grace days (`streak_grace_days_per_week`) so scheduled breaks or occasional missed days do not punitively reset a learner's streak.

#### Scenario: Planned weekend rest days preserve streak continuity
- **GIVEN** a learner has configured Saturday and Sunday in `rest_days_mask` and completed learning activity on Friday and Monday
- **WHEN** `get_reading_streak` evaluates the learner's streak on Monday
- **THEN** the streak continues unbroken across the weekend without penalizing the planned rest days.

#### Scenario: Weekly grace day absorbs one unplanned missed day
- **GIVEN** `streak_grace_days_per_week = 1` and the learner was active Monday, Tuesday, and Thursday (missing Wednesday)
- **WHEN** `get_reading_streak` evaluates on Thursday
- **THEN** Wednesday is bridged using the grace day and the streak remains intact.

### Requirement: Idempotent Event-Sourced XP Strictly Separated from Mastery
Optional XP SHALL be derived idempotently from canonical `learning_events` using a `UNIQUE(source_event_id, rule_id)` ledger constraint, and XP, streaks, and activity minutes SHALL NEVER alter or inflate `competency_projections` or mastery levels.

#### Scenario: Replaying canonical learning events does not double-award XP
- **GIVEN** `xp_enabled` is true and a canonical `learning_events` row with `event_id = "evt-42"` has already awarded XP
- **WHEN** `"evt-42"` is replayed during interrupted session recovery or cross-device sync
- **THEN** `motivation_xp_ledger` retains exactly one row for `("evt-42", rule_id)` and the learner's XP total does not increase.

#### Scenario: Earning XP or maintaining a streak does not inflate concept mastery
- **GIVEN** a learner accumulates 500 XP and a 14-day streak through passive reading events on a concept without passing comprehension or application checks
- **WHEN** `competency_projections` is queried for that concept
- **THEN** `comprehension`, `application`, and `transfer` dimensions remain unaffected by XP or streak counts.

#### Scenario: Evidence invalidation revokes mastery milestones while preserving activity XP
- **GIVEN** a learner earned both activity XP and a `mastery_outcome` milestone from an examination
- **WHEN** the exam grade is regraded downward and the underlying `competency_evidence` is invalidated
- **THEN** the affected `mastery_outcome` milestone is marked with `revoked_at`, while the activity XP ledger entry remains unchanged.

### Requirement: Independent Disableability and Settings Search Coverage
Every motivational component (`motivation_enabled`, `targets_enabled`, `streaks_enabled`, `xp_enabled`, `milestones_enabled`, `celebrations_enabled`) SHALL be independently disableable with zero background processing when globally disabled, and every motivation setting SHALL be registered in `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`.

#### Scenario: Disabling gamification hides surfaces and halts XP computation non-destructively
- **GIVEN** a user has existing XP ledger entries and milestones and disables `motivation_enabled` in Settings
- **WHEN** the user completes subsequent learning sessions
- **THEN** all motivation/streak/XP UI surfaces are hidden, zero new `motivation_xp_ledger` rows are written, and prior ledger/milestone history remains preserved in SQLite.

#### Scenario: Searching for streaks or rest days in Settings navigates to the Motivation controls
- **GIVEN** the user opens Settings and searches for "rest days" or "streaks"
- **THEN** Settings Search displays the corresponding localized Motivation controls and focuses `motivation.restDays` or `motivation.streaksEnabled` without altering their values.
