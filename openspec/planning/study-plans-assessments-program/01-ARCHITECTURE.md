# Study Plans and Assessments — System Architecture

Authoritative normative types, algorithms and command names are in [02-SHARED-CONTRACTS.md](02-SHARED-CONTRACTS.md). This document explains component boundaries and runtime behavior rather than repeating every field.

## 1. Runtime layers

### 1.1 React / TypeScript domain layer

New Study Plans feature modules own:

- Plan draft editing, deterministic DAG validation/topological positioning and diffs.
- Source-scope selection and conversion from application-resolved evidence to the existing navigation helpers.
- Assessment configuration and exact deterministic quota-slot construction.
- Fail-closed generated curriculum/question/rubric validators and question fingerprinting.
- Public-question projection, pure objective grading, analytic-rubric aggregation and attempt presentation policies.
- AI task definitions and an explicit coordinator that runs one durable step at a time.
- Evidence folding, conservative demonstrated-performance states and gap rules under `evidence-v1`.
- Native UI and non-authoritative Zustand view state.

No pure domain function reads the clock, invokes Tauri, opens storage or calls an AI provider. Time, randomness and provider responses enter as inputs, making fixtures reproducible.

### 1.2 Rust / SQLite native layer

New command/repository modules own:

- All durable artifacts, timestamps, ids, version/head pointers and CAS revisions.
- Live source hydration, revision/excerpt verification and source-deletion detection.
- Transactions, idempotency, foreign keys and immutable committed-question triggers.
- Study job claims, leases, cancellation epochs, checkpoint commits and interruption recovery.
- Current-grade switching, response submissions, attempt totals and exam history deletion.

No frontend SQL exists. New commands are registered through `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs`, and wrapped by `src/api/*.ts` using `invokeCommand`.

### 1.3 Existing learning substrate

The new system reads but does not replace:

- Documents/extracts and `ExactSearchHitLocation` viewer jumps.
- `retrieveFromLibrary(query,{k,filters:{documentIds}})`, `getAIIndexStatus`, and the rebuildable semantic index.
- Existing `concepts` identity and confirmed `concept_links`, including `prerequisite-of` provenance.
- `coverage.ts` `coverage-v1` evidence/activity outputs.
- `runTask`, task registry/router, structured output repair and fake providers.
- Destination classification, feature activation, document exclusion/local-only settings, cloud disclosure and paid-cost consent.
- `AnswerAssessment` / `assess-answer`, `TutorSession` / `TutorSheet`, Learn This preview and learning-agent acceptance idempotency.
- Existing Queue/Review/FSRS owner commands, which receive no exam mutations.

The active `design-source-grounded-ai-curricula-and-assessments` remains flashcard-quality work. Its unlanded validator is not a dependency.

## 2. Component map and data ownership

| Component | Owns | Does not own |
|---|---|---|
| Study Plan repository/commands | Goal text, plan heads, versions, logical nodes, versioned content/edges/activity | Source file data, concepts, mastery estimates |
| Study source service | Validated evidence refs, excerpts/revisions, historical resolution | Semantic index authority, document deletion policy |
| Curriculum tasks/coordinator | Candidate topics/objectives/prerequisites, generation progress | Direct persistence, canonical ids, accepted graph links |
| Blueprint repository/commands | Configuration, source snapshot, revisions, shortfall acceptance, archival | Attempt state, FSRS card identity |
| Question domain/validator | Typed content, options/blanks, committed keys/reference/rubrics, validity/fingerprint | Learner answer, scheduling, model-selected durable ids |
| Attempt repository/commands | Attempt lifecycle, fixed paper, current responses, immutable submissions, history | Provider retry policy, rubric semantics |
| Objective grader | Pure exact score/outcome calculation | Model inference, DB reads/writes |
| Rubric tasks/grader | Criterion proposals, existing assessment envelope, provider provenance | Authoritative final formula, direct status writes |
| Grade repository/commands | Immutable grade history, current final/needs-review state, aggregate totals | `answer_assessments` review rows, scheduler fields |
| Learning evidence service | Append/adjust performance evidence, evidence-v1 fold, gap rules and dispositions | Content coverage doctrine, FSRS ratings, calibrated certainty |
| Remediation adapters | Source/tutor/practice/card/follow-up launch payload | Automatic creation, priority or due-date changes |
| Study job repository/coordinator | Three explicitly allowed job kinds, steps/leases/recovery | General application job registry, unbounded background execution |

