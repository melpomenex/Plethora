# Architectural Decision Records

Each ADR is closed for implementation. Changes 1–8 and shared contracts are authoritative companions; an implementation agent must not reopen these decisions without a new architecture review.

## ADR-01 — Use existing capabilities and leave the misleading active change untouched

**Question.** Where do Study Plans, exams, grading and gaps belong in OpenSpec?

**Alternatives.** Reuse `source-grounded-ai-curricula-and-assessments`; create all-new capability names; reuse existing canonical owners with only two new exam capabilities.

**Chosen.** Reuse `adaptive-learning-paths`, `ai-answer-assessment`, `knowledge-gap-detection`, and `ai-socratic-tutoring`. Add `assessment-blueprints` and `exam-sessions`. Qualification uses `skip_specs: true` because it changes verification, not behavior. Do not modify or rename `design-source-grounded-ai-curricula-and-assessments` or use its capability id.

**Reasoning.** The active change is card syntax/quality scope, not curricula or exams. Existing canonical capabilities already express paths, assessment and gaps. New ids are only needed for fixed assessment artifacts and sessions.

**Tradeoffs / consequences.** Sequential changes touching the same capability must use `ADDED` for independent concerns and rebaseline before any `MODIFIED` delta. The program cannot claim the other change's future `validateGeneratedCard`; exam validators live in exam-owned modules.

**Evidence.** `openspec/specs/adaptive-learning-paths/spec.md`; `openspec/specs/knowledge-gap-detection/spec.md`; active change proposal/spec/tasks verified at baseline.

**Changes.** All.

## ADR-02 — Replace localStorage authority with a SQLite Study Plan aggregate

**Question.** Should the existing orphan store remain, be a cache, or be replaced?

**Alternatives.** Keep localStorage as authority; maintain both; use SQLite with a non-persistent Zustand view cache.

**Chosen.** SQLite is authoritative. Replace `useLearningPathsStore` persistence with an API-backed, non-persisted store preserving only selection/loading UI state. Provide a one-time validated, idempotent import of `plethora-learning-paths`; never keep two writable authorities.

**Reasoning.** Existing code has no production consumer and several structural defects. SQLite supplies transactionality, native backup and source lifecycle integration. Zustand remains useful for view state only.

**Tradeoffs / consequences.** Import and native/browser unsupported states are required. Whole-DB backup works; sync is not implied.

**Evidence.** `src/stores/learningPathsStore.ts`; `src/types/learningPaths.ts`; only tests/debug registry consume them. `src-tauri/src/backup/manager.rs` snapshots the DB.

**Changes.** 1, 8.

## ADR-03 — One plan directly owns one durable learning goal

**Question.** Add `study_goals`, reuse DAQE session goals, or embed the goal in Study Plan?

**Alternatives.** Fourth independent goal entity; reuse transient queue session goal records; plan-owned goal fields.

**Chosen.** `study_plans.title`, `goal`, `depth` and scope own the durable learning goal. Reuse `normalizeSessionGoal`/`validateSessionGoal` and its 200-character refusal boundary for text validation only. There is no `study_goals` table. Multiple plans represent multiple goals.

**Reasoning.** A plan is useless without its objective, and one plan has exactly one goal. This avoids unnecessary history-mapping and collision with reading/queue goals.

**Tradeoffs / consequences.** Reusing the same goal for several curricula requires another plan. Archiving/deleting a plan owns its goal and versions but never library data.

**Evidence.** `src/lib/daqe/sessionGoal.ts`; `src/components/goals/ReadingGoalsPanel.tsx`; archived `LearningGoal` shape.

**Changes.** 1, 2.

## ADR-04 — Plans are study maps, not authored teaching content

**Question.** Does a curriculum node contain lessons or references/objectives?

**Alternatives.** AI-authored full courseware; typed source-linked study nodes.

**Chosen.** Nodes carry title, summary, learning objectives, concept identity, source evidence, prerequisites and activity state. The reader and existing tutor deliver learning content.

**Reasoning.** This is local-first, bounded on mobile, auditable against source material, and avoids an expensive second authoring system.

**Tradeoffs / consequences.** Generated rationales and objectives are not guaranteed full lessons. No-LLM outlines can be useful but deliberately simpler.

