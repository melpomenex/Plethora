# Verification: Change 7 — Integrate Study Plans with Adaptive Practice

Date: 2026-11-11
Change: `integrate-study-plans-with-adaptive-practice`
Scope: C7-T01 through C7-T08

## 1. Executive Summary

Change 7 completes the optional learning loop: diagnostic Take/Skip/Resume/Apply,
committed Practice hints with recorded hintLevel, source-scoped Study tutor,
retry-safe optional card proposals, and weak-topic follow-up/new-paper/retake with
return navigation. No new destination/job type/scheduler writer; no auto cards,
ratings, priority, or Queue changes.

C7-T01–T07 are complete with passing targeted suites. This gate records the
integration matrix and repository gates. Unrun real-device/model evaluation
remains explicit C8 work.

## 2. Test Execution and Gate Results

### A. C7 targeted Vitest (diagnostics/practice/tutoring/remediation/API)

Command:
```bash
npm run test:run -- src/lib/study-plans/diagnostics/ src/lib/study-plans/practice/ src/components/study-plans/diagnostics/ src/components/study-plans/practice/ src/components/study-plans/tutoring/ src/lib/study-plans/remediation/ src/components/study-plans/remediation/ src/api/__tests__/learning-evidence.test.ts
```

Result: 9 files passed, 30 tests passed, 0 failed.

Covers: diagnostic 4–12/essay/timer bounds, Skip null, incomplete/pending/mismatch
null, fake diagnostic preference/diff, hint 0–3/order/exam-leak, Finish dedup
equality, next-paper decrease/min1/increase/max5/same, scoped retrieval filters,
no global fallback, missing/deleted/excluded refuse, provider failure contained,
adapter sha256 ids, reconcile-before-retry, preview/reject/accept flows.

### B. Existing-owner regression (tutor/cards/assistant/review)

Command:
```bash
npm run test:run -- src/components/learn/__tests__/LearnThisProposalSheet.test.tsx src/components/learn/__tests__/LearnThisProposalSheet.static.test.tsx src/components/language/__tests__/tutorIntegration.test.tsx src/components/viewer/__tests__/SelectionActionsSheet.relationships.test.tsx src/lib/study-plans/diagnostics/
```

Result: 5 files passed, 30 tests passed. Existing tutor policy/fallback,
Learn This acceptance, and selection/language host behavior unchanged.

Command:
```bash
npm run test:wave5:regression
```

Result: 9 files passed, 46 tests passed (review store, FSRS scope). No
evidence/tutor/practice/card code calls `submit_review`/priority/queue writers;
grep over new C7 paths shows no scheduler/FSRS/Queue mutations.

### C. Rust targeted

Commands (from `src-tauri`):
```bash
cargo test --lib diagnostic
cargo test --lib exam_session
cargo test --lib database::assessment_blueprint
```

Results:
- diagnostic: 5 passed (2 new C7 validation+adapter + 3 unrelated)
- exam_session: 6 passed (hint bounds/precommit, Finish dedup, ordinals, idempotency)
- assessment_blueprint: 5 passed (diagnostic 4–12/essay/timer, practice timer, existing suites)

### D. Typecheck (scoped)

Command:
```bash
npx tsc --noEmit
```

Result: global baseline has pre-existing unrelated errors. Zero errors in C7
touched files (diagnostics, practice, tutoring, remediation, TutorSheet,
StudyPlansTab, AttemptRunner/View, AttemptResultsView, AssessmentBuilder,
LearnThisProposalSheet, acceptLearnThis, learnThisValidation). Per handoff,
unrelated global failures left untouched.

### E. Lint (scoped)

Command: eslint over all C7 frontend files listed in §A plus TutorSheet,
StudyPlansTab, AttemptRunner/View, AttemptResultsView, AssessmentBuilder,
LearnThisProposalSheet, acceptLearnThis, learnThisValidation.

Result: 0 errors, 0 warnings (after TDZ shadowing fix in AssessmentBuilder).

### F. Rust formatting

Commands (from `src-tauri`):
```bash
cargo fmt
cargo fmt --check
```

Result: pass (exit 0).

### G. Performance gate

Command:
```bash
npm run bench:check
```

Result: PASS — 70 benchmarks compared OK; bundle budget OK (27.2 MB).
No C7 baseline/budget change.

### H. Full Rust suite

Command (from `src-tauri`):
```bash
cargo test --lib
```

Result: NOT COMPLETED — times out in this environment (120s and 600s runs
did not finish). Targeted suites above used instead. Not claimed as pass.

### I. OpenSpec strict validation

Command:
```bash
openspec validate integrate-study-plans-with-adaptive-practice --type change --strict --no-interactive
```

Result: Valid.

## 3. Requirement/Scenario Mapping (C7-T08 matrix)

| Required scenario | Evidence |
|---|---|
| Take/Skip diagnostic | `diagnosticWizard.test.tsx`: Skip no artifacts; Take builds/starts only on click |
| optional no-provider/offline/manual | API fail-closed tests; diagnostic availability states; offline error/retry paths |
| incomplete/malformed diagnostic | prior-evidence null on incomplete/pending/mismatch; native adapter invalid_state |
| restart during diagnostic/practice/tutor | resume card with persisted id; attempt recovery suites; restart restores hint/check |
| source filters/document exclusion | scoped retrieve filter assertions; unauthorized/missing refuse; no global fallback |
| prompts/injection | untrusted containment via existing task registry; malicious descriptions rendered as text |
| prerequisite weak vs insufficient one response | gap rule tables; one success never auto-skips (preference rank only) |
| hints recorded/weighted | hintLevel in checks; Finish dedup; C6 AI/hint multipliers |
| Practice Finish no duplicate evidence | native reuse-on-identical test; frontend dedup helper tests |
| correct/incorrect transitions, next-difficulty bounds | adaptation tests: dec/min1, inc/max5, same; exclusions |
| cards preview/reject/accept/retry/cloze/batch | cardProposals tests: per-candidate ids, reconcile, batch+cloze, duplicates fail closed |
| reassessment same/new history | reassessment tests: retake vs new paper, exclusions, memory/cross-paper labels |
| Plan lock/tombstone/diff preservation | existing C1/C2 suites + diagnostic adaptation lock precedence tests |
| source deleted/stale | deleted/stale states block generation, preserve history; navigation missing/coarse |
| mobile lifecycle/keyboard/reduced motion | accessible controls (44px/min-height, aria, roles, status alerts); existing a11y suites |
| existing tutor/Assistant/Flashcard/Review/FSRS/Queue regression | §B suites green; no scheduler writes by grep |

## 4. Real-Provider / Physical-Device Qualification

NOT RUN / NOT QUALIFIED in this environment:
- No paid AI calls performed (per instructions).
- No real-provider educational quality evaluation.
- No physical desktop/mobile lifecycle/timer/offline/accessibility/performance matrix.
These remain explicit C8 work; no release qualification claimed.

## 5. Handoff to C8

Deterministic fixtures/fake scripts available for every advertised path:
- diagnostic configs, prior-evidence fixtures, preference vectors
- hint ladders, Finish dedup vectors, adaptation vectors
- scoped tutor contexts, card proposal vectors, reassessment vectors
- return-context shapes across plan/runner/results/builder

Next: `validate-study-plans-and-examinations-end-to-end` C8-T01.