Source evidence is shared by plans/questions but owned by its own table and reference-counted through associations. Attempt grades are owned by the response submission, not by existing review/card assessment commands.

## 3. Primary data flows

### 3.1 Manual Study Plan (Change 1)

1. Create Plan validates goal using `validateSessionGoal`, source selections and depth.
2. Rust freezes concrete document/extract ids and revisions. No dynamic collection query remains authoritative.
3. The editor builds draft nodes/objectives/source refs and prerequisites locally. User adds/reorders/locks/removes through a full validated draft document.
4. Save Draft commits only after DAG/source validation. The UI displays persisted state only after the command returns.
5. Publish increments the plan head, supersedes its predecessor and presents a diff. Activity remains keyed to logical node ids.
6. Study Plans reopens from SQLite after restart. Existing source refs are re-resolved and marked current/stale/missing without altering historical content.
7. Legacy localStorage is offered/imported once through a validated idempotent importer and then removed as an active authority only after successful commit.

### 3.2 Curriculum generation (Change 2)

1. **Preflight/freeze:** verify native store, feature activation, source permissions, index status, generation and embedding destinations, cloud disclosure/cost consent. Persist job and planned steps before inference.
2. **Seed evidence:** retrieve goal-focused chunks with hard document filters. Add confirmed concepts/prerequisite links available inside the frozen scope. Cap at 24 documents, 12 seeds and 96 unique evidence hits; dedupe by chunk/content identity locally.
3. **Evidence handles:** hydrate each hit and create/resolve source refs. Each model batch contains at most 12 handles, at most 18,000 source chars and no source outside the approved scope.
4. **Decompose:** a registered reasoning task with full-class twin proposes 3–8 nodes per batch, each with objectives and source handles. A batch must not reference another batch's handles.
5. **Merge:** application assigns logical ids, maps existing concepts, computes semantic keys, merges only exact canonical/accepted `same-as` identities, and lists possible duplicates/unsupported nodes. User-removed tombstones and locks from the base version win.
6. **Prerequisites:** accepted concept links supply confident candidates; a separate handle-bound task may propose intra-plan edges. Existing `prerequisite-analysis` can supply concepts/rationales for an evidence passage but does not write the plan or concept graph. Unsupported prerequisite suggestions become visible material-gap nodes, not fabricated citations.
7. **Validate:** drop invalid candidate edges with explicit issues; invalid source handles invalidate their candidate nodes. Cycle/dangling/self-edge errors block publication. Run coverage-v1 separately for named concepts without treating its result as mastery.
8. **Preview/accept:** completed steps checkpoint draft nodes; partial/cancelled generation remains inspectable. Accept produces a version diff and explicit publication only if the plan head still matches.
9. **No-AI route:** confirmed in-scope concepts plus document/extract inventory create a deterministic outline. No model rationales or inferred edges are invented. If only document-level evidence exists, the node is marked limited/coarse rather than falsely precise.

### 3.3 Assessment generation (Change 3)

