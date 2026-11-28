# Proposal: Implement Optional Motivational Systems

## Why

The architectural audit (`docs/architecture/unified-learning-os-audit.md`) identified that `src-tauri/src/commands/reading_goals.rs` currently consists of unimplemented `TODO` stubs returning empty values or `"Not implemented"` errors, leaving daily/weekly reading targets, streaks, and achievements non-functional. At the same time, many serious learners actively reject punitive streaks, dark-pattern gamification, or conflating "XP earned" with actual conceptual mastery.

This change replaces those stubs with a clean, SQLite-backed, **strictly optional** motivational system that supports humane rest-day-safe streaks, daily/weekly activity targets, idempotent event-sourced XP, and distinct mastery-outcome milestones — while keeping every single motivational feature independently disableable and strictly separating activity/effort metrics from verified mastery outcomes.

## What Changes

- **Persistent Motivation Schema (Migration `173_coach_and_motivation_systems`):** Add `motivation_preferences`, `motivation_xp_ledger`, `motivation_milestones`, and `reading_goals` / `reading_goal_progress` tables (coordinated in shared SQLite migration `173_coach_and_motivation_systems.sql` with `implement-personal-learning-coach`).
- **Replace Stubbed `reading_goals.rs` Commands:** Implement real SQLite-backed persistence for `create_reading_goal`, `get_active_reading_goal`, `update_reading_goal`, `get_goal_progress`, `update_goal_progress`, `get_reading_streak`, `get_achievements`, and `check_and_unlock_achievements`, plus new unified motivation preference/XP/milestone commands.
- **Rest-Day-Safe Streaks:** Support configurable planned rest days (`rest_days_mask`) and automatic grace days so learners can take scheduled breaks without punitive streak resets or guilt messaging.
- **Idempotent XP Ledger Separated from Mastery:** Compute optional XP exclusively from canonical `learning_events` via an append-only ledger with `UNIQUE(source_event_id, rule_id)` so event replays, session recovery, or sync merges never double-award XP. Activity XP NEVER mutates or inflates `competency_projections` or mastery scores.
- **Independent Disableability & Settings Search Coverage:** Provide independent toggles for master motivation, daily/weekly targets, streaks, XP, milestones, and celebration animations, and register every setting in `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`.

## Capabilities

### New Capabilities

- `optional-motivational-systems`: Opt-in, independently disableable daily/weekly targets, rest-day-safe streaks, idempotent XP ledger, and activity-vs-mastery-separated milestones backed by SQLite migration `173_coach_and_motivation_systems`.

### Modified Capabilities

- None (replaces unimplemented `TODO` stubs in `src-tauri/src/commands/reading_goals.rs` with backward-compatible signatures and consumes canonical `learning_events` read-only).

## Dependencies

- `unify-learning-state-and-events` (canonical `learning_events` with stable `event_id` for idempotent XP)
- `establish-persistent-learner-model` (verified `competency_projections` & `competency_evidence` for mastery-outcome milestones and invalidation)
- `redesign-today-learning-dashboard` (optional motivation summary widget slot)
- Shared SQLite migration `173_coach_and_motivation_systems` (coordinated with `implement-personal-learning-coach`)

## Non-Goals

- Public leaderboards, social pressure mechanics, loot boxes, countdown FOMO popups, or guilt-inducing copy ("You broke your streak!").
- Allowing XP, streak length, or time-spent metrics to count as competency evidence or inflate FSRS/mastery scores.
- Mandatory telemetry or cloud-side behavioral tracking.

## Privacy & Security

- All motivation preferences, targets, XP ledger entries, and milestones are stored locally in SQLite and respect existing E2EE Sync v2 policies (syncing only aggregate/ledger records, never raw `isLocalOnly` document content).
- Zero behavioral surveillance or third-party analytics events are emitted.
- Settings Search catalog entries never index user-authored goal notes or private values (`docs/settings-search.md`).

## Migration & Backward Compatibility

- Additive SQLite migration `173_coach_and_motivation_systems` creates the motivation and reading-goal tables without altering any existing tables.
- Existing `src-tauri/src/commands/reading_goals.rs` command names and return types (`ReadingGoal`, `GoalProgress`, `ReadingStreak`, `Achievement`) remain backward-compatible so existing widgets (`StreakGoalsWidget.tsx`) immediately gain real persistence.
- Disabling any or all motivational toggles hides UI surfaces and halts ledger writes without deleting historical records.

## Performance

- XP ledger ingestion is O(1) per canonical `learning_events` row using `INSERT OR IGNORE` on the `UNIQUE(source_event_id, rule_id)` index.
- Rest-day-safe streak calculation queries a bounded indexed date-rollup view (`< 5 ms` even with 50,000+ `learning_events`).
- When `motivation_enabled = 0`, zero streak calculations, XP ledger inserts, or milestone checks run on event ingestion.

## Rollback / Recovery

- Toggling `motivation_enabled = false` immediately hides all motivational UI and halts background XP/streak processing while preserving history.
- Because the XP ledger and milestones are derived projections of `learning_events` and `competency_projections`, the ledger can be deterministically recomputed or truncated without affecting any learning content, FSRS schedules, or learner competency data.

## Impact

- **Backend (Rust/Tauri):** `src-tauri/src/database/migrations/173_coach_and_motivation_systems.sql`, `src-tauri/src/database/motivation_repository.rs`, `src-tauri/src/algorithms/motivation/` (rest-day-safe streak calculator, idempotent XP rules, milestone evaluator), `src-tauri/src/commands/reading_goals.rs` (replacing `TODO` stubs), `src-tauri/src/commands/motivation.rs`.
- **Frontend (React/TS):** `src/stores/motivationStore.ts`, `src/components/motivation/` (MotivationSummaryCard, ActivityVsOutcomePanel, MotivationSettingsPanel), `src/components/dashboard/widgets/StreakGoalsWidget.tsx`.
- **Settings Search:** `src/components/settings/search/settingsSearchCatalog.ts`, `src/components/settings/search/settingsSearchCoverage.ts`, and Settings search tests.
