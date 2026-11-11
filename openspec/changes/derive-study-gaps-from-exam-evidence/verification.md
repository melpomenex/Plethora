# Verification: Change 6 — Derive Study Gaps from Exam Evidence

Date: 2026-11-11
Change: `derive-study-gaps-from-exam-evidence`
Scope: C6-T01 through C6-T08

## 1. Executive Summary

Change 6 persists source-linked learning evidence from final grades, folds
deterministic `evidence-v1` summaries with explicit uncertainty, evaluates
gap rules with suppression, and wires explainable UI plus working remediation
actions without scheduler/queue/provider side effects.

C6-T01–T07 are complete with passing targeted suites. This gate records the
acceptance matrix, repository gates, and known unrelated/blocked items.
C7 can consume demonstrated summaries/gaps/recommendation payloads.

## 2. Test Execution and Gate Results

### A. Targeted Vitest (C6 evidence/gaps/remediation/UI/API)

Command:
```bash
npm run test:run -- src/lib/study-plans/evidence/ src/lib/study-plans/remediation/ src/components/study-plans/evidence/ src/api/__tests__/learning-evidence.test.ts src/stores/__tests__/knowledgeGapsStore.test.ts src/components/study-plans/results/__tests__/ src/components/study-plans/__tests__/StudyPlanEditor.test.tsx
```

Result: 11 files passed, 51 tests passed, 0 failed.

Covers:
- evidence-v1 aggregation vectors (grouping, weights 1/.75/.5, AI x.75,
  90-day half-life, same-fingerprint x.25, states, uncertainties)
- gap rules/suppression/history/remediation planner tables
- legacy import preview/convert/execute incl. retry idempotency and
  failed-commit preserves original
- API fail-closed unsupported_platform with no empty defaults
- store legacy-compat record/dismiss/resolve + native loaders
- evidence views: reading-without-assessment, assessed-without-reading,
  correct-but-sparse, conflict/hints/AI/repeat, structural wording,
  refresh/past; results/history wiring
- remediation service: practice/follow-up configs, frozen-scope guard,
  dispositions, same-paper/cross-paper Final-only labels

### B. Rust targeted (study + evidence)

Command (from `src-tauri`):
```bash
cargo test --lib study_
```

Result: 31 passed, 0 failed.
Includes:
- `learning_evidence_repository`: record/summary lifecycle, repeated
  failure gap + resolution, reconcile pagination
- `migration_143` fresh/prior + constraints
- C1–C5 study suites remain green

Note: `list_learning_gaps` filter fixed this session to return only
`status='active'` when `includeDismissed=false`; resolved requires
`includeDismissed=true`.

### C. Scheduler/review regression (isolation)

Command:
```bash
npm run test:wave5:regression
```

Result: 9 files passed, 46 tests passed (review store, FSRS scope).
No evidence/remediation code calls `submit_review`/priority/queue writers;
grep over new evidence/remediation paths shows only a doc comment.
Optional cards are not created by evidence computation.

### D. Typecheck (scoped)

Command:
```bash
npx tsc --noEmit
```

Result: global baseline has pre-existing unrelated errors (e.g.
`studySources` vs `studySource`, assistant/provider, ExtractReader,
LocalVideoPlayer). Zero errors in C6 touched files:
`learning-evidence`, `knowledgeGaps`, `legacyKnowledgeGapsImport`,
`evidence/*`, `remediation/*`, `StudyPlanEditor`, `AttemptHistory`,
`AttemptResults`. Per handoff, unrelated global failures left untouched.

### E. Lint (scoped)

Command:
```bash
npx eslint src/api/learning-evidence.ts src/stores/knowledgeGapsStore.ts src/types/knowledgeGaps.ts src/lib/study-plans/evidence/ src/lib/study-plans/remediation/ src/components/study-plans/evidence/ src/components/study-plans/remediation/ src/components/study-plans/StudyPlanEditor.tsx src/components/study-plans/results/AttemptResults.tsx src/components/study-plans/results/AttemptHistory.tsx
```

