# Implementation Dependencies and Integration Gates

## 1. Change DAG

```text
C1 establish-persistent-study-plans
   └── C2 generate-source-grounded-study-curricula
        └── C3 generate-study-plan-examinations
             └── C4 implement-resumable-examination-sessions
                  └── C5 implement-rubric-based-exam-grading
                       └── C6 derive-study-gaps-from-exam-evidence
                            └── C7 integrate-study-plans-with-adaptive-practice
                                 └── C8 validate-study-plans-and-examinations-end-to-end
```

This chain is intentionally serial for the weaker implementation agent. Shared migrations, navigation, task registration, plan types and blueprint/exam types make parallel implementation more dangerous than useful. Independent test fixtures or documentation can be prepared in parallel, but production changes land in the order above.

## 2. Contract ownership and modification order

| Shared surface | Owner / first writer | Later writers, in order | Rule |
|---|---|---|---|
| `src/types/learningPaths.ts` | C1 canonical plan/domain types and DAG | C2 generation draft types; C6 evidence projections; C7 diagnostic adapter types | Never restore localStorage authority or inert mastery fields; import common types rather than redefine |
| `src/stores/learningPathsStore.ts` | C1 removes authoritative `persist` | C2 job/draft projection; C6 gaps projection; C7 tutor/practice launch state | Zustand remains a non-authoritative API/view cache |
| `src-tauri/src/database/migrations.rs` | C1 plan/source tables | C2 jobs; C3 blueprints/questions; C4 attempts/responses/objective grades; C5 grade history/rubric payloads; C6 evidence/gaps; C7 only if diagnostic metadata is not already covered | At each change re-derive the next unused numeric migration; never renumber/reserve a global fixed number |
| `src-tauri/src/lib.rs`, `commands/mod.rs` | C1 study plan/source commands | C2 job commands; C3 blueprint commands; C4 attempt commands; C5 grading commands; C6 evidence commands | Append/register only; run existing command compilation tests |
| `src/lib/ai/tasks/definitions/index.ts` | C2 curriculum task exports | C3 question tasks; C5 rubric task; C7 any remediation task | Import-side-effect registration must be reachable from production import graph |
| `src/navigation/tabDestinations.ts`, `TabRegistry.tsx`, `MainLayout.tsx`, palette, locales | C1 complete Study Plans destination | Later changes add nested UI actions, not a second destination | Run drift, registry, platform capability and i18n tests |
| `src/components/tutor/TutorSheet.tsx` | Existing owner | C7 only | Add scoped retrieval injection without altering existing host behavior |
| `src/lib/ai/schemas/answerAssessment.ts` | Existing canonical owner | C5 composes a new rubric result around the envelope | Do not alter native `AnswerAssessment` wire schema or existing numeric validation |
| `src/lib/ai/tasks/definitions/recallQuestion.ts`, `chatFlashcardArtifacts.ts`, `DraftCardList.tsx` | Active card-quality change | None in this program | Do not depend on unchecked `validateGeneratedCard` or modify those files for exam validation |
| Queue, review scheduler, priority and FSRS files | Existing owners | None | Evidence/remediation must not call scheduling/ranking mutation commands |

## 3. Cross-change contracts

### C1 exports to C2

- Published/draft Study Plan aggregate and source-scope snapshot.
- `StudySourceRefV1`, source resolution results and source navigation adapter.
- DAG validator/order function, version diff, lock/tombstone semantics.
- Native `StudyPlanStore` commands and non-persistent frontend store.

**Gate:** Manually construct a two-document plan with an edge and locked node, save/reopen after a simulated restart, attempt a cyclic/disallowed reorder, and verify no AI call.

### C2 exports to C3 and C5

- `StudyGenerationJob`, `StudyGenerationStep`, lease/cancellation/checkpoint commands.
- `StudyAiPreflight` and consent/destination disclosure object.
- Task orchestration shape: contained handle-bound proposal → fail-closed validator → per-step transaction → preview.
- Curriculum evidence batches and accepted plan-version snapshot.

**Gate:** Fake-provider generation resumes after an injected interruption without duplicate nodes; source changes stop a draft; no-provider manual plans still work.

### C3 exports to C4, C5 and C7

- Blueprint head/revision/config/quota report.
- Question revision union, typed public payload, committed keys and rubrics.
- Deterministic question validator, source handles, fingerprint/dedup report.
- Ready-paper query and explicit shortfall acceptance.

**Gate:** Generate and preview all five kinds with fake providers; attempt invalid keys/clozes/rubrics/source handles; manually author a valid offline paper; prove committed payload editing fails.

### C4 exports to C5, C6 and C7

