# Tasks: Implement Personal Learning Coach

## 1. Database Migration & Rust Repository
- [ ] Create SQLite migration `src-tauri/src/database/migrations/173_coach_and_motivation_systems.sql` defining `coach_preferences`, `coach_recommendations`, and `coach_signal_dismissals` (coordinated with `implement-optional-motivational-systems`) and register it in `migrations/mod.rs`.
- [ ] Implement `src-tauri/src/database/coach_repository.rs` with typed CRUD for preferences, active/historical recommendations, snoozes, and dismissals, ensuring zero writes to canonical FSRS/goal/plan/competency tables.
- [ ] Add Rust unit tests covering migration `173` schema constraints, idempotent upserts, and dismissal cooldown queries.

## 2. Deterministic 12-Signal Opportunity Detector
- [ ] Implement `src-tauri/src/algorithms/coach/signals.rs` with pure evaluators for all 12 signal types (`review_backlog_overload`, `deadline_slippage_risk`, `mastery_gap_detected`, `leech_or_high_lapse_cluster`, `passive_reading_imbalance`, `prerequisite_readiness_block`, `stale_goal_momentum`, `remediation_loop_stall`, `cross_dimension_mismatch`, `session_fatigue_or_fragmentation`, `exploration_ready_for_structure`, `prior_evidence_skip_opportunity`).
- [ ] Implement `src-tauri/src/algorithms/coach/ranker.rs` for deterministic priority scoring, proactivity-level filtering (`disabled`, `on_demand`, `minimal`, `balanced`, `proactive`), quiet-hours suppression, and sequence-watermark memoization.
- [ ] Expose Tauri commands in `src-tauri/src/commands/coach.rs` (`get_coach_preferences`, `update_coach_preferences`, `evaluate_coach_opportunities`, `dismiss_coach_recommendation`, `snooze_coach_recommendation`, `mark_coach_recommendation_accepted`) and register them in `src-tauri/src/lib.rs`.
- [ ] Write deterministic Rust unit tests for every signal type, proactivity level, quiet-hours window, and `disabled` zero-query short-circuit.

## 3. AI-Optional Explanation & Non-Mutating Action Dispatcher
- [ ] Define `src/lib/coach/types.ts` and localized deterministic template renderers (`src/lib/coach/templates.ts` + i18n keys) covering all 12 signal types with zero AI dependency.
- [ ] Register the optional `coach.explainOpportunity` AI task in `src/lib/coach/explainTask.ts` using `src/lib/ai/tasks/runTask.ts` (`modelClass: "fast"`, strict JSON schema) gated by `enforceAssistantPrivacyAndConsent` (`src/lib/ai/assistant/privacyGate.ts`).
- [ ] Implement `src/lib/coach/actionDispatcher.ts` enforcing preview + explicit user confirmation before delegating any `CoachProposedAction` to owning domain services (DAQE, Goals, Study Plans, Remediation, Session Runtime).
- [ ] Implement `src/stores/coachStore.ts` subscribing to canonical `learning_events` watermarks and respecting `disabled`/`on_demand` proactivity levels.

## 4. UI Surfaces & Settings Search Coverage
- [ ] Build `src/components/coach/CoachCard.tsx`, `src/components/coach/CoachDrawer.tsx`, and `src/components/coach/CoachActionPreviewModal.tsx` with evidence citations, snooze/dismiss controls, and deterministic fallback badges.
- [ ] Mount Coach slots in Today (`DashboardTab`), post-session summary, Command Palette ("Ask Learning Coach"), and Study Mode footer (gated by proactivity level).
- [ ] Add `Learning Coach` Settings controls with stable `searchId`s (`coach.section`, `coach.proactivityLevel`, `coach.aiExplanations`, `coach.quietHours`, `coach.signalToggles`).
- [ ] Register all new Coach settings in `src/components/settings/search/settingsSearchCatalog.ts` and `src/components/settings/search/settingsSearchCoverage.ts`, and update `__tests__/settingsSearchCoverage.test.ts`.

## 5. Tests & Performance Benchmarks
- [ ] Add TypeScript unit and integration tests for `privacyGate` enforcement (`isLocalOnly`, `isAiExcluded`, `strictLocalOnly`), zero-AI operation, non-mutating confirmation flow, and `disabled` mode behavior.
- [ ] Add seeded Vitest benchmark `src/lib/coach/detector.bench.ts` using `seededRandom(seed)` from `src/test/bench-support.ts` verifying `< 50 ms` detection on 10,000 items / 50,000 events, and update `scripts/perf-baselines.json`.
- [ ] Run `npx tsc --noEmit`, `cd src-tauri && cargo test coach`, `npx vitest run src/lib/coach src/components/coach src/components/settings`, and `npm run bench:check`.