1. User selects plan version or custom frozen source scope, topics, mode, length (1–40), type/difficulty weights, timer and repeat policy.
2. Application constructs exact marginal quotas and stable quota slots. Provider preflight shows maximum number of model calls and off-device payload classes before Start.
3. Generation batches at most four desktop/two mobile slots. The task output includes the correct option ids/per-blank alternatives/reference answer/key facts/rubric at authoring time; it never waits for the learner answer.
4. Validators enforce gradeability and rehydrate all source handles. Exact and near duplicates are rejected/flagged against the fixed revision and selected past-paper exclusion list.
5. Each batch commits valid draft question revisions and deficits atomically via its job step. Cancellation/restart preserves them.
6. Preview supports edit/regenerate/exclude. An edit creates an uncommitted revision and runs identical validators. Unsupported external facts cannot be published as grounded questions.
7. Publication validates quotas, source state and every key/rubric in one transaction, sets `committedAt`, and activates immutability protections. A requested 30/valid 17 paper remains Needs Review until Retry, Edit or explicit shortfall acceptance.
8. On no provider, users can manually author valid questions and publish. Already-generated papers remain readable, previewable and consumable offline.

### 3.4 Attempt and deterministic submission (Change 4)

1. Start checks Ready revision, creates attempt/ordered pinned question revisions/empty responses/deadline atomically and returns public questions without keys.
2. Navigation is local and never requires inference. Responses save after schema validation with response CAS and client mutation ids; success indicators follow persistence.
3. Skip and unanswered are distinct marks. Essay/short answers use accessible resizable text areas and save across application/mobile lifecycle.
4. On Submit, all current responses become immutable response submissions, pure objective grades are validated and stored, and attempt status is computed. Double submit does not create more submissions/grades.
5. Deterministic results and explanations are revealed according to mode. If subjective nonblank answers exist, the attempt enters Grading/PartiallyGraded rather than falsely Complete.
6. An attempt resumes from persisted current responses and deadline after restart. If expired, recovery submits confirmed work with `timer-recovered`; unacknowledged keystrokes are not claimed saved.
7. Basic Practice Check appends a new response submission each round, returns immediate feedback, and retains ordinal history. Exam/Diagnostic prohibit this before final submission.

### 3.5 Rubric grading (Change 5)

1. Submission creates one exam-grading job step per nonblank non-exact short/essay response; blank responses already have deterministic zero.
2. Short-answer semantic assessment reuses `AnswerAssessment` semantics and `assess-answer` where its four-field input suffices, with a target id containing attempt/question/submission. Exam-grade persistence remains separate.
3. Analytic grading uses a new reasoning/full task over one pinned question, committed rubric/reference and validated source excerpts plus one immutable response. Inputs are independently contained. There are no model tool calls.
4. Validation requires each criterion once, level 0–4, a verbatim learner-answer quote and allowed source handles. Existing `AnswerAssessment` is composed as the feedback envelope and retains its fail-closed numeric checks.
5. Application computes points from criterion weights/levels, not model `score`. Contradiction, not-assessable, ambiguous result or non-reasoning essay fallback becomes Needs Review; other valid results become Final.
6. Every grade is append-only with full provenance; the current pointer and attempt aggregate update transactionally. Provider errors do not alter the response.
7. Retry reuses the same question/response/rubric revisions but gets a fresh grade row. Manual review supplies criterion levels/reason and supersedes the old current grade. Evidence settlement follows only a final current grade.

### 3.6 Evidence, gaps, remediation and diagnostics (Changes 6–7)

