# Tasks: Validate Unified Learning Experience End-to-End

## 1. Deterministic Fixture & Snapshot Infrastructure
- [ ] Build a deterministic seeded test fixture generator (`src/test/e2e/unified-learning/fixtures.ts`) using `seededRandom(seed)` from `src/test/bench-support.ts` capable of producing small persona fixtures and a 10,000-item / 50,000-event large-library dataset.
- [ ] Create a pre-upgrade v3.14.1 SQLite schema/data snapshot helper in `src-tauri/tests/unified_learning_e2e.rs` containing `review_results`, FSRS-7 states, `study_plans`, `exam_grades`, and legacy `localStorage` knowledge store payloads.

## 2. Automated E2E Tests: Scenarios A through E (Personas & Goal Lifecycle)
- [ ] Implement Scenario A test (`casualReader.test.tsx`): verify direct reading without goals/SRS/coach clutter.
- [ ] Implement Scenario B test (`incrementalLearner.test.tsx` + Rust test): verify FSRS-7 scheduling parity, extract/cloze workflow, and `StrictManual` vs `Adaptive` DAQE modes.
- [ ] Implement Scenario C test (`deadlineStudent.test.tsx`): verify deadline pacing in DAQE, deterministic Coach `deadline_slippage_risk`, and exam-readiness session launch.
- [ ] Implement Scenario D test (`multiGoalInterleaving.test.tsx`): verify 2+ simultaneous goals with distinct subject templates interleaving within one time-boxed `LearningSession`.
- [ ] Implement Scenario E test (`explorationToMastery.test.tsx`): verify Smart Feed exploration cluster triggers Coach `exploration_ready_for_structure` and promotes to a Learning Goal only after explicit user confirmation.

## 3. Automated E2E Tests: Scenarios F through H (Assessment, Sync, Study Mode)
- [ ] Implement Scenario F test (`failedAssessmentRemediation.test.tsx` + Rust test): verify exam failure → gap derivation → dimension-targeted remediation → `remediation_loop_stall` anti-loop cap → mastery recovery.
- [ ] Implement Scenario G test (`crossViewReviewConsistency.test.tsx`): verify single canonical `learning_events` emission synchronizes Review, Scroll Mode, Queue, and Unified Session without stale resurrection.
- [ ] Implement Scenario H test (`studyModeSingleSurface.test.tsx`): verify single canonical `BaseDocumentViewer` inside `study-canonical-reader-host` and exact return-to-reading state restoration from unified activities.

## 4. Automated E2E Tests: Scenarios I through L (No-AI, Privacy, Recovery, Migration)
- [ ] Implement Scenario I test (`noAiProvider.test.tsx`): verify Today, DAQE, Study Plans, 12-signal Coach templates, all 13 Activity types (including `socratic_dialogue` fallback), and Motivation run cleanly with zero AI providers.
- [ ] Implement Scenario J test (`privacyAndIsolation.test.tsx` + Rust test): verify `isLocalOnly`, `isAiExcluded`, `strictLocalOnly`, sandbox extension redaction, Sync v2 exclusion, and `health/health.db` physical isolation.
- [ ] Implement Scenario K test (`interruptedSessionRecovery.test.tsx` + Rust test): verify mid-session crash/reload restoration and idempotent event replay (zero duplicate FSRS-7 reviews or XP ledger entries).
- [ ] Implement Scenario L Rust integration test (`unified_learning_e2e.rs`): verify non-destructive migration from v3.14.1 SQLite snapshot through migration `173_coach_and_motivation_systems` with 100% data retention.

## 5. Benchmarks, Disabled-Mode, & Evidence Correction (Scenarios M through O)
- [ ] Implement Scenario M seeded benchmark suite `src/lib/unified-learning/largeLibrary.bench.ts` verifying DAQE top-10 `< 150 ms` and Coach 12-signal detector `< 50 ms` on 10,000 items / 50,000 events, and update `scripts/perf-baselines.json`.
- [ ] Implement Scenario N test (`disabledCoachAndMotivation.test.tsx` + Rust test): verify `proactivity_level = "disabled"` and `motivation_enabled = false` hide UI, perform zero background queries/AI/XP writes, and preserve historical data.
- [ ] Implement Scenario O test (`evidenceCorrectionInvalidation.test.tsx` + Rust test): verify exam regrade / evidence invalidation recomputes 5-dimension `competency_projections`, updates `learning_gaps`, revokes `mastery_outcome` milestones, and keeps `motivation_xp_ledger` intact.

## 6. Full Release Gate Verification
- [ ] Run `npx tsc --noEmit`, `cd src-tauri && cargo test --test unified_learning_e2e`, `npx vitest run src/test/e2e/unified-learning src/components/settings`, `npm run bench:check`, `npm run check:bundle`, and `openspec validate --strict --no-interactive` across all unified learning changes, and archive the verification summary.