**Evidence.** Existing `adaptive-learning-paths` purpose; bounded `coverage.ts`; LearnHarness's “map, not syllabus” used as an idea, not code.

**Changes.** 1, 2, 7.

## ADR-05 — Prerequisite DAG plus constraint-respecting sequence

**Question.** Ordered list, DAG, Mermaid, or hybrid?

**Alternatives.** Ordered list only; graph without sequence; canonical generated Mermaid; typed DAG with deterministic display order.

**Chosen.** Typed DAG is validity authority. A version also stores its deterministic sequence positions. Manual drag/reorder is allowed only within dependency-safe bounds; conflicts return `order_conflict` with earliest/latest valid position. Kahn's algorithm validates cycles and dangling references instead of appending cyclic nodes. Comparator is ascending previous/manual position, then normalized title, then stable node id.

**Reasoning.** Learners need a comprehensible path; editing must not permit studying a dependent before a required prerequisite. Graph and sequence serve different purposes.

**Tradeoffs / consequences.** Exact absolute lock position can become impossible after a regeneration. The draft records the actual position and an explicit lock conflict; it never discards the lock or publishes silently. Cycles and unknown endpoints fail the edit/draft batch.

**Evidence.** Existing `generateLearningPathTopology` ignores dangling/cyclic cases. LearnHarness contributes only the general cycle-rejection idea.

**Changes.** 1, 2, 7.

## ADR-06 — Version drafts; explicit acceptance; stable logical node ids

**Question.** Mutate plans in place, snapshot every keystroke, or separate draft and published versions?

**Alternatives.** In-place editing; a version per save operation; durable draft plus explicitly published immutable version.

**Chosen.** A plan can have one durable working draft. Saves persist that draft across restart; Publish atomically appends a version and advances the head. AI generation always targets a new draft based on the accepted head. Publishing maps regenerated nodes to existing node ids by app-computed semantic key; included=false tombstones prevent removed topics returning. Optimistic `expectedPlanRevision` prevents stale acceptance.

**Reasoning.** Restart-safe editing and reviewable AI diffs do not require a version for every keystroke. Explicit acceptance preserves user control.

**Tradeoffs / consequences.** Rollback means copying an old version into a new draft, not rewinding migration/history. Existing attempts continue to pin their source blueprint regardless of plan head movement.

**Evidence.** Canonical adaptation requirement; static version field currently has no history.

**Changes.** 1, 2, 3.

## ADR-07 — Durable StudySourceRef validates live evidence and preserves history

**Question.** Reuse card envelope/chunk id verbatim or introduce a study-evidence envelope?

**Alternatives.** `CardSourceReference`; bare semantic chunk id; new versioned reference reused by plans and questions.

**Chosen.** New `StudySourceRefV1` stores document id, revision, verified excerpt/hash, optional cache chunk coordinates and optional `ExactSearchHitLocation`/extract id. Creation/update resolves live records and validates exact text and per-kind locator fields. A list supports multi-document evidence. Historical refs are retained without a document FK cascade; navigation rechecks and reports `current`, `stale`, `missing`, `ambiguous` or `unsupported`.

**Reasoning.** Existing card references are single-document and shallowly parsed. Chunk ids change with text and the index is a cache. Exam history must survive source deletion without falsely claiming navigability.

**Tradeoffs / consequences.** Stores bounded excerpts locally. This aids offline review but is not secure encryption. Local video requires extract-focused navigation; generic video initial jump is not assumed.

**Evidence.** `cardSourceReference.ts`; `searchHit.ts`; `openDocumentAtLocation.ts`; `openLibrarySource.ts`; `DocumentViewer.tsx`; `ai_learning/chunker.rs`; coverage source-hydration patterns.

**Changes.** 1–8.

## ADR-08 — Bounded staged generation with a rules-only fallback

**Question.** Whole-document prompt, agent loop, or staged task pipeline?

**Alternatives.** One large prompt; learning-agent tools; typed task batches over frozen scope.

**Chosen.** Freeze resolved source ids/revisions; retrieve bounded evidence with document filters; decompose in batches; reconcile deterministically; infer handle-bound prerequisites; validate and preview; publish explicitly. Maximum 24 documents, 12 decomposition seeds, 96 evidence hits, 24 topics; concurrency two retrieval calls and one AI call per job. No whole textbook prompt. Without AI, confirmed concepts and source inventory produce a labelled outline with no inferred edges/rationales.

