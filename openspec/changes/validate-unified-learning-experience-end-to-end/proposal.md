# Proposal: Validate Unified Learning Experience End-to-End

## Why

Transforming Plethora into a unified Personal Learning Operating System spans canonical learning events, a 5-dimension persistent learner model, unified Learning Goals and adaptive curricula, a shared resumable Learning Activity Runtime, extended heterogeneous DAQE orchestration, consolidated navigation and Today workspace, an extensible 13-type activity registry, a deterministic Personal Learning Coach, and optional motivational systems. Individually passing unit tests cannot guarantee that these layers interact safely without regressions to FSRS-7 scheduling, single-surface Study Mode, privacy/local-only isolation, offline/no-AI operation, existing user migrations, or large-library performance.

This cross-cutting validation change establishes an automated end-to-end test harness, realistic persona & failure-mode scenario suite (**Scenarios A through O**), deterministic large-library benchmarks, and release verification gates covering the entire unified learning experience before release.

## What Changes

- **Automated End-to-End Scenario Suite (Scenarios A–O):** Build deterministic Rust integration tests and TypeScript/Vitest/Playwright E2E tests covering all 15 normative user personas, cross-layer invariants, privacy boundaries, crash recovery, migration, and disabled-feature guarantees.
- **Large-Library Performance Benchmark Suite (Scenario M):** Add seeded Vitest benchmarks (`src/lib/unified-learning/*.bench.ts` using `seededRandom(seed)` from `src/test/bench-support.ts`) measuring DAQE heterogeneous ranking (`< 150 ms` top-10), Coach 12-signal detection (`< 50 ms`), Today workspace hydration, and Competency recomputation on 10,000+ items and 50,000+ `learning_events`, integrated into `npm run bench:check` and `scripts/perf-baselines.json`.
- **Cross-Platform & Privacy Verification Harness:** Automate verification of no-AI operation (Scenario I), `isLocalOnly`/`isAiExcluded`/`strictLocalOnly` and Health Vault isolation (Scenario J), and Settings Search coverage across all newly added Coach and Motivation controls.
- **Release Gate Checklist & Verification Report:** Consolidate `npx tsc --noEmit`, `cargo test`, Vitest unified learning suites, `npm run bench:check`, `npm run check:bundle`, Settings Search gates, and `openspec validate --strict` into a reproducible verification runner.

## Capabilities

### New Capabilities

- `unified-learning-e2e-validation`: Automated end-to-end scenario verification (Scenarios A–O), seeded large-library performance benchmarks, migration/recovery tests, and cross-cutting privacy and disabled-mode regression gates.

### Modified Capabilities

- None (validates and asserts contracts across all Phase 1–4 unified learning capabilities without altering production domain semantics).

## Dependencies

- Phase 1–3 Unified Learning OS changes (`unify-learning-state-and-events`, `establish-persistent-learner-model`, `unify-learning-goals-and-study-plans`, `unify-learning-activity-runtime`, `extend-daqe-learning-orchestration`, `unify-assessment-evidence-and-remediation`, `implement-competency-based-adaptive-curricula`, `consolidate-learning-navigation-and-workspaces`, `redesign-today-learning-dashboard`)
- Phase 4 changes (`implement-personal-learning-coach`, `extend-learning-activity-types`, `implement-optional-motivational-systems`)
- Existing benchmark harness (`src/test/bench-support.ts`, `scripts/perf-baselines.json`, `scripts/bundle-budgets.json`)

## Non-Goals

- Adding new user-facing product features or UI surfaces beyond test fixtures, harnesses, and verification scripts.
- Claiming empirical randomized-controlled-trial (RCT) pedagogical efficacy; this suite validates deterministic software correctness, UX coherence, privacy, and performance invariants.
- Relying on live external cloud AI endpoints or network access in automated CI/local test runs (all AI paths are tested with deterministic mocks and explicit no-provider configurations).

## Privacy & Security

- Scenario J explicitly verifies that `isLocalOnly` and `isAiExcluded` documents never leak to cloud AI providers, untrusted activity extensions, or E2EE Sync v2 outbox payloads, and that raw `health/health.db` records remain physically isolated from all learning services.
- Test fixtures use strictly synthetic seeded data (`seededRandom(seed)`) with zero real user data or credentials.

## Migration & Backward Compatibility

- Scenario L snapshots a realistic pre-upgrade v3.14.1 SQLite database (with `review_results`, FSRS-7 memory states, `study_plans`, `exam_grades`, and legacy `localStorage` `knowledgeGraphStore`/`knowledgeHealthStore` entries) and verifies non-destructive forward migration through migration `173_coach_and_motivation_systems` with 100% data preservation.

## Performance

- Scenario M enforces concrete performance budgets via `npm run bench:check`:
  - DAQE heterogeneous top-10 ranking: `< 150 ms` on 10,000 items.
  - Personal Learning Coach 12-signal detector: `< 50 ms` on 10,000 items / 50,000 events.
  - Activity Registry capability negotiation: `< 2 ms`.
  - Bundle size deltas remain within `scripts/bundle-budgets.json` via `npm run check:bundle`.

## Rollback / Recovery

- Scenario K verifies interrupted session crash/reload recovery with zero duplicate `learning_events`, zero duplicate FSRS-7 reviews, and zero duplicate XP ledger entries.
- Scenario N verifies that disabling coaching and gamification cleanly hides all surfaces and halts background processing without deleting historical records.

## Impact

- **Test Suites:** `src/test/e2e/unified-learning/` (Scenarios A–O integration & UI suites), `src-tauri/tests/unified_learning_e2e.rs` (Rust SQLite migration, concurrency, privacy, evidence invalidation, and streak/XP idempotency tests).
- **Benchmarks & Baselines:** `src/lib/unified-learning/largeLibrary.bench.ts`, `scripts/perf-baselines.json`, `scripts/bundle-budgets.json`.
- **Verification Script / Docs:** `scripts/verify-unified-learning.mjs` (or npm script) and verification report artifact.
