# Implementation Handoff — Study Plans and Assessments

**Audience:** the coding agent implementing the program (including DeepSeek V4.1 Flash / Mercury 3).  
**Architectural status:** major choices are closed. This document is the entry point; no reasoning history from Run A/B is needed.  
**First change:** `openspec/changes/establish-persistent-study-plans/`.

## 1. Read this before editing

Read in this order:

1. Repository `AGENTS.md` and its Git workflow.
2. This handoff and [03-IMPLEMENTATION-DEPENDENCIES.md](03-IMPLEMENTATION-DEPENDENCIES.md).
3. [00-MASTER-PLAN.md](00-MASTER-PLAN.md) for scope/non-goals.
4. [02-SHARED-CONTRACTS.md](02-SHARED-CONTRACTS.md): the normative ids/types/algorithms/APIs/errors. Do not fork these interfaces.
5. [04-DATA-AND-MIGRATION-PLAN.md](04-DATA-AND-MIGRATION-PLAN.md) before touching SQLite.
6. The current change's `proposal.md`, `specs/`, `design.md`, `tasks.md`.
7. [05-UX-SPECIFICATION.md](05-UX-SPECIFICATION.md), [07-GOLDEN-SCENARIO.md](07-GOLDEN-SCENARIO.md) and [08-RISK-REGISTER.md](08-RISK-REGISTER.md) when implementing UI/verification.
8. [10-ARCHITECTURAL-DECISIONS.md](10-ARCHITECTURAL-DECISIONS.md) only when the reasoning behind a choice matters; do not reopen decisions merely to try an alternative architecture.

If something claimed as existing is absent, stop and check current source/call sites and the dependency DAG. Do not create a parallel component/table/type to avoid reconciling the expected dependency.

## 2. Exact implementation order

```text
1. establish-persistent-study-plans
2. generate-source-grounded-study-curricula
3. generate-study-plan-examinations
4. implement-resumable-examination-sessions
5. implement-rubric-based-exam-grading
6. derive-study-gaps-from-exam-evidence
7. integrate-study-plans-with-adaptive-practice
8. validate-study-plans-and-examinations-end-to-end
```

Execute each change's `tasks.md` in numeric order and one focused task (or compile-safe task group) per implementation session. Do not start a later change because it appears easy or because its file scaffold could compile independently. Dependency reasons and integration gates are in `03-IMPLEMENTATION-DEPENDENCIES.md`.

| Change | Main deliverable | Before moving on, prove |
|---|---|---|
| C1 | Manual native Study Plans | Create/select sources/edit/DAG-safe reorder/lock/publish, restart/reopen, source navigation, legacy import, no AI/no scheduled writes |
| C2 | Source-grounded curriculum drafts | Bounded staged generation, invalid-source/cycle handling, no-AI outline, cancel/restart/resume without duplicate nodes or auto cloud work |
| C3 | Assessment artifacts | Every format/key/rubric/source/duplicate/quota validation, preview/manual editor, honest 30→17 shortfall, Ready immutability |
| C4 | Taking and objective results | All response inputs/navigation/save/resume/offline/double-submit/timer/mobile/history/practice Check/Finish and exact objective scores |
| C5 | Rubric-based grading | Fake paraphrase/partial/wrong/misconception/adversarial/corrupt outputs, criteria-derived points, recovery/history/manual correction |
| C6 | Evidence/gaps/remediation records | Unique final evidence, correction/deletion reconciliation, independent/uncertainty math, gap/suppression/history, FSRS/Queue unchanged |
| C7 | Complete adaptive learning loop | Optional Take/Skip diagnostic, scoped tutor, progressive hints/practice Finish, optional retry-safe cards, weak-topic follow-up/retake |
| C8 | Release evidence | All golden steps/negative matrix/migrations/offline/privacy/accessibility/performance plus explicitly separate provider/device results |

## 3. Starting Change 1 now

Use the `openspec-apply-change` skill (the `/opsx-apply` workflow) for change `establish-persistent-study-plans`. Work on `main` per repository instructions; do not create a feature branch. Do not commit/push unless the user explicitly asks at that point. The architecture phase deliberately made no such mutations.