**Reasoning.** Learning-agent budgets (12k transcript chars, 60-second run, 20 proposals) do not fit durable exams/curricula. Staged batches checkpoint meaningful progress and expose omissions.

**Tradeoffs / consequences.** Retrieval is not exhaustive; index incompleteness and sampling limitations are visible. No unsupported topic is hidden to make coverage appear complete.

**Evidence.** `retrieveFromLibrary(query,{k,filters})`; `runTask`; learning-agent `bounds.ts`/`loop.ts`; coverage concurrency/budgets.

**Changes.** 2; reused by 3 and 5.

## ADR-09 — Narrow persisted Study Generation Jobs, not a generic framework

**Question.** Inline only, reuse transcription tables, or new general worker?

**Alternatives.** Process-local runTask only; stretch a domain queue; narrow job/step ledger.

**Chosen.** `study_generation_jobs` and `_steps` support only `curriculum`, `assessment-generation`, and `exam-grading`. Rust owns lease, cancellation epoch, checkpoints and transitions. Startup marks expired/nonterminal runs `interrupted`; the user explicitly resumes. Per-step `(job_id,step_key)` and input hashes make completion idempotent. No automatic cloud/paid resume.

**Reasoning.** Existing transcription/session/language systems prove patterns but are not reusable generic APIs. A narrow ledger meets restart recovery without app-wide infrastructure risk.

**Tradeoffs / consequences.** This is at-least-once model execution, not exactly-once billing. Commits are idempotent; the UI discloses that retries can invoke inference again.

**Evidence.** `transcription/auto_queue.rs` startup reset/leases; `SessionAnalysisCoordinator` per-unit input hash checkpoints; `languageProcessing/runtime.ts` explicit resume. None is a general production service.

**Changes.** 2 owns; 3 and 5 reuse; 8 qualifies.

## ADR-10 — Fixed assessment artifacts with immutable revisions

**Question.** Adaptive mid-session exam or fixed previewable paper/question bank?

**Alternatives.** Adaptive paper; fixed blueprint revision with stable question revisions; disposable model transcript.

**Chosen.** A blueprint container owns immutable ready revisions. Every attempt pins its blueprint revision and ordered question revision ids. Editing/generation creates a new draft revision. Publication commits answer keys and rubrics and installs update/delete immutability triggers. A retake can intentionally reuse the same paper; a new follow-up suppresses near duplicates.

**Reasoning.** Stable papers support preview, precommitment, recovery and meaningful same-paper comparison. Practice adaptation does not require changing exam schemas.

**Tradeoffs / consequences.** Same-paper improvement can include memory of questions and is labelled accordingly. Cross-paper comparison is descriptive, not causal.

**Evidence.** User requirements for configurable length/preview/retake; existing recall fingerprint precedent; LearnHarness only supplies general commit-before-pose ideas.

**Changes.** 3, 4, 5, 7.

## ADR-11 — One question model; discriminated public/private payloads

**Question.** Reuse `learning_items` or Learn This candidate union?

**Alternatives.** Exam questions as scheduled cards; extend the card union with many optional fields; independent typed question revision union sharing cloze validators.

**Chosen.** Exam-owned discriminated union with five kinds and typed response per kind. `SingleSelect`/`MultiSelect` use app-assigned option ids; cloze uses text/blank segments and per-blank accepted lists; short answer has committed reference/key facts/rubric; essay has expected reasoning/analytic rubric. `PublicQuestion` omits keys, accepted answers, reference solutions, rubric levels that reveal expected reasoning, and explanations where appropriate. Local storage is not cryptographic secrecy.

**Reasoning.** Card entities immediately become FSRS units and cascade with sources. Exam-specific validity and history need independent ownership. Gradeability and source validation can still reuse independent implementations of existing cloze grounding rules.

**Tradeoffs / consequences.** A conversion/preview adapter is required for optional card proposals. No exam write calls card creation.

**Evidence.** `learning_items` scheduling fields/cascades; `learningMaterial.ts`; existing MCQ flashcard support; review deterministic predicates; review `AnswerAssessment`.