1. Objective final/AI final/manual final grades emit evidence using unique `(sourceKind,responseSubmissionId,conceptId)`. Superseding grades adjust the same evidence row in the same transaction as current-grade/aggregate changes.
2. `evidence-v1` folds affected concepts deterministically. One attempt/group does not masquerade as many independent observations; same-question practice is down-weighted; AI/hints/recency have disclosed weights and uncertainty reasons.
3. UI shows content coverage, study activity and demonstrated evidence separately. “Weighted observed performance” is not a mastery probability. Sparse or conflicting evidence remains insufficient/developing.
4. Gap rules create source-linked, explainable/dismissible recommendations only after settlement or an explicit local refresh. Reading and review sessions are never interrupted.
5. Open Source/Extract reuses viewer navigation. Tutor uses `TutorSession` with injected document-filtered retrieval; merely placing a document id in prompt text is not sufficient scoping.
6. Targeted Practice and Follow-up Exam create blueprint drafts. Optional cards go through static Learn This/agent proposal preview; only acceptance invokes normal scheduled-card creation. Plan Adjustment creates a reviewable draft. Dismissal is persisted.
7. Change 7 optionally creates a 4–12 item diagnostic with the same blueprint/attempt/grader. Its final evidence can inform a new curriculum draft after explicit user action. Skip does not run inference, create an empty attempt, or block curriculum generation.

## 4. AI tasks and capability policy

| New/reused task id | Class / fallback | Max batch and budget intent | Capability/degradation |
|---|---|---|---|
| `study-curriculum-decompose` / `study-curriculum-decompose-full` | reasoning / full | ≤12 evidence handles, 3–8 nodes, 1,800 output tokens, 60 s | No provider → rules outline; full fallback labelled draft needing review |
| `study-curriculum-prerequisites` / `…-full` | reasoning / full | ≤24 app-assigned topic handles, 1,200 tokens, 60 s | Invalid handle/cycle → edge issue; no automatic concept-link write |
| `study-question-generate` / `study-question-generate-full` | reasoning / full | ≤4 desktop/2 mobile slots, 3,000 tokens desktop, 1,800 mobile, 90 s | No provider → manual question editor; failed slots become explicit deficits |
| `assess-answer` / `assess-answer-full` | existing reasoning / full | One short answer, 900 tokens, 45 s | Non-exact result still needs committed key/rubric binding; unique target id per submission |
| `study-rubric-grade` / `study-rubric-grade-full` | reasoning / full | One response/rubric, 1,600 tokens, 90 s | Non-reasoning essay fallback → needs manual review; provider absent/failure → saved answer remains pending |
| Existing `tutor-turn` / `tutor-turn-full` | existing | Existing policy limits | Existing graceful degradation; source-scoped retrieval injection added in C7 |

All new tasks use `taskType:"prompt"`, structured output, schema+validator, `requirement:"prompt"`, non-streaming unless needed for progress text, `UNTRUSTED_CONTAINMENT_CLAUSE`, and import-time `registerTasks`. The implementation must explicitly export new definitions through `src/lib/ai/tasks/definitions/index.ts` and import them in their production coordinator so the reasoning twins resolve.

`AITaskResult.providerKind` is not used as privacy truth. Previews persist the frozen destination classifications, provider id, actual route/model/fallback and usage from `AITaskResult`. `requestPolicy` is always constructed as numeric context/output budgeting and is not confused with consent.

C2 supplies `runPinnedStudyTask`: resolve the primary route first, then invoke `runTask(route.task,input,{...options,provider:route.provider})`. The `provider` option deliberately suppresses runTask's automatic alternate-provider/cloud recovery; using only `resolvedProvider` does not. Reasoning twins are resolved explicitly before the call, and provenance merges the primary route/fallback with actual run metadata because direct provider injection otherwise reports fallbackPath none. Failures stay within the current Study job and require explicit preflighted retry.

There is no application-level claim that “reasoning capable” guarantees educational quality. Real-model evaluation in Change 8 marks a provider qualified/not qualified for curriculum, question and essay-rubric work. Fallback quality limitations remain visible. The model is never asked to self-certify its own competence.

## 5. Persistence and transaction architecture

The physical schema uses relational identity/link/lifecycle columns and versioned JSON for self-contained typed documents:

- Plan and blueprint containers have stable logical ids; version/revision rows pin immutable published content.
- Versioned JSON is appropriate for question variant payloads/rubrics because graders need one coherent contract. Queryable kind/fingerprint/commitment/target fields remain columns.
- Source excerpts/revisions and associations are durable; semantic chunks remain cache coordinates.
- Current responses are mutable drafts; evaluated response submissions and grades are immutable history.
- Learning evidence is derived only from final grades but persists to make history, dismissal and correction behavior auditable.
- Generation jobs store compact checkpoints and owner ids; model raw output is not a system of record.

Complete DDL, indexes, migrations, deletion and backup implications are in [04-DATA-AND-MIGRATION-PLAN.md](04-DATA-AND-MIGRATION-PLAN.md).

## 6. Navigation architecture

C1 creates one `study-plans` TabType/destination and all required registry/main-layout/palette/capability/mobile/i18n wiring. Inside that destination, Plan List, Plan Editor, Assessment Builder, Attempt Runner and Results are routed feature views with durable ids in view state. They do not create competing top-level Review/Queue destinations.

Entry points:

- Main navigation/command palette opens Study Plans.
- Library/documents selection supplies a preselected source scope; reader selection/extract opens Create Plan or Remediation with that source.
- Knowledge Graph concept action opens Create Plan scoped to related material or an existing linked node; graph never renders unaccepted plan edges as confirmed concept edges.
- Results weak-concept action opens sources, TutorSheet, Practice, Learn This preview or a follow-up blueprint.
- Existing Review remains card-centric. Dashboard/analytics may link to persisted plan/attempt summaries but do not own them.
- Learning Agent can hand off to Create Plan/Assessment UI, but its transcript/proposal limits do not host the artifact engine.

Native browser capability gating refuses durable workflows where SQLite commands are unavailable; the normal PWA browser default must not be interpreted as successful save.

## 7. Failure and recovery semantics

| Event | Durable outcome | User-visible/recovery behavior |
|---|---|---|
| No provider | Existing plan/paper/attempt unchanged; no generation job marked Running | Manual plan/question editing and objective taking remain; AI actions explain provider requirement |
| Provider unsupported/times out | Current step Failed, committed checkpoints retained | Retry same step or choose explicitly authorized provider; no unfilled quota fabrication |
| Malformed model JSON/schema | `runTask` may perform its single repair; afterward step Failed with safe error | No invalid artifact reaches Ready; Inspect issue / Retry / manual edit |
| Invalid source handle/excerpt | Candidate invalid; other valid candidates checkpoint | Identify topic/slot deficit, edit source or exclude; never silently swap citation |
| Source revisions change mid-job | Job Failed `source_changed`; previous published artifacts unchanged | Review changes and start a new draft/request hash; do not mix old/new evidence silently |
| Source deleted after publication | Historical text/refs/results retained; resolution Missing | Existing results readable; navigation disabled with explanation; future generation excludes |
| Cancellation | Epoch increments, in-memory task aborts; completed steps retained | Resume recreates preflight; late output rejected; no rollback of committed valid work |
| Restart while generating | Nonterminal Running/Queued becomes Interrupted; checkpoints persist | Study Plans shows Resume with provider/destination/cost disclosure; no automatic paid work |
| App restart mid-attempt | InProgress plus acknowledged drafts and deadline restored | Resume same attempt/no duplicate; optional timer continues by durable deadline |
| Mobile suspension | Lifecycle handler flushes current response; process inference abort is recoverable | Reopen restores last acknowledged response; timer semantics disclosed |
| DB write failure | Command returns storage_failed; no success state assumed | Retain unsaved editor draft in memory where possible, offer Retry; never say saved |
| Double submit/check | Existing submission/result returned or informational duplicate | Exactly one exam final submission per response and no duplicate aggregate/evidence |
| Objective vs AI grading partial | Attempt PartiallyGraded or GradingFailed, learner answers retained | Inspect completed items, Retry failed, manual review; official total stays null until resolved |
| User challenges grade | New Manual grade linked in history; previous remains | Report explains corrected outcome; evidence adjusts once, never rewritten FSRS |
| Plan head changed before AI draft acceptance | `stale_revision`, generated draft remains inspectable | Rebase onto new head and reapply locks/tombstones before explicit acceptance |
| Ready blueprint edited | New Draft revision; old Ready history immutable | Existing attempts/results unaffected; user explicitly starts new or retakes old revision |