### Reusable implementation prompt template

Replace only the bracketed current change/task fields:

```text
Implement one bounded task from Plethora's Study Plans program.

Current change: [change slug, initially establish-persistent-study-plans]
Current task: [exact task id, initially C1-T01]

Use the openspec-apply-change workflow. Read AGENTS.md, then:
- openspec/planning/study-plans-assessments-program/09-IMPLEMENTATION-HANDOFF.md
- 03-IMPLEMENTATION-DEPENDENCIES.md
- 02-SHARED-CONTRACTS.md
- 04-DATA-AND-MIGRATION-PLAN.md when persistence is involved
- openspec/changes/[change slug]/proposal.md, design.md, tasks.md and specs/
- relevant 05-UX-SPECIFICATION.md sections for UI.

Implement ONLY [current task] and its direct test fixtures. Every existing file path/API must be verified in source before editing; NEW paths are proposals to create. Preserve every earlier change and unrelated working-tree edit. Follow the task's exact interfaces, negative cases and Definition of Done. Do not invent new tables, provider systems, tutor/card/queue engines, vague error swallowing, or an alternate mastery model. Do not touch design-source-grounded-ai-curricula-and-assessments.

Before marking the checkbox:
1. Run the task's named targeted tests and actual type/format checks.
2. Exercise the observable behavior, including error/restart/offline case where applicable.
3. State commands and results. If a check was not run or failed, leave the task unchecked and report blocker.
4. Run openspec validate [change slug] --type change --strict --no-interactive.

Do not commit, push, create a PR or branch. Stop after this task with a concise evidence report and the exact next task.
```

### Precise first-task starter

```text
Implement C1-T01 in openspec/changes/establish-persistent-study-plans/tasks.md using the openspec-apply-change workflow. Follow openspec/planning/study-plans-assessments-program/09-IMPLEMENTATION-HANDOFF.md and all cited contracts. Limit changes to C1-T01's domain/topology files and tests; verify the exact public schema and negative DAG cases. Do not implement migrations/UI/AI yet. Run the specified tests, openspec strict validation and report actual results. No git mutation.
```

## 4. Task execution discipline

At the beginning of every task:

1. Check `git status --short`, branch and current HEAD. Preserve all pre-existing/unrelated changes; do not overwrite the Run A research or other active work.
2. Verify the previous change's tasks/integration gate by actual source call sites and test output, not archived `[x]` marks. Three repository case studies showed stale-complete claims.
3. Read the exact new/existing paths in that task. Paths marked **NEW** are absent at baseline; earlier-change paths may exist only after that dependency is complete.
4. Inspect current callers/function signatures. Run A is evidence, not authority over a changed repository. Update only documentation if a path drift is editorial; a design/interface drift needs architecture review rather than silent improvisation.
5. Ensure schemaVersion 1 DTOs, discriminated unions, text/array limits, shared error codes and idempotency are used exactly.
6. Write success and negative tests alongside the code. No actual paid/external inference in ordinary tests.
7. Run scoped tests before moving to another layer. Do not mark tasks complete solely for compile success, a new file/component, or passing static OpenSpec validation.

### Compile-safe checkpoints

Prefer this internal sequence per change:

1. Pure types/validators/algorithms + Vitest fixtures.
2. One additive migration + native migration tests.
3. Repositories/transactions + Rust failure/concurrency tests.
4. Tauri command registration + typed `src/api` invoke adapters + wrapper tests.
5. Frontend service/store, then screen/components + fake-native/component tests.
6. AI tasks (where applicable) + registered fake-provider tests.
7. Real reachable user integration/offline/restart/regression + required gates.
8. Verification evidence and then next change.

Do not combine DB design, provider routing, grading semantics and full UI in an undeclared mega-task. Each existing tasks.md already gives that sequencing; if a task expands materially, split it without weakening its IDs/coverage.

## 5. Shared ownership and conflict prevention

### Canonical ownership