**Changes.** 3, 4, 5, 7.

## ADR-12 — Deterministic scoring policy is exact and documented

**Question.** Which grading mode and partial-credit rules?

**Alternatives.** Model everything; fuzzy everything; exact deterministic objective scoring plus AI rubric scoring.

**Chosen.** Single-select exact option id; multi-select all-or-nothing exact set; cloze Unicode NFKC/trim/whitespace/case policy with exact accepted alternatives and equal per-blank credit. Blank/skipped objective answers score zero but retain distinct outcomes. No negative marking. Nonblank short/essay use criteria; blank responses score zero without inference. Non-exact short answers and essays with no provider remain needs-grading/manual, never auto-wrong. Final attempt points are a deterministic sum, rounded half-up to two decimals only for presentation.

**Reasoning.** Model confidence or fuzzy similarity must not overturn a committed key. Equal cloze credit is explainable and sufficient. Short-answer semantic paraphrase legitimately needs inference/manual review.

**Tradeoffs / consequences.** Multi-select has no partial credit; UI states this before submission. Existing `normalizeAnswer` strips punctuation and fuzzy thresholds are deliberately not reused for exam cloze correctness.

**Evidence.** `reviewInteractions.ts`; existing single-select ReviewCard; canonical `AnswerAssessment` validator.

**Changes.** 3 validates; 4 implements objective; 5 implements rubric.

## ADR-13 — Analytic committed rubrics; application computes points

**Question.** Holistic 0–100 model score, reusable concept rubric, or per-question analytic rubric?

**Alternatives.** Holistic score; global reusable rubric library; committed per-question analytic rubric.

**Chosen.** Each short/essay revision owns criteria with independent level descriptors 0–4 and positive integer weights. Model output must contain each criterion exactly once with a level, exact learner-answer evidence and valid source handles. Application calculates `normalized = Σ(weight × level / 4) / Σ(weight)`; points = normalized × maxPoints. Existing `AnswerAssessment` supplies classification, feedback, missing concepts, misconception and self-reported confidence, but its `score`/`completeness` are not authoritative numeric exam points.

**Reasoning.** Criterion-level judgments are inspectable and deterministic aggregation prevents arbitrary model totals. Per-question rubrics are smaller and safer than a reusable rubric subsystem.

**Tradeoffs / consequences.** More generation/validation tokens and grading still requires real-model quality evaluation. A fallback/non-reasoning or internally contradictory result is `needs-review`, not silently final. Model self-confidence is never interpreted as calibrated probability.

**Evidence.** `answerAssessment.ts`; `assessmentTask.ts`; native Kotlin schema means the existing envelope must be composed, not silently extended.

**Changes.** 3, 5, 6, 8.

## ADR-14 — Responses persist before grading; attempt CAS and append-only grades

**Question.** Store only final answers/grades or durable attempts/drafts/submissions?

**Alternatives.** UI-only session; card `answer_assessments`; exam-owned durable state.

**Chosen.** Attempt starts InProgress; current responses save transactionally before UI confirmation. Submission writes an immutable response-submission row per item and objective grades in one transition. Subjective grading happens afterward. Current grade pointers change transactionally; every AI retry/manual correction is a new grade row linked by `supersedes_grade_id`. `expectedAttemptRevision`, client mutation id and submission idempotency key prevent duplicate/racing writes.

**Reasoning.** Provider failure cannot erase learner work, and review-table fire-and-forget behavior is inappropriate for authoritative exams. Separate tables preserve FSRS isolation and calibration populations.

**Tradeoffs / consequences.** More rows and deliberate lifecycle queries. Deleting a ready blueprint with history archives rather than destroys it.

**Evidence.** `answer_assessment.rs`; `answerAssessmentIntegration.ts`; review result id mismatch; existing acceptance idempotency patterns.

**Changes.** 4, 5, 7.

## ADR-15 — Timer uses a durable deadline; untimed is default

**Question.** Persist a ticking counter, pause in background, or wall-clock deadline?

**Alternatives.** Interval-based counter; pause whenever hidden; durable UTC deadline.