- Attempt state machine, durable draft/current responses and response submissions.
- Objective grade calculation and aggregate accumulator.
- Start/resume/submit CAS, idempotency keys, deadline recovery, history queries.
- Basic practice-check and exam reveal policy.

**Gate:** Objective exam can be completed offline and resumed after restart/mobile suspension with no duplicate attempt/submission and no scheduler mutation.

### C5 exports to C6 and C7

- Validated criterion judgments and deterministic rubric aggregation.
- Current/superseded grade history, manual correction, needs-review and retry transitions.
- Persisted grading job references/provider provenance.
- Final-grade settlement hook suitable for evidence append, with unique source ids.

**Gate:** Mixed exam handles paraphrase/partial/wrong/misconception/adversarial/provider failure; points derive from criteria; all learner submissions survive failed inference.

### C6 exports to C7 and C8

- Append-only evidence and `evidence-v1` aggregation.
- Concept evidence states, uncertainty reasons, gap rules/status/dismissal and history comparisons.
- Source-linked remediation command/preview payloads.
- Evidence invalidation/retraction when a grade is superseded.

**Gate:** Failed prerequisite, repeated failure, later success, sparse/conflicting evidence and user rejection are deterministic; Review/FSRS/Queue snapshots remain unchanged.

### C7 exports to C8

- Optional diagnostic wizard branch, skip behavior and diagnostic-to-draft adapter.
- Source-scoped tutor launch and targeted practice with hints and repeat submissions.
- Optional existing Learn This/card proposal acceptance and follow-up paper.
- User-approved plan adaptation from evidence.

**Gate:** Weak topic → source → tutor/practice → optional approved cards → reassessment works without manual context reconstruction or automatic queue changes.

## 4. Milestone integration matrix

| Milestone | Works without AI | Requires fake provider | Requires real provider / device | Existing tests that must stay green |
|---|---|---|---|---|
| C1 | All manual CRUD, versioning, source navigation, persistence | None | Native source-navigation smoke on supported targets | learning path legacy tests after intentional replacement; navigation/i18n; Rust migration |
| C2 | Rules outline and draft editing | Decompose/prereq/malformed/retry/cancel | Curriculum quality on qualified model; mobile prompt budget | task/routing/privacy/coverage/concept tests |
| C3 | Manual question editor, validation, quota math, preview | All five generation kinds and failures | Generation quality/duplicates/mobile latency | learning-material and card-quality tests |
| C4 | Complete objective exam lifecycle | Not required for deterministic paths | Native restart/mobile lifecycle/timer smoke | Review/FSRS/queue/accessibility tests |
| C5 | Blank response zero, deterministic score preservation, manual grading | AI criteria/invalid output/retry/injection | Rubric quality and model capability matrix | existing `assess-answer`; native schema tests |
| C6 | All evidence aggregation/gaps/remediation links | Optional remediation wording only | Device history/performance smoke | knowledge graph/queue/review tests |
| C7 | Skip diagnostic, source links, manual follow-up | Diagnostic generation, tutor policy, practice/card proposals | Tutor quality/mobile lifecycle | tutor/learn-this/agent acceptance tests |
| C8 | Golden objective/offline path | Full golden mixed-format path | Separate named real-model and physical-device qualification | Full normal unit/integration gates and `bench:check` |

## 5. Active OpenSpec prerequisites and coordination

- **No implementation prerequisite:** `design-source-grounded-ai-curricula-and-assessments`. Its tasks remain independent. Exam cloze validation is owned by `assessment-blueprints`, not copied into or imported from its future unchecked function.
- **Reuse verified implementation:** `ai-task-architecture`, `ai-learning-material-generation`, `ai-knowledge-relationships`, `ai-active-recall`, `ai-socratic-tutoring`, `ai-answer-assessment`, `knowledge-graph`, `ai-library-rag`, `ai-semantic-index`.
- **Coordinate only:** `validate-ai-learning-cross-platform-readiness` evidence matrix; `harden-ai-learning-actions-and-card-quality` shared providers; `add-dynamic-adaptive-queue-engine` goal validator only; `fix-issue-6-scheduling-and-learning-workflows` priority authority only.
- **No Queue implementation dependency:** canonical optional path feed is not needed by this user workflow. This program leaves queue algorithms and optional feed settings untouched.

## 6. Incomplete-earlier-change protocol

1. Stop; do not stub a dependency with a parallel type/table.
2. Run the earlier change's verification checklist and identify the exact unchecked task/blocker.
3. Complete or repair that task using its contracts and tests; record new source evidence rather than trusting prior `[x]` marks.
4. Re-run strict OpenSpec validation and the earlier integration gate.
5. Re-read the current shared contract and migration head before beginning the next change.

Only explicitly independent fixture/documentation work may continue while a previous production gate is blocked.