- Study Plan types: C1 `src/types/learningPaths.ts`; assessments: C3 `src/types/assessmentQuestions.ts`; evidence: C6 `src/types/learningEvidence.ts` plus canonical gap type replacement.
- Native persistence lives only in Rust. Frontend localStorage is not authoritative, even for backward compatibility after its import.
- Questions/rubrics/attempts/grades are separate from `learning_items` and `answer_assessments`. Reuse `AnswerAssessment` as a composed value only.
- Curriculum/exam/grading use only C2's `curriculum|assessment-generation|exam-grading` job kinds. Do not add arbitrary job types or a general job service.
- Diagnostics are C7. Neither C2 nor C3 may expose a nonfunctional diagnostic placeholder; C7 supplies the optional adapter and complete workflow.
- Coverage remains unchanged `coverage-v1`; activity stays C1; observed performance stays C6. Never import model confidence/coverage/reading as a mastery probability.

### File modification order

Consult dependency doc §2. C1 owns initial navigation/root/source files; C2 owns shared job commands; C3 owns question models; C4 owns attempts/grades; C5 composes grades; C6 adds settlement; C7 integrates. When later changes edit earlier modules, apply only the specified narrow adapter integration and rerun earlier suites.

Do not change these active change's claimed card-quality files: `src/lib/ai/schemas/recallQuestion.ts`, `src/features/assistant/chatFlashcardArtifacts.ts`, `src/components/review/studio/DraftCardList.tsx`. Do not use capability `source-grounded-ai-curricula-and-assessments`.

### Settings and navigation

- New Study Plans destination requires all C1-T10 surfaces, not just `tabDestinations.ts`: TabType, destination, TabRegistry, MainLayout, palette, locales, platform/mobile/native capability.
- C3 per-paper controls are not global Settings. If implementation introduces a new Settings control/group contrary to design, stop and add the canonical search target/catalog/coverage/tests required by AGENTS and docs/settings-search; preferably keep controls per artifact as designed.
- Preserve existing `submitReview` sequence and FSRS-7 columns/ratings. Never auto-add review cards from gap/grading computation. Only C7 explicitly accepted Learn This remediation can create an ordinary scheduled card.

## 6. Verified command reference

Run from repository root unless shown otherwise. These scripts/commands exist at baseline; do not invent replacements.

### OpenSpec

```bash
openspec status --change <slug>
openspec instructions <artifact-id> --change <slug> --json
openspec validate <slug> --type change --strict --no-interactive
openspec validate --all --strict --no-interactive
```

Installed OpenSpec baseline is 1.13.0. `skip_specs: true` is valid only for C8 and must not become an excuse for behavioral changes.

### Frontend / docs / fixtures

```bash
npm run test:run -- <exact test paths>
npm run lint -- <changed frontend paths>
npx tsc --noEmit
npm run docs:validate
npm run test:scripts
npm run test:wave5:regression   # required scheduler/review regression when applicable
npm run test:visual             # only after E2E/UI harness is available and targeted
npm run build:check             # full frontend/docs/bundle build check when integration-ready
```

Vitest uses jsdom, `src/test/setup.ts`, and includes `src/**/*.{test,spec}.*`; use fake adapters and deterministic fixtures, no network/paid inference. Playwright uses the existing config and `src/e2e` area. Do not create custom scripts with similar names instead of using these existing commands.

### Rust

```bash
cd src-tauri
cargo fmt --check
cargo test
# Focus while iterating, then run full before change gate:
cargo test <unique_test_name_or_module>
```

Migrations use `src-tauri/src/database/migrations.rs`, unique next-free full names, inline tests and fresh/prior-populated DBs. Re-derive the number at implementation time (baseline highest 138); never reserve/reuse this number across changes.

### Performance

```bash
npm run bench:check
```

This measures all suites, checks relative costs against baselines and runs bundle check. Bench inputs must use `seededRandom(seed)` from `src/test/bench-support.ts`, no Math.random/clock sizing/network/fs/Tauri runtime; results are consumed into sink, bench body returns void. Intentional measured performance changes and new benchmark baselines update `scripts/perf-baselines.json` with reason/Golden fixture scope; never loosen an existing budget to hide regression. A plain `npm run bench` is not the gate.