**Chosen.** Untimed default. A configured exam stores `deadline_at` at Start. Time continues across restart/suspension; UI derives remaining time from clock, warns before enabling, and reconciles an expired attempt on resume. Debounced saves plus navigation/blur/mobile lifecycle flushes persist confirmed responses. No claim is made for unconfirmed keystrokes. Practice has no deadline.

**Reasoning.** Durable deadline avoids timer drift and duplicate submission. Pausing silently would undermine configured limits and complicate lifecycle semantics.

**Tradeoffs / consequences.** Device clock manipulation is not adversarially prevented on local-first devices. Mobile/accessibility qualification is mandatory.

**Changes.** 4, 8.

## ADR-16 — Evidence states, not a false mastery probability

**Question.** Blend coverage, reading, FSRS retrievability and model confidence into mastery, or restrict the claim?

**Alternatives.** Arbitrary weighted mastery percent; Bayesian model presented as calibrated; deterministic demonstrated-performance summary and qualitative evidence state.

**Chosen.** Canonical `knowledge-gap-detection` mastery requirement is modified in Change 6. `ConceptMasterySummary` uses `insufficient-evidence`, `needs-attention`, `developing`, or `demonstrated-consistently`; `observedMean` is explicitly weighted observed performance, not probability of knowing. Evidence grouping, same-question penalties, hint/AI weights and recency are fixed by `evidence-v1`. Uncertainty is represented by independent group counts, spread, recency and explicit reason codes. Reading and `EvidenceCoverage` remain separate; FSRS user ratings/lapses support gap rules but never become an exam score or automated scheduler input.

**Reasoning.** There is no calibration corpus to justify a probability of mastery or a numerical blend with content coverage. Transparent deterministic classifications are useful and contestable now.

**Tradeoffs / consequences.** Existing spec language about blending retrievability/coverage is intentionally corrected. Later psychometric models need separate calibrated evidence and versioning. Improvement is reported as observed score/history, not proof of learning causation.

**Evidence.** `coverage.ts` doctrine; knowledge-gap types are unused; no existing mastery implementation or evaluation corpus.

**Changes.** 6, 7, 8.

## ADR-17 — Evidence updates on assessment settlement; no background gap watcher

**Question.** Continuous background inference, idle jobs, or deterministic post-settlement analysis?

**Alternatives.** Always-on watcher; generic idle AI analysis; local incremental fold after grading/manual settlement.

**Chosen.** Append evidence when a response submission receives a final deterministic/AI/manual grade. Recompute affected concepts synchronously under `evidence-v1`; optional historical review/reading gap scan is explicit, local and chunked. Never interrupt reading/review and never require AI for gaps.

**Reasoning.** This satisfies actionable, current evidence without building a background surveillance system or invoking cloud models. Existing canonical background wording is modified accordingly.

**Tradeoffs / consequences.** Non-assessment gap kinds can be stale until the user refreshes their evidence. UI shows last computed time and reason.

**Evidence.** Existing no-producer knowledge gap store; narrow job constraints; canonical no-mid-session requirement.

**Changes.** 6, 8.

## ADR-18 — Diagnostics and practice reuse assessment infrastructure

**Question.** Separate probe/practice engines or blueprint/attempt modes?

**Alternatives.** Separate diagnostic artifacts; tutor-only practice; shared schemas with three modes.

**Chosen.** `AssessmentMode = exam | practice | diagnostic`. Change 3 recognizes the mode contract but exposes ordinary exam generation; Change 4 implements basic practice feedback; Change 7 owns diagnostic creation and plan adaptation. Diagnostic is optional, 4–12 objective or short items, default 6. Skip creates no ghost attempt/evidence. A completed diagnostic supplies a read-only evidence projection to a new curriculum draft only after user action.

**Reasoning.** No duplicate question/attempt/grading engines and no forward dependency from Change 2. Practice changes reveal/feedback/retry policies only.

**Tradeoffs / consequences.** Diagnostic estimation remains subject to same evidence limitations and is not a placement guarantee.

**Evidence.** Shared fixed-paper architecture; existing tutor does not grade answers; LearnHarness diagnostic concept only.

**Changes.** 3, 4, 6, 7.

## ADR-19 — Reuse Tutor with explicit filtered retrieval injection

**Question.** Pass a document label only, extend tutor materially, or build a new tutor?

**Alternatives.** Current global retrieval; new study tutor; small host/runtime source-scope extension.

