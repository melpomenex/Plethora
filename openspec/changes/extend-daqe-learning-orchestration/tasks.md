# Tasks: Extend DAQE Learning Orchestration

## 1. Backend Orchestration Core & Candidate Providers
- [ ] Extend `src-tauri/src/models/daqe.rs` with `SessionFocusProfile`, `OrchestrationBreakdown`, `ActivityExplanation`, `OverloadAdvisory`, and `OrchestratedSessionPlan` types while keeping existing `DaqeKnobs` and `QueueSnapshot` backward-compatible.
- [ ] Implement bounded candidate providers in `src-tauri/src/algorithms/daqe/providers.rs` for `srs_due_pool`, `learning_goals`, `guided_trails`, `remediation`, `exam_prep`, and optional `smart_feeds` with `dedupeKey` normalization and graceful provider-error isolation.
- [ ] Implement the six Session Focus Profiles (`balanced`, `free_exploration`, `memory_retention`, `exam_prep`, `deep_study`, `custom`) and normalized factor weight tables in `src-tauri/src/algorithms/daqe/profiles.rs`.
- [ ] Implement pure deterministic orchestration scoring, `StrictManual` bypass, and `TermValue::unavailable()` renormalization in `src-tauri/src/algorithms/daqe/orchestrator.rs`.

## 2. Time Budgeting, Overload Advisor & Deterministic Explainability
- [ ] Implement time-budget packing (`5..=120` minutes and `unlimited`) with overflow annotation and interleaving diversity in `src-tauri/src/algorithms/daqe/budget.rs`.
- [ ] Implement pure `evaluate_overload` and deadline-vs-retention balancing in `src-tauri/src/algorithms/daqe/overload.rs` without mutating any FSRS-7 state.
- [ ] Implement deterministic `ActivityExplanation` builder in `src-tauri/src/algorithms/daqe/explain.rs` deriving `primaryReason` and factor rows strictly from `OrchestrationBreakdown`.

## 3. Persistence, Privacy & Tauri Command Surface
- [ ] Add additive SQLite persistence for custom focus profile presets and default time budget preferences, enforcing zero `health/health.db` access.
- [ ] Add `orchestrate_learning_session` and `get_daqe_session_profiles` Tauri commands in `src-tauri/src/commands/queue_daqe.rs` (preserving existing `rank_queue` and `rank_queue_with_decision`), ensuring `is_local_only` and `is_ai_excluded` items never leave the device in optional remote decision-model passes.
- [ ] Extend `src/stores/daqeRankingClient.ts` and `src/stores/queueStore.ts` with typed client wrappers, local TS fallback for PWA/Vitest, and profile/budget state management.

## 4. Explainability UI & Settings Search Coverage
- [ ] Implement reusable `"Why am I seeing this?"` deterministic explanation popover (`src/components/daqe/WhyAmISeeingThisPopover.tsx`) and `OverloadAdvisorBanner.tsx` consuming `ActivityExplanation` and `OverloadAdvisory`.
- [ ] Register DAQE session focus profile default and default time budget controls with stable `searchId`s in `src/components/settings/search/settingsSearchCatalog.ts` and `src/components/settings/search/settingsSearchCoverage.ts`, plus Settings search tests.

## 5. Tests & Performance Benchmarks
- [ ] Add Rust unit tests verifying byte-identical determinism, `StrictManual` vs `Adaptive` parity, all 6 focus profiles, 5–120m/unlimited budget packing, overload advisories, `TermValue::unavailable()` honesty, and 150 ms top-10 latency on a 5,000-item pool.
- [ ] Add Vitest tests for `daqeRankingClient`, `WhyAmISeeingThisPopover`, `OverloadAdvisorBanner`, and `is_local_only`/`is_ai_excluded` remote-pass filtering.
- [ ] Add `src/lib/daqe/orchestration.bench.ts` using `seededRandom` from `src/test/bench-support.ts`, update `scripts/perf-baselines.json`, and run `npm run bench:check`, `npx tsc --noEmit`, and `cd src-tauri && cargo test --lib daqe`.