## 7. Error and persistence rules that must not be weakened

- UI confirms Saved/Published/Submitted/Graded only after SQLite native return. Failure never synthesizes success/default empty records.
- Source citations are not accepted just because the model returned one. Rehydrate every source/excerpt/revision before checkpoint/Ready.
- A valid schema means gradeable but does not prove factual correctness. Preview/edit/real-model evaluation still apply.
- Answer keys/reference/rubrics/hints commit before attempt; immutable committed content is cloned to new revision for correction, not updated in place.
- Objective scores never require AI. Multi-select exact-set all-or-nothing; cloze exact accepted normalized per-blank credit; no fuzzy `84%` shortcut imported from review grading.
- Nonblank non-exact short/essay answers are pending until AI/manual final, not auto-wrong. Model holistic score/confidence never computes official points/mastery.
- Late/stale job/provider responses cannot commit after cancellation/lease/revision mismatch. Model calls are at least once, persisted effects idempotent.
- Plan/assessment/history rows survive source deletion with honest Missing Source. Explicit deletion does not propagate into unrelated documents/reviews/cards.
- Job recovery never auto-runs paid/cloud work. Resume repeats feature/document/destination/cost checks. Provider kind/local-model labels do not establish local privacy.
- PWA/browser unsupported durable commands fail explicitly instead of returning default null and appearing to save.

## 8. Handling an incomplete or failed earlier change

1. Stop the current task; do not create stubs, parallel rows or fake provider shortcuts to conceal the missing dependency.
2. Record exactly which earlier Cx-Txx is incomplete and the failed command/behavior.
3. Open that change's `verification.md` (created by its final task), check working-tree/source ownership and run the focused failing test.
4. Fix within that task's documented contract. If the contract itself conflicts, stop for architecture review; don't choose a different one in code.
5. Rerun earlier positive/negative/restart/o11y tests and the whole prior integration gate. Migration heads may have advanced: always inspect current `migrations.rs`.
6. Update actual verification evidence. Leave non-passing tasks unchecked; never change `[ ]` to `[x]` merely because files now exist.
7. Only resume the blocked later task after that gate passes and shared docs/current types align.

## 9. Real-provider and platform qualification are distinct

Fake-provider/Vitest/E2E proves control flow and deterministic contracts only, not educational quality, local endpoint truth or physical-device lifecycle performance. C8 executes:

- Named real-provider/model evaluation for curriculum/topic quality, citation support, distractor/cloze validity, paraphrase/misconception/rubric judgment and failure behavior.
- Physical desktop/mobile build/lifecycle/navigation/timer/offline/accessibility/performance matrix, linking to the active cross-platform readiness conventions.
- Explicit QUALIFIED / NEEDS-REVIEW-ONLY / NOT-QUALIFIED or NOT RUN / UNSUPPORTED status per capability/platform. Do not certify global coverage from one provider/device.

A real provider being unreachable or a device being unavailable is a concrete verification blocker, not a Pass. Program implementation can be complete while release for that advertised row remains unqualified; report this precisely.

## 10. Completion checklist for the program

The implementation is not Done until:

- Every C1–C7 visible workflow and negative scenario has actual executed evidence.
- C8's 30-step golden scenario passes from real UI+SQLite twice with same normalized artifacts and exact expected report/evidence.
- Code is reachable through native navigation and appropriate reader/library/graph/results/Review/card/tutor entry points; backend functions alone don't count.
- All changes strict-validate and cross-document links, task ids, migration names and spec deltas remain consistent after rebaseline/archive.
- Existing Review/FSRS/Queue/Assistant/tutor/flashcard tests remain green; scheduler/queue snapshots prove no contamination.
- Provider privacy/offline migration/deletion/job recovery have negative test proof, not optimistic prose.
- Traceability and golden docs show no unresolved user requirement; risks have mitigation/evidence or explicit unsupported blocker.
- Real-model/device qualifications are recorded truthfully. Any NOT RUN/UNSUPPORTED advertised workflow prevents its release qualification claim.
- No LearnHarness source/prompt/test was copied; its AGPL code remains external to Apache-2.0 Plethora.