**Chosen.** Add optional `sourceDocumentIds`/`studyContext` host input and pass a `TutorRuntime.retrieve` closure that calls `retrieveFromLibrary(query,{k,filters:{documentIds}})`. Material contains only bounded validated excerpts plus objectives/evidence summary. Existing policy state machine, hints, escape hatch and card promotion remain authoritative.

**Reasoning.** `documentId` currently changes source-note text but does not scope retrieval. Runtime injection is already the clean seam and avoids global-library leakage.

**Tradeoffs / consequences.** Tutor transcripts remain non-authoritative and do not directly become mastery evidence; assessed practice supplies performance evidence.

**Evidence.** `TutorSessionConfig`, `TutorRuntime`, `TutorSession.start`, `TutorSheetProps` and start call.

**Changes.** 7.

## ADR-20 — Explicit endpoint-aware privacy and provider quality degradation

**Question.** Does provider kind or requestPolicy prove safety and capability?

**Alternatives.** Trust `providerKind`; treat `LlmRequestPolicy` as consent; separate destination/privacy and task-quality policy.

**Chosen.** Preflight resolves and freezes provider, endpoint destination generation and embedding, feature activation, document `isAiExcluded`/`isLocalOnly`, strict-local-only, cloud disclosure and paid consent. LAN/remote/unknown endpoints send off-device; provider labels do not override this. No silent paid/cloud fallback. `runTask`'s allowed fallback can only reuse a preauthorized route. Every preview shows what source excerpts/answers will leave. Reasoning fallback outputs requiring nuanced grading are marked needs-review until the user confirms.

**Reasoning.** Verified `LlmRequestPolicy` is numeric budget metadata; task result also collapses local-model provider kind. Quality capabilities cannot be inferred from text-generation support alone.

**Tradeoffs / consequences.** Some providers cannot complete advanced workflows; saved artifacts still function. Live real-model qualification is separate from fake-provider unit tests.

**Evidence.** `api/llm/policy.ts`; `features/destinations.ts`; `assistant/privacyGate.ts`; `tasks/runTask.ts` and router.

**Changes.** 2, 3, 5, 7, 8.

## ADR-21 — Preserve source/exam history; plan deletion detaches assessments

**Question.** Cascade source deletion and plan deletion or preserve artifacts?

**Alternatives.** Card-like cascade; orphan records without status; preserved immutable history with resolution states.

**Chosen.** Source refs keep historical ids/excerpts and no document FK cascade. Plans own versions/nodes; deleting a plan removes those and its activity but sets blueprint `plan_id` to null and keeps blueprint revisions/questions/attempts/evidence. Hard-delete a blueprint only before attempts; otherwise archive. Permanent exam-history deletion is an explicit user action cascading responses, submissions, grades, evidence links and unused refs, never library or scheduled cards. User remediation cards have independent normal lifecycle.

**Reasoning.** Audit/history and user deletion rights require deliberate lifecycle boundaries, not inherited card cascades.

**Tradeoffs / consequences.** Deleted-source excerpts remain in exam history until the user deletes the artifacts; privacy UI must explain and offer deletion.

**Evidence.** learning_items document/extract cascade; graph orphan-mark spec is not a general implementation; full DB backup behavior.

**Changes.** 1, 3–6, 8.

## ADR-22 — Native supported artifact store; fail honestly elsewhere

**Question.** Automatically support browser/PWA because `invokeCommand` has a browser backend?

**Alternatives.** Assume fallback; add IndexedDB parity; gate native artifact workflows and disclose unsupported browser behavior.

**Chosen.** Native Tauri desktop/mobile SQLite is required. Browser/PWA renders an unsupported/persistence-unavailable state for Study Plans write flows, not a false success from unknown-command defaults. No new IndexedDB authority is built. Responsive/mobile UI is still required on supported native platforms.

**Reasoning.** Unknown browser commands can return null/arrays/undefined; a second storage backend would double migration and consistency scope.

**Tradeoffs / consequences.** Browser-only users cannot use durable Study Plans in this program. Release qualification explicitly demonstrates refusal rather than data loss.

**Evidence.** `src/lib/browser-backend.ts` default unknown-command behavior; native command/migration conventions.

**Changes.** 1 and 8.
