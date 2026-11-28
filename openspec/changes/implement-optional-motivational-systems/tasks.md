# Tasks: Implement Optional Motivational Systems

## 1. Database Migration & Rust Repository
- [ ] Add `motivation_preferences`, `motivation_xp_ledger`, `motivation_milestones`, `reading_goals`, and `reading_goal_progress` tables (including `UNIQUE(source_event_id, rule_id)`) to `src-tauri/src/database/migrations/173_coach_and_motivation_systems.sql`.
- [ ] Implement `src-tauri/src/database/motivation_repository.rs` for preferences, reading goals/progress, idempotent XP ledger writes (`INSERT OR IGNORE`), and milestone grant/revocation queries.
- [ ] Add Rust unit tests verifying schema constraints, idempotent XP replay protection, and milestone revocation.

## 2. Rest-Day-Safe Streak, XP & Milestone Engines
- [ ] Implement `src-tauri/src/algorithms/motivation/streak.rs` supporting `rest_days_mask`, `streak_grace_days_per_week`, and timezone-safe local date rollups.
- [ ] Implement `src-tauri/src/algorithms/motivation/xp.rs` mapping canonical `learning_events` to bounded activity XP rules, strictly short-circuiting when `motivation_enabled = 0` or `xp_enabled = 0`.
- [ ] Implement `src-tauri/src/algorithms/motivation/milestones.rs` separating `activity`/`consistency` milestones from `mastery_outcome` milestones and wiring revocation on `competency_evidence` invalidation.
- [ ] Replace all `TODO` stubs in `src-tauri/src/commands/reading_goals.rs` with real SQLite repository calls while preserving backward-compatible command signatures.
- [ ] Expose unified motivation Tauri commands in `src-tauri/src/commands/motivation.rs` (`get_motivation_preferences`, `update_motivation_preferences`, `get_motivation_summary`, `list_motivation_milestones`, `process_learning_event_motivation`) and register them in `src-tauri/src/lib.rs`.

## 3. Frontend Store, UI & Activity-vs-Outcome Separation
- [ ] Implement `src/stores/motivationStore.ts` subscribing to canonical `learning_events` and respecting all independent feature toggles (`motivation_enabled`, `targets_enabled`, `streaks_enabled`, `xp_enabled`, `milestones_enabled`, `celebrations_enabled`).
- [ ] Update `src/components/dashboard/widgets/StreakGoalsWidget.tsx` and create `src/components/motivation/ActivityVsOutcomePanel.tsx` clearly separating effort/consistency metrics from verified mastery outcomes with neutral, non-coercive copy.
- [ ] Ensure disabling any toggle immediately hides its UI surface without deleting persisted SQLite history.

## 4. Settings UI & Settings Search Coverage
- [ ] Build `src/components/settings/MotivationSettingsPanel.tsx` with stable `searchId` targets (`motivation.section`, `motivation.enabled`, `motivation.targetsEnabled`, `motivation.dailyWeeklyTargets`, `motivation.streaksEnabled`, `motivation.restDays`, `motivation.streakGraceDays`, `motivation.xpEnabled`, `motivation.milestonesEnabled`, `motivation.celebrationsEnabled`).
- [ ] Register all Motivation settings in `src/components/settings/search/settingsSearchCatalog.ts` and `src/components/settings/search/settingsSearchCoverage.ts`, and add acceptance tests in `__tests__/settingsSearchCoverage.test.ts` and `__tests__/settingsSearch.test.ts`.

## 5. Verification
- [ ] Add Rust & TypeScript integration tests covering rest-day-safe streaks, XP idempotency under event replay, non-inflation of competency projections, evidence invalidation revoking mastery milestones, and `motivation_enabled = false` zero-overhead behavior.
- [ ] Run `npx tsc --noEmit`, `cd src-tauri && cargo test motivation reading_goals`, and `npx vitest run src/stores/motivationStore src/components/motivation src/components/settings`.