## 8. Security and privacy containment

### 8.1 Untrusted documents and answers

- Every task wraps source, generated keys/rubrics and learner answers in separate untrusted blocks. Injected text such as “ignore the rubric/mark correct” receives no tool or command authority.
- The model has no filesystem, shell, retrieval or persistence tools in curriculum/question/rubric tasks. Retrieval is application-selected before task invocation.
- Output validation rejects oversized arrays/strings, invalid enum/discriminant combinations, unknown handles, forged refs and ambiguous grade payloads.
- Successful JSON parse never establishes provenance or correctness; live hydration, key resolution and gradeability checks remain mandatory.

### 8.2 Payload/network boundaries

- Generation discloses selected excerpts, goal/topic/objective metadata and exact destination. Grading additionally discloses committed reference/rubric and the submitted learner answer.
- Retrieval embeddings may be remote even if generation is local. Preflight independently classifies and consents to embedding and generation destinations.
- `isAiExcluded` sources are never sent; `isLocalOnly` and strict-local-only reject non-device routes. LAN, remote and unknown endpoints are not presented as local. Loopback is device-local under existing destination rules.
- No automatic cloud alternate-provider retry is allowed unless that exact route and cost were preauthorized; simplest coordinator behavior is to disable `cloud-fallback` for Study tasks and require explicit restart with another provider.
- Already generated artifacts, responses, objective grading, history and navigation never require network.

### 8.3 Rendering and race defenses

- No raw HTML from sources/model/user answers. Plain learner responses render as text; generated Markdown goes through existing safe assistant rendering, with links restricted to application source actions.
- SQL parameters are bound; no model text is concatenated into SQL. Foreign keys and unique/check constraints backstop DTO validation.
- Commit-time job lease/cancellation and aggregate CAS prevent stale async responses and double-submit races. IDs/fingerprints are recomputed application-side.
- Sensitive excerpts/answers are excluded from sanitized AI diagnostics and error `details`. Historical artifact deletion is explicit because source deletion alone does not erase stored exam copies.

## 9. Performance and resource envelopes

- Maximum 100 manual plan nodes; AI-generated depth caps survey=8, foundational=16, deep=24. Edges maximum `V(V−1)/2` but generation validator caps 96 to keep review understandable.
- Maximum 24 selected documents, 200 selected extracts, 96 evidence hits, 12 decomposition seeds, 12 handles and 18,000 source chars per curriculum batch.
- Exams 1–40 questions, options 2–8, criteria 1–8 (essay minimum 2), at most four question drafts per desktop batch/two mobile. No monolithic 40-item response.
- Global Study AI job concurrency is two jobs, one active model call per job and one active job per target. Deterministic evidence folds run synchronously over affected concept ids; large historical refresh is chunked at 100 evidence rows per step.
- Cursor/paged history queries and indexes cover plan/blueprint/attempt/evidence foreign/filter fields. Rendering large curricula uses grouped ordered sections rather than a mandatory dense graph.
- Normal grading attempts no live paid inference in tests. Benchmarks use `seededRandom`, fixed 24-node/40-item fixtures, consume results into sink, return void and update baselines only when intentionally changing performance.

## 10. Licensing separation

LearnHarness is AGPL-3.0; Plethora is Apache-2.0. Only abstract ideas—precommitment, gradeability, deterministic set scoring, DAG rejection, idempotent batches—inform independent requirements. The implementation agent must not copy LearnHarness files, comments, prompts, schemas, test text or Mermaid syntax. All schemas, algorithms and UX copy in this program are independently specified against Plethora's actual interfaces.