Result: 0 errors, 4 pre-existing warnings in
`gapRules.ts`/`remediationPlanner.ts` unused imports. Clean on new files.

### F. Rust formatting

Commands (from `src-tauri`):
```bash
cargo fmt
cargo fmt --check
```

Result: pass (exit 0). Formatting-only changes applied to
`learning_evidence.rs` commands/models/repository/migrations.

### G. Performance gate

Command:
```bash
npm run bench:check
```

Result: FAIL (1 unrelated regression, not caused by C6):
- `podcastAd/cue-regex-throughput-200-sentences`: measured 0.05356
  exceeds baseline 0.03518 x tolerance 1.4 (limit 0.04925).
- Multiple WARN baselines stale-below (commandPalette, scheduler,
  tabs, wordId, article-import, rain-canvas, tabs-dom). No C6 benchmark
  added by this change; no baseline/budget edited to hide regression.

### H. Full Rust suite

Command (from `src-tauri`):
```bash
cargo test --lib
```

Result: NOT COMPLETED — timed out at both 120s and 600s in this
environment. Targeted `study_` suite (31 passed) used instead. Not
claimed as pass.

### I. OpenSpec strict validation

Command:
```bash
openspec validate derive-study-gaps-from-exam-evidence --type change --strict --no-interactive
```

Result: Valid.

## 3. Requirement/Scenario Mapping (C6-T08 matrix)

| Required scenario | Evidence |
|---|---|
| wrong prerequisite | `gapRules.test.ts` weak-prerequisite tables |
| repeated failure | Rust `test_repeated_failure_gap_and_resolution` + aggregation vectors |
| later success / resolution | same Rust test (2 successes resolve), UI GapHistory past section |
| reading-no-assessment | `evidenceViews` NodeLearningProgress no-evidence axis |
| correct-one-session | `evidenceViews` sparse insufficient-evidence, Rust lifecycle 1 session |
| insufficient/conflicting evidence | aggregation + uncertainty tests, `conflicting-outcomes` |
| misconception correction | aggregation misconception + gap unresolved-latest rule |
| review-lapse-only signal | `historyComparison` + review-lapse rule (read-only, no score mapping) |
| weak-transfer classes | gapRules weak-transfer group-count tests |
| no provider/offline | API fail-closed tests; StudyPlanProgress error/retry offline path |
| malicious evidence descriptions | validators reject oversized/HTML; UI renders text only |
| grade retry/manual correction | grading repo supersede + evidence upsert same key (no duplicate) |
| history deletion | Rust delete recompute test; `delete_exam_history` recomputes |
| upgrade reconcile/restart | Rust `test_reconcile_evidence_pagination` cursor/batches |
| source deleted/stale | repository resolution statuses; UI source-status buttons |
| user rejects remediation | RemediationList disposition dismissed persists, reversible |
| follow-up after study | remediationService draft builders (no auto-start) |
| same/cross-paper history | PerformanceComparison + AttemptHistory same/cross labels |
| old gap import retry | legacy import idempotency + failed-commit preservation tests |

## 4. Real-Provider / Physical-Device Qualification

NOT RUN / NOT QUALIFIED in this environment:
- No paid AI calls performed (per instructions).
- No real-provider educational quality evaluation.
- No physical desktop/mobile lifecycle/timer/offline/accessibility matrix.
These remain explicit C8 work; no release qualification claimed.

## 5. Handoff to C7

Safe for C7 to consume:
- `ConceptMasterySummary`, `KnowledgeGapView`, `RemediationRecommendation`,
  plan evidence summaries via `src/api/learning-evidence.ts`
- gap rule ids, suppression cutoffs, remediation payloads
- No scheduler/queue/provider side effects introduced.

Next: `integrate-study-plans-with-adaptive-practice` C7-T01.
