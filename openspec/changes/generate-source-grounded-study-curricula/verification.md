# Verification Evidence: Change 2 — Generate Source-Grounded Study Curricula

## 1. Summary

Change 2 (`generate-source-grounded-study-curricula`) provides the complete pipeline for generating and iteratively refining source-grounded study curricula. All 10 tasks (C2-T01 through C2-T10) have been implemented and verified against unit, integration, failure matrix, Rust, linting, type-checking, and benchmark gates.

## 2. Test Execution Ledger

### 2.1 Targeted Vitest Suites
- **Test files executed:** 22 files across `src/lib/study-plans/generation/`, `src/components/study-plans/`, and `src/lib/ai/tasks/`
- **Total tests:** 115 passed, 0 failed
- **Key test suites:**
  - `src/lib/study-plans/generation/__tests__/curriculumValidation.test.ts`: pure fail-closed schema and topological validators.
  - `src/lib/study-plans/generation/__tests__/planEvidence.test.ts`: sorted frozen evidence bounds (24 docs, 96 hits, 12 concept seeds).
  - `src/lib/study-plans/generation/__tests__/merge.test.ts`: user lock/edit/tombstone preservation, semantic key deduping, and PlanVersionDiff.
  - `src/lib/study-plans/generation/__tests__/rulesOutline.test.ts`: deterministic outline extraction without AI inference.
  - `src/lib/study-plans/generation/__tests__/requestHash.test.ts`: canonical SHA-256 over generation inputs.
  - `src/lib/study-plans/generation/__tests__/preflight.test.ts`: endpoint-aware privacy checks, fail-closed remote rejection, and cost disclosures.
  - `src/lib/study-plans/generation/__tests__/pinnedTask.test.ts`: single-route pin enforcement without cloud fallback.
  - `src/lib/study-plans/generation/__tests__/evidence.test.ts`: library retrieval with strict documentId scoping and hit budgets.
  - `src/lib/study-plans/generation/__tests__/coordinator.test.ts`: multi-step job coordination, pause/resume, and checkpoint preservation.
  - `src/lib/study-plans/generation/__tests__/noAiCoordinator.test.ts`: reproducible no-AI curriculum orchestration.
  - `src/lib/study-plans/generation/__tests__/coverageProjection.test.ts`: honest multi-level evidence projection (solid/partial/none/unknown).
  - `src/lib/study-plans/generation/__tests__/curriculumFailureMatrix.test.ts`: 7 adversarial matrix scenarios:
    1. Single and multi-source inputs.
    2. Duplicates, dangling edges, and cyclical graph detection.
    3. User edits, locks, and tombstone preservation across regenerations.
    4. Prompt injection containment via `wrapUntrustedBlock` and `UNTRUSTED_CONTAINMENT_CLAUSE`.
    5. Fail-closed privacy gate (remote Ollama, remote embedding, missing cloud disclosure, or denied cost consent).
    6. Deterministic rules-only outline without model calls.
    7. Absolute isolation of FSRS-7 and review scheduler.
  - `src/components/study-plans/__tests__/curriculumGenerationUI.test.tsx`: UI orchestration, dialog flows, progress stepper, issue display, and draft acceptance/discard.
  - `src/lib/ai/tasks/__tests__/curriculumTasks.test.ts`: twin task registration (`study-curriculum-decompose` and `study-curriculum-prerequisites`).

### 2.2 Rust Native Tests
- **Command:** `cargo test --lib study_` (in `src-tauri`)
- **Result:** 31 passed, 0 failed
- **Coverage:**
  - Migration 140 DDL execution, constraints, cascades, indexes.
  - `study_generation_repository`: atomic step claims, lease renewals (120s), CAS completion, cancellation epochs, and interrupted recovery.
  - IPC commands: `start_study_generation_job`, `claim_next_generation_step`, `renew_generation_step_lease`, `complete_generation_step`, `fail_generation_step`, `cancel_study_generation_job`, `recover_interrupted_generation_jobs`.

### 2.3 Code Formatting & Linting
- **Rust formatting:** `cargo fmt --check` — Clean, zero formatting diffs across `src-tauri/src/models/study_generation.rs`, `database/study_generation_repository.rs`, `commands/study_generation.rs`, and migration 140.
- **TypeScript Typecheck:** `npx tsc --noEmit` — Clean, 0 errors.
- **ESLint:** Clean, 0 errors and 0 warnings on all changed paths in `src/components/study-plans/` and `src/lib/study-plans/`.

### 2.4 Performance Benchmark Gate
- **Command:** `npm run bench:check`
- **Result:** Exit code 0, 70/70 benchmarks evaluated, 0 performance regressions against baselines, bundle budgets verified.

### 2.5 OpenSpec Validation
- **Command:** `openspec validate generate-source-grounded-study-curricula --type change --strict --no-interactive`
- **Result:** Valid.

## 3. Invariants & Isolation Assurances

1. **FSRS-7 & Review Isolation:** Generation jobs and draft curricula make zero writes to `learning_items`, `review_logs`, `fsrs_cards`, or queue order indices.
2. **Local-First Privacy:** Remote model routes require explicit cloud disclosure and cost consent. Remote embeddings on unconsenting sources fail closed immediately.
3. **Data Loss Prevention:** Re-running curriculum generation preserves existing locked nodes and tombstoned topics via version diff and merge reconciliation.
4. **Physical Device & Live Provider QA:** Live LLM inference and physical Android device runs are formally deferred to Change 8 (`validate-study-plans-and-examinations-end-to-end`).
