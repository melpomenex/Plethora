# Feature-Gap Matrix — 40 Capabilities

**Plethora commit:** `340661b2c5a42bf0c2a8fb7d5a5d384f3ef04481`
**LearnHarness commit:** `da08cb5f7d098598ba963c6689b22054c9f2a5a3`

### Legend

**Status:** `IMPLEMENTED` · `PARTIAL` · `SCAFFOLD-ONLY` · `ABSENT` · `SPEC-ONLY`
**Confidence:** `VERIFIED` (read in source) · `PARTIALLY VERIFIED` · `SPEC-ONLY` · `NOT FOUND` (scope stated) · `INFERENCE`

**Important framing:** Plethora already has **deep, well-built** source grounding, retrieval, coverage, concept-graph, task-layer, flashcard-generation, and free-response-assessment infrastructure. The gap is **not** in the AI plumbing — it is in the **artifact layer**: persistent curricula, exam blueprints, question banks, attempts, rubrics, and mastery estimation.

---

## 1. Study goals

| Field | Value |
|---|---|
| **Status** | **PARTIAL** |
| **Existing code path** | `src/types/learningPaths.ts:4-14` `LearningGoal {id,title,description?,scope?:{collectionIds?,tagIds?},status,createdAt}`. `src/stores/learningPathsStore.ts:39-50` `createGoal` (localStorage). Transient goal primitive: `src/lib/daqe/sessionGoal.ts` — `normalizeSessionGoal` (43), `MAX_SESSION_GOAL_LENGTH = 200`, `MAX_RECENT_GOALS = 5`. |
| **Related OpenSpec** | `adaptive-learning-paths` (spec req. *"Goals are first-class and scoped"*); `add-dynamic-adaptive-queue-engine` (session goal). |
| **Reusable infrastructure** | `normalizeSessionGoal` / `validateSessionGoal` (refusal-not-truncation doctrine); `LearningGoal` shape; `RetrievalResponse` for scope resolution. |
| **Missing behaviour** | Persistence in SQLite (currently localStorage); scope resolution (collections/tags → concept set); goal↔path history; multiple concurrent goals; user editing of goal text. |
| **Risks** | Two goal concepts would collide (session goal vs study goal). A goal in localStorage is lost on reinstall and never backed up or synced. |
| **Confidence** | **VERIFIED** |

## 2. Source selection

| Field | Value |
|---|---|
| **Status** | **IMPLEMENTED** (for retrieval), **ABSENT** (for study-artifact authoring) |
| **Existing code path** | `src/api/ai-learning.ts` — `retrieveFromLibrary(query, k)`, `getAIIndexStatus()`. `src-tauri/src/ai_learning/retrieval.rs` (semantic + lexical fallback + prefilter). `src/components/graph/GraphFilters.tsx`. `src/components/tabs/DocumentQASources.tsx`. |
| **Related OpenSpec** | `ai-library-rag`, `ai-semantic-index`, `document-qa-study-artifact-generation`. |
| **Reusable infrastructure** | The whole retrieval stack; `CoverageEvidenceRef` (multi-kind anchors). |
| **Missing behaviour** | A **user-facing document/collection selection surface for curriculum + exam scope** (as opposed to ad-hoc retrieval). No concept set can be frozen as "the material for this plan". |
| **Risks** | Retrieval is *semantic* — a curriculum needs a *stable, user-approved set*. Silently re-retrieving changes the curriculum. |
| **Confidence** | **VERIFIED** |

## 3. Source-grounded concept extraction

| Field | Value |
|---|---|
| **Status** | **PARTIAL** |
| **Existing code path** | `src/lib/ai/tasks/definitions/prerequisiteTask.ts` (proposes concepts + `why`); `relationshipTask.ts` (typed relations over handle-bound evidence); `src/lib/ai/concepts/coverage.ts` (deterministic evidence resolution). Rust: `concept_links.rs` (16 commands), `concepts`/`concept_links` tables (`migrations.rs:2773-2800`). |
| **Related OpenSpec** | `ai-knowledge-relationships`, `complete-knowledge-relationships-and-coverage` (16/16). |
| **Reusable infrastructure** | The **extract → validate → merge** shape; handle-bound model output (`MAX_RELATIONSHIP_HANDLES = 24`); `provenance_json` on links; `confidence` on links. |
| **Missing behaviour** | **No proposition extraction** (LearnHarness's `GraphNode.statement` analogue). Plethora's concepts are *named* entities with relations, not *propositions* with statements. No "this concept is stated in this passage" record. Coverage computes "is this phrase present", not "what does this source claim about X". |
| **Risks** | A curriculum node needs a **statement/description** to be examinable. `concepts.description` exists but is not populated by extraction. |
| **Confidence** | **VERIFIED** |

## 4. Prerequisite inference

| Field | Value |
|---|---|
| **Status** | **IMPLEMENTED** |
| **Existing code path** | `prerequisiteTask.ts` (task `prerequisite-analysis`, full class, 60 s, 900 tokens, 1-8 prerequisites, schema-validated, empty list allowed). Persisted as `concept_links` with `relation_type = 'prerequisite-of'`, `confidence`, `provenance_json`, propose→accept/dismiss lifecycle (`concept_links.rs:222-318`). Production caller: `SelectionActionsSheet.tsx:469`. |
| **Related OpenSpec** | `ai-knowledge-relationships` req. *"Prerequisite inference"*. |
| **Reusable infrastructure** | The task, the schema, the Rust lifecycle, the accept/dismiss UI. |
| **Missing behaviour** | Prerequisite edges exist **per concept**, not **per curriculum node**; there is no cycle rejection at the curriculum level; `LearningPathNode.prerequisiteNodeIds` is never populated. |
| **Risks** | `generateLearningPathTopology` (`src/types/learningPaths.ts:45`) **silently ignores cycles** (appends the remainder) and **silently ignores dangling prerequisite ids** — a curriculum built on it could order incorrectly without any signal. |
| **Confidence** | **VERIFIED** |

## 5. Diagnostic assessments

| Field | Value |
|---|---|
| **Status** | **PARTIAL** (the *prompt* pipeline is production-wired; the *diagnostic artifact* does not exist) |
| **Existing code path** | **Recall prompt flow — VERIFIED production-wired in the reader:** `src/components/viewer/useRecallPrompts.ts` (hook), `src/components/viewer/RecallPromptOverlay.tsx` (overlay), `src/components/viewer/DocumentViewer.tsx` (host), `src/components/viewer/recallChunkSampling.ts` (chunk sampling). Task: `src/lib/ai/tasks/definitions/recallTask.ts` (`recall-question`, 45 s, 350 tokens). Dedup + history: `recall_prompt_history` table (`migrations.rs:2803-2815`, with `fingerprint`, `chunk_ids`, `outcome`) + `src-tauri/src/commands/recall_history.rs`. Tutor probing is *conversational only* (`src/lib/ai/tutor/session.ts` — *"Nothing here grades answers"*). |
| **Related OpenSpec** | `ai-active-recall` (6 requirements, all implemented), `ai-socratic-tutoring`. |
| **Reusable infrastructure** | **The whole recall pipeline is the closest existing end-to-end precedent for this feature:** generate a question from source → dedupe by fingerprint → present → feedback → record the outcome → optionally promote to a durable card (`ai-active-recall` req. *"Promotion to durable card"*). Also the tutor's `stuckDetected` signal. |
| **Missing behaviour** | **No pre-test diagnostic.** No baseline assessment that determines where a learner stands before a curriculum starts. No persisted diagnostic result set. No diagnostic *artifact* (a recall prompt is transient and reading-interrupting). |
| **Risks** | LearnHarness's `probe_done` assessment (floor/ceiling/misconceptions per strand) is a **good model** (`src/agent/tools/probe.ts`, `src/core/contracts/probe.ts:47-72`) but has **no Plethora equivalent**. Also note the `ai-active-recall` req. *"Interruption budget"* — the recall flow is deliberately low-friction; a formal diagnostic exam must not inherit that interruption pattern. |
| **Confidence** | **VERIFIED** (production wiring confirmed by call-site search excluding tests) |

## 6. AI curriculum generation

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | **NOT FOUND.** Search scope: `src/`, `src-tauri/src/` for `curricul*` → 1 file (`src/types/paywall.ts`, a tier name). `path-generation`/`pathGeneration` → 0 hits. `plan-generation` → 0 hits. |
| **Related OpenSpec** | `adaptive-learning-paths` (spec-only), archived `implement-plethora-ai-generated-adaptive-learning-paths` (STALE-COMPLETE). |
| **Reusable infrastructure** | The task layer (`runTask`), concept graph, coverage runner, prerequisite inference, `reasoningFallback` pattern. |
| **Missing behaviour** | Everything: topic decomposition, node generation, rationale generation, objective mapping, node↔source assignment, material-gap detection, ordering. |
| **Risks** | The archived change's `[x]` checkboxes will mislead any agent that reads them. |
| **Confidence** | **VERIFIED** (absence established) |

## 7. Curriculum editing

| Field | Value |
|---|---|
| **Status** | **SCAFFOLD-ONLY** |
| **Existing code path** | `src/stores/learningPathsStore.ts:86-107` `reorderNodes` (sets `isUserModified: true`). Nothing else. No add/remove/skip/lock. No UI. |
| **Related OpenSpec** | `adaptive-learning-paths` req. *"Adaptation preserves user modifications"* + *"Locked node survives re-planning"*. |
| **Reusable infrastructure** | The `isUserModified` flag concept. |
| **Missing behaviour** | All editing operations, all UI, all persistence, lock semantics, diff review. |
| **Risks** | `reorderNodes` **drops nodes not present in `orderedNodeIds`** (it rebuilds `newNodes` only from the supplied ids) — a partial reorder silently deletes nodes. |
| **Confidence** | **VERIFIED** |

## 8. Curriculum persistence

| Field | Value |
|---|---|
| **Status** | **PARTIAL (wrong medium)** |
| **Existing code path** | `src/stores/learningPathsStore.ts:123-131` — `persist` + `createJSONStorage(() => localStorage)`, key `plethora-learning-paths`. |
| **Related OpenSpec** | `adaptive-learning-paths`; backup specs. |
| **Reusable infrastructure** | The `LearningGoal`/`LearningPath`/`LearningPathNode` shapes. |
| **Missing behaviour** | SQLite tables, foreign keys to `documents`/`concepts`, sync/backup participation, cross-device, transactional updates. |
| **Risks** | localStorage ⇒ **not backed up, not synced, lost on reinstall**, and invisible to the deletion-cascade semantics that govern the rest of the app. A parallel SQLite store must **replace** this, not sit beside it. |
| **Confidence** | **VERIFIED** |

## 9. Curriculum versioning

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | `LearningPath.version` is set to `1` at creation (`learningPathsStore.ts:58`) and **never incremented**. No diff type, no history table. |
| **Related OpenSpec** | `adaptive-learning-paths` req. *"Adaptation preserves user modifications"* — *"SHALL produce a new version with a reviewable diff… Acceptance of a new version is explicit."* |
| **Reusable infrastructure** | The `version` field exists (semantically right, numerically inert). |
| **Missing behaviour** | Version history, diff computation, explicit acceptance, user-modification preservation across regeneration. |
| **Risks** | The `version` field being present-but-inert is a trap: an agent may read it as "versioning exists". |
| **Confidence** | **VERIFIED** |

## 10. Material coverage analysis

| Field | Value |
|---|---|
| **Status** | **IMPLEMENTED — and this is Plethora's strongest asset** |
| **Existing code path** | `src/lib/ai/concepts/coverage.ts` — `COVERAGE_POLICY_VERSION = "coverage-v1"`, `EvidenceCoverage = unknown\|not-covered\|partial\|supported`, `CoverageActivity = none\|encountered\|studied\|reviewed`, `IndexCompleteness = complete\|partial\|unavailable`, `COVERAGE_LIMITATIONS` (16 keys), `CoverageLocator` (4 kinds), `CoverageEvidenceRef` (with `sourceRevision`), `MAX_COVERAGE_CONCEPTS = 12`, `COVERAGE_RETRIEVAL_K = 6`, `COVERAGE_QUERY_CONCURRENCY = 2`. |
| **Related OpenSpec** | `ai-knowledge-relationships` req. *"Evidence-based coverage with hedged language"*; `complete-knowledge-relationships-and-coverage` (16/16, **"without claiming mastery"**). |
| **Reusable infrastructure** | **The entire module.** |
| **Missing behaviour** | Nothing for *content* coverage. The coverage runner is per-concept; it does not yet produce a **plan-level coverage report** ("which plan nodes have no supporting material?"). |
| **Risks** | Coverage is **content**, not mastery. Any exam feature that conflates them violates an explicit, deliberate doctrine. |
| **Confidence** | **VERIFIED** |

## 11. Topic progress

| Field | Value |
|---|---|
| **Status** | **PARTIAL (type only)** |
| **Existing code path** | `PathNodeStatus = 'pending'\|'active'\|'completed'\|'skipped'` + `updateNodeStatus` (`learningPathsStore.ts:73-84`). `LearningPathNode.estimatedMasteryStart` / `targetMastery` (0-1) exist as **type fields only** — never computed, never written. |
| **Related OpenSpec** | `adaptive-learning-paths` req. *"Progress is signal-based and honest"* — *"Path completion SHALL require terminal-node target mastery (estimate-based) or explicit user declaration — never inflated by activity metrics alone."* |
| **Reusable infrastructure** | The status enum; the coverage `activity` axis as a *partial* progress signal. |
| **Missing behaviour** | Any producer of node status; any mapping from learning signals to node progress; any "reading ≠ mastery" separation at the node level. |
| **Risks** | The spec explicitly forbids inflating progress with activity metrics. The coverage module's `activity` axis must **not** be used as a mastery proxy. |
| **Confidence** | **VERIFIED** |

## 12. MCQ generation

| Field | Value |
|---|---|
| **Status** | **PARTIAL** |
| **Existing code path** | `LEARNING_CARD_TYPES` includes `qa` (`learningMaterial.ts:33-44`) — free-form Q&A, **not** multiple choice. `recognition` cards (`recallQuestion.ts`) are also not MCQ. **No option-array MCQ generation anywhere.** |
| **Related OpenSpec** | `ai-learning-material-generation`, `design-source-grounded-ai-curricula-and-assessments` (cloze/QA validation only). |
| **Reusable infrastructure** | The whole task→schema→validate→preview→accept pipeline. |
| **Missing behaviour** | Option authoring, **option-distinctness validation**, **answer-key-by-value**, distractor quality rules, option shuffling. |
| **Risks** | LearnHarness's `quizInputProblems` (`src/core/question-core.ts:112-142`) is the reference implementation for making MCQ **gradeable by construction** — see `01-...md` §3.3. |
| **Confidence** | **VERIFIED** |

## 13. Multi-select generation

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | **NOT FOUND.** No multi-select concept in `src/` or `src-tauri/src/`. |
| **Related OpenSpec** | None. |
| **Reusable infrastructure** | The MCQ pipeline once it exists. |
| **Missing behaviour** | Multi-select authoring, the **exact-set-match** grader, and the validation rule that a multi-correct answer requires `multiSelect: true`. |
| **Risks** | LearnHarness's `isCorrect` (`question-core.ts:679-684`) is a 5-line exact-set match — trivial to port in spirit; but **partial credit must be deliberately decided** by Run B. |
| **Confidence** | **VERIFIED** (absence) |

## 14. Cloze generation

| Field | Value |
|---|---|
| **Status** | **IMPLEMENTED** |
| **Existing code path** | `LEARNING_CARD_TYPES` includes `cloze`; `LearningCardCandidate.clozeText` + `clozeRanges: Array<[number, number]>` (`learningMaterial.ts:63-82`); `extractClozeDeletion`; `checkCandidateGrounding` verifies the deletion appears **verbatim** in the source (`learnThisValidation.ts:101-108`); `clozeToCleanTextAndRanges`; `document-qa-study-artifact-generation` cloze-from-selection. |
| **Related OpenSpec** | `ai-learning-material-generation`, `document-qa-study-artifact-generation`, `design-source-grounded-ai-curricula-and-assessments` (task 1.1 — `validateGeneratedCard`, **not implemented**). |
| **Reusable infrastructure** | **Substantial and directly reusable.** |
| **Missing behaviour** | Cloze as an **exam** item type (grading, attempt persistence, scoring) — the *generation* exists; the *examination* lifecycle does not. |
| **Risks** | Cloze grading is deterministic (deletion match) — the easiest exam item type to implement correctly first. |
| **Confidence** | **VERIFIED** |

## 15. Short-answer generation

| Field | Value |
|---|---|
| **Status** | **PARTIAL** |
| **Existing code path** | `qa` card type with a text answer; `AnswerAssessment` grades free text. |
| **Related OpenSpec** | `ai-learning-material-generation`, `ai-answer-assessment`. |
| **Reusable infrastructure** | `AnswerAssessment` + `assess-answer` task. |
| **Missing behaviour** | A distinct short-answer item type (vs essay); scoring policy; point allocation. |
| **Risks** | Blurring short-answer and essay. Run B must define the boundary explicitly. |
| **Confidence** | **VERIFIED** |

## 16. Essay generation

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | **NOT FOUND.** `\bessay\b` → 0 files in `src/`/`src-tauri/src/`. |
| **Related OpenSpec** | None. |
| **Reusable infrastructure** | The task layer + `AnswerAssessment` grading shape. |
| **Missing behaviour** | Essay prompt authoring, rubric attachment, per-criterion scoring, holistic vs analytic scoring, max-points configuration. |
| **Risks** | Rubrics are the hardest part of the whole feature. See §25. |
| **Confidence** | **VERIFIED** (absence) |

## 17. Question validation

| Field | Value |
|---|---|
| **Status** | **PARTIAL (strong for cards, absent for exam items)** |
| **Existing code path** | `checkCandidateGrounding` (`learnThisValidation.ts:95-116`) — verbatim cloze + answer grounding score; `dedupeCandidates`; `validateLearningMaterialProposal` (`learningMaterial.ts:303`); `validateAnswerAssessment`; `validatePrerequisiteAnalysis`; `validateConceptRelationshipAnalysis`; `normalizeCardType` (off-enum healing); `DUPLICATE_SIMILARITY_THRESHOLD = 0.85`. |
| **Related OpenSpec** | `ai-learning-material-generation` req. *"Candidate validation"*; `design-source-grounded-ai-curricula-and-assessments` (tasks 1.1-1.3, **not implemented**). |
| **Reusable infrastructure** | **High.** The flagged-not-dropped candidate model is exactly right for exam questions. |
| **Missing behaviour** | Gradeability validation (a question whose answer key cannot be resolved must never reach the learner) — LearnHarness's `quizInputProblems` invariant *"schema-valid ⇔ gradeable"*. Option distinctness. Multi-source citation validity. |
| **Risks** | Without gradeability validation, an exam can contain **ungradable** questions. |
| **Confidence** | **VERIFIED** |

## 18. Answer-key commitment

| Field | Value |
|---|---|
| **Status** | **PARTIAL (for cards); ABSENT as a first-class mechanism** |
| **Existing code path** | `LearningCardCandidate.answer` is the answer key, stored alongside the card. `assess-answer` receives `expectedAnswer` at grading time. |
| **Related OpenSpec** | `ai-learning-material-generation`, `ai-answer-assessment`. |
| **Reusable infrastructure** | The candidate `answer` field. |
| **Missing behaviour** | **A precommitted, immutable answer key that is fixed before the learner sees the question and cannot be revised afterwards.** LearnHarness's principle: *"the commitment rides the persisted call args… never revise the commitment after seeing his words, and never mark a wrong answer right to be kind"* (`src/core/question-core.ts:310-314`). |
| **Risks** | **This is the highest-leverage single pattern to port from LearnHarness.** Without it, a model grading free response can rationalize a wrong answer as right. In Plethora, the commitment must be **mechanically** immutable (a stored row the grader cannot rewrite), not just prompt doctrine. |
| **Confidence** | **VERIFIED** |

## 19. Exam blueprint configuration

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | **NOT FOUND.** `blueprint` → 0 files repo-wide. |
| **Related OpenSpec** | None. |
| **Reusable infrastructure** | `CoverageAnalysisResult` limits (`MAX_COVERAGE_CONCEPTS = 12`, `COVERAGE_RETRIEVAL_K = 6`) show the house style for bounded scope. |
| **Missing behaviour** | Exam length; difficulty mix; source/coverage scope; per-format counts; per-node topic weights; time budget; pass threshold. |
| **Risks** | The user-facing requirement is *"customize length of exam amongst other things"*. This capability **is** that requirement. |
| **Confidence** | **VERIFIED** (absence) |

## 20. Exam preview / editing

| Field | Value |
|---|---|
| **Status** | **PARTIAL (pattern exists, exam instance does not)** |
| **Existing code path** | `src/components/learn/LearnThisProposalSheet.tsx` — the canonical preview/edit/accept/regenerate flow; `acceptLearnThis.ts`; `src/components/review/studio/DraftCardList.tsx`. |
| **Related OpenSpec** | `ai-learning-material-generation` req. *"Preview, edit, accept, reject, regenerate"*. |
| **Reusable infrastructure** | **The whole Learn This preview flow is the template** for exam preview. |
| **Missing behaviour** | An exam-level preview (all questions, blueprint summary, coverage distribution, time estimate) and per-question editing that re-validates. |
| **Risks** | `checkCandidateGrounding` is *"Exported for the preview UI's edit-time re-validation (a flagged candidate becomes acceptable once edited)"* — the same re-validation hook is needed for exams. |
| **Confidence** | **VERIFIED** |

## 21. Exam attempt persistence

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | `answer_assessments` table (`migrations.rs:2817`) — per-**item** rows with `item_id` + `review_result_id` (nullable, currently always `null`). **No attempt entity.** |
| **Related OpenSpec** | `ai-answer-assessment` req. *"Assessment persistence and provenance"*. |
| **Reusable infrastructure** | The `answer_assessments` schema pattern (id, timestamps, provider/model provenance). |
| **Missing behaviour** | Attempt entity (id, exam id, started/ended, item order, per-item answers, per-item scores, total score, status). Answers must be saved **before/independently of** grading so an interruption is recoverable. |
| **Risks** | `answer_assessments.item_id` references `learning_items` semantically — an exam attempt must **not** reuse that table (see FSRS isolation, §36). |
| **Confidence** | **VERIFIED** |

## 22. Exam interruption / recovery

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | **NOT FOUND.** No persisted in-flight work of any kind. `runTask` supports `signal` (cancellation) but persists nothing. |
| **Related OpenSpec** | None. |
| **Reusable infrastructure** | `runTask` `signal`/`timeoutMs`/`onChunk`/`onRetry`; `targetId` coalescing; the agent's `deadline.ts`. |
| **Missing behaviour** | Draft-answer persistence; resume an in-progress attempt; resume an interrupted generation. |
| **Risks** | **LearnHarness solved this well and portably:** *"Because the pending question IS a persisted message part, a session can be exited and resumed mid-question for free"* (`src/core/question-core.ts:16-17`), plus its `batchTag` idempotency key for crash-safe re-runs (`src/core/coverage.ts:188-192`). |
| **Confidence** | **VERIFIED** |

## 23. Deterministic grading

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | **NOT FOUND.** No deterministic grader in Plethora. `isCorrect` (LearnHarness `src/core/question-core.ts:679-684`) is the reference. |
| **Related OpenSpec** | None. |
| **Reusable infrastructure** | The `AnswerAssessment` **AI** grader exists; the deterministic path does not. |
| **Missing behaviour** | MCQ exact-match, multi-select exact-set-match, cloze deletion match, numeric/tolerance matching, blank handling. |
| **Risks** | **Highest-value, lowest-cost gap to close.** Deterministic grading removes the model from the correctness path entirely for the majority of exam items. |
| **Confidence** | **VERIFIED** (absence) |

## 24. AI-assisted grading

| Field | Value |
|---|---|
| **Status** | **IMPLEMENTED** |
| **Existing code path** | `src/lib/ai/tasks/definitions/assessmentTask.ts` — `assess-answer` (reasoning) + `assess-answer-full` fallback, 45 s, 900 tokens, adversarial-answer containment. `src/lib/ai/schemas/answerAssessment.ts` — fail-closed validator with `misconception`-requires-description. |
| **Related OpenSpec** | `ai-answer-assessment`. |
| **Reusable infrastructure** | **The whole thing.** |
| **Missing behaviour** | Grading **within an exam attempt** (currently it grades a single card answer in the review flow). |
| **Risks** | The `classification` enum (`correct\|partial\|incorrect\|misconception`) maps well onto gap detection — `misconception` is exactly the signal a "misconception tracking" feature needs. |
| **Confidence** | **VERIFIED** |

## 25. Rubric-based essay grading

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | **NOT FOUND.** The only `rubric` hits in `src/`/`src-tauri/src/` are DAQE's **ranking** rubric version (`src-tauri/src/models/daqe.rs:285` `RANKER_RUBRIC_VERSION: i32 = 2`) — unrelated to assessment. |
| **Related OpenSpec** | None. |
| **Reusable infrastructure** | `AnswerAssessment` for the verdict shape; the task layer for execution. |
| **Missing behaviour** | Rubric entity (criteria, weights, per-level descriptors, max points); rubric→assessment binding; per-criterion scoring; aggregation policy. |
| **Risks** | **The single hardest new subsystem.** Run B should consider: analytic vs holistic; fixed vs per-exam rubrics; model-generated vs author-provided rubrics; whether rubric criteria are themselves source-grounded. |
| **Confidence** | **VERIFIED** (absence) |

## 26. Grading provenance

| Field | Value |
|---|---|
| **Status** | **PARTIAL** |
| **Existing code path** | `answer_assessments.provider` + `.model` columns (`migrations.rs:2829-2830`); `AITaskResult.providerId` / `providerKind` / `requestedModelClass` / `servedModelClass` / `fallbackPath` / `validationOutcome` / `baseModelName` / `usage` (`src/lib/ai/tasks/types.ts:158-172`). |
| **Related OpenSpec** | `ai-answer-assessment` req. *"Assessment persistence and provenance"*. |
| **Reusable infrastructure** | **Strong.** `AITaskResult` is a richer provenance record than the DB currently stores. |
| **Missing behaviour** | Persisting the **full** task result (validation outcome, fallback path, model class, base model name) alongside the grade; the rubric/prompt version that produced the grade; the source citations used. |
| **Risks** | Without it, an exam result cannot be audited or reproduced. |
| **Confidence** | **VERIFIED** |

## 27. Manual grading correction

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | **NOT FOUND.** `answer_assessments` has no `corrected_by_user`/`user_override` column and no override command. |
| **Related OpenSpec** | None. |
| **Reusable infrastructure** | The `answer_assessments` insert path; the `concept_links` propose→accept/dismiss lifecycle pattern (a good precedent for "AI proposes, user disposes"). |
| **Missing behaviour** | A user override of an AI grade; a correction audit trail; the corrected value winning downstream. |
| **Risks** | **User control is an explicit requirement.** Without override, an AI grade is final — which contradicts the brief's *"preserving user control"*. |
| **Confidence** | **VERIFIED** (absence) |

## 28. Historical exam results

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | Only `get_answer_assessment_counts` (`answer_assessment.rs:193`) — a count, not a history. `src/components/analytics/` + `src/routes/analytics.tsx` exist for analytics generally. |
| **Related OpenSpec** | None directly. |
| **Reusable infrastructure** | The analytics UI surface; the DAQE snapshot/history pattern (`src/lib/daqe/snapshot.ts`). |
| **Missing behaviour** | An attempt-history list; per-topic trend; per-attempt score; comparison across attempts; export. |
| **Risks** | The requested *"reveals gaps in your knowledge"* and *"historical reporting"* both depend on this. |
| **Confidence** | **VERIFIED** |

## 29. Knowledge-gap identification

| Field | Value |
|---|---|
| **Status** | **PARTIAL (types + store, no engine)** |
| **Existing code path** | `src/types/knowledgeGaps.ts` — 6 `KnowledgeGapKind`s, `masteryEstimate`, `variance`, `GapEvidence[]` (kinds: `review_lapse\|unreviewed_reading\|graph_edge\|assessment`), `formatGapTitle`. `src/stores/knowledgeGapsStore.ts` — localStorage, `recordGap`/`dismissGap`/`resolveGap`, dedupe by `(conceptName, kind)`. **`recordGap` has ZERO production callers.** |
| **Related OpenSpec** | `knowledge-gap-detection` (6 requirements, **spec-only**). |
| **Reusable infrastructure** | The `KnowledgeGap` shape is **good** — it already encodes uncertainty (`variance`) and evidence. |
| **Missing behaviour** | The detection rules themselves; persistence in SQLite; UI; remediation routing; wiring to assessments. |
| **Risks** | The spec requires *"Detection SHALL be incremental background work under idle/battery gates"* — Plethora has **no general background-job facility** (see §7 of `02-...md`). |
| **Confidence** | **VERIFIED** |

## 30. Misconception tracking

| Field | Value |
|---|---|
| **Status** | **PARTIAL (a signal exists; no tracking)** |
| **Existing code path** | `ANSWER_CLASSIFICATIONS` includes **`"misconception"`** with a required `misconception` description and `suggestedCorrection` (`answerAssessment.ts:16, 26-28`); `answer_assessments.misconception` column. LearnHarness's practice `missClass` taxonomy (`cue\|discrimination\|execution\|careless\|structural`) is a richer alternative. |
| **Related OpenSpec** | `ai-answer-assessment`; `knowledge-gap-detection` (kind `weak_transfer`, `repeatedly_failed`). |
| **Reusable infrastructure** | The `misconception` field + `suggestedCorrection`; the coverage `direct`/`mention` strength distinction. |
| **Missing behaviour** | Misconception **aggregation** over time; per-concept misconception history; misconception→gap→remediation routing. |
| **Risks** | A misconception that is detected but never tracked is a lost signal. |
| **Confidence** | **VERIFIED** |

## 31. Mastery / uncertainty representation

| Field | Value |
|---|---|
| **Status** | **ABSENT** |
| **Existing code path** | **NOT FOUND.** No mastery table in `migrations.rs`; no mastery code in `src-tauri/src/`; `masteryEstimate` appears in `src/` only in `src/types/knowledgeGaps.ts:20` and `src/types/learningPaths.ts:24-25` (unpopulated type fields). |
| **Related OpenSpec** | `knowledge-gap-detection` req. *"Mastery estimates express uncertainty"* — *"blending FSRS retrievability, assessments, coverage, and recency… UI language SHALL remain probabilistic."* |
| **Reusable infrastructure** | The `CoverageActivity`/`EvidenceCoverage` split (coverage ≠ mastery); the `variance` field on `KnowledgeGap`; FSRS retrievability already computed for cards. |
| **Missing behaviour** | The estimator itself; persistence; uncertainty propagation; the probabilistic UI language. |
| **Risks** | **The largest new subsystem.** It must be **separate from coverage** — the `complete-knowledge-relationships-and-coverage` change explicitly excluded *"mastery scoring"* from its scope, and `coverage.ts` documents *"never reads a mastery score"*. |
| **Confidence** | **VERIFIED** (absence) — corroborated by `openspec/planning/ai-learning-completion-audit.md` |

## 32. Source-linked remediation

| Field | Value |
|---|---|
| **Status** | **PARTIAL** |
| **Existing code path** | `CoverageEvidenceRef` (multi-kind locators + `sourceRevision` + strength); `concept_links.provenance_json`; `coverage.ts` `staleSource`/`removedSource` limitations; `knowledge-graph` spec's orphan-mark rule; `openDocumentAtLocation` navigation via `ExactSearchHitLocation`. |
| **Related OpenSpec** | `knowledge-graph`, `ai-knowledge-relationships`, `knowledge-gap-detection` req. *"Actions route to concrete remediation"*. |
| **Reusable infrastructure** | **Strong** — the evidence → locator → navigate path already exists end-to-end. |
| **Missing behaviour** | Mapping a *gap* (or a failed exam item) to a **remediation action** and carrying the gap's evidence into that action (tutor / practice / cards / find-material). |
| **Risks** | The `knowledge-gap-detection` spec already enumerates the exact remediation set (Explain / Teach me / Find material / Generate practice / Make cards / Dismiss) — reuse it. |
| **Confidence** | **VERIFIED** |

## 33. Tutor integration

| Field | Value |
|---|---|
| **Status** | **IMPLEMENTED** (as a standalone feature) |
| **Existing code path** | `src/lib/ai/tutor/{session,context,lesson}.ts`; `src/components/tutor/TutorSheet.tsx`; hosts `SelectionActionsSheet.tsx` + `LanguageTutorHost.tsx`. Grounding: `retrieveFromLibrary(topic, k≈3)`, drift-triggered refresh (≤2). Policy: 8 ordered rules, `MAX_SESSION_TURNS`, `MAX_HINT_LEVEL`, escape hatch. |
| **Related OpenSpec** | `ai-socratic-tutoring`. |
| **Reusable infrastructure** | **The whole tutor.** |
| **Missing behaviour** | Launching the tutor **pre-loaded from a curriculum node or a failed exam item** (the spec's *"Teach-me carries context"* scenario). |
| **Risks** | The tutor's context builder takes a topic string + optional retrieved context — a curriculum node's `title`/`conceptId` + coverage evidence refs are sufficient inputs. |
| **Confidence** | **VERIFIED** |

## 34. Practice generation

| Field | Value |
|---|---|
| **Status** | **PARTIAL / ABSENT for Plethora** |
| **Existing code path** | Plethora has **no** practice-problem engine. Closest: `ai-active-recall` (reading-time recall prompts) and the `qa` card type. LearnHarness has a full one (`src/agent/tools/practice.ts`: `problem`/`conclude`, `mode: recall\|discrimination\|composition`, committed `modelSolution`, `rung` R0-R5, `missClass`, `retest`). |
| **Related OpenSpec** | `ai-active-recall`; `knowledge-gap-detection` (action *"Generate practice"*). |
| **Reusable infrastructure** | The task layer + the `AnswerAssessment` grader. |
| **Missing behaviour** | Everything on the Plethora side. LearnHarness's practice engine is a **strong reference** (commit-before-pose, hint ladder, miss classification, retest flag). |
| **Risks** | Practice could be over-built; the minimal viable version is "generate N questions on a weak concept + grade them" — which the exam machinery already provides. |
| **Confidence** | **VERIFIED** |

## 35. Flashcard suggestions

| Field | Value |
|---|---|
| **Status** | **IMPLEMENTED** |
| **Existing code path** | `learnThisTask` + `learnThisValidation` + `LearnThisProposalSheet` + `acceptLearnThis`; `src/components/assistant/LearningAgentProposals.tsx` (agent proposals); `src/components/assistant/chatFlashcardArtifacts.ts`; `src/components/review/studio/`; `src/lib/ai/cards/`. The tutor's `promoteToCard` move. `ai-socratic-tutoring` req. *"Grounding and learning-object conversion"*. |
| **Related OpenSpec** | `ai-learning-material-generation`, `ai-socratic-tutoring`, `ai-learning-agent`. |
| **Reusable infrastructure** | **Complete.** |
| **Missing behaviour** | A path from *exam results* to *suggested cards* (the brief: *"recommending additional studying, practice, and optional flashcards"*). The card pipeline exists; only the **trigger** is missing. |
| **Risks** | Cards created from exam results must respect **user approval** and **no silent mass creation**. |
| **Confidence** | **VERIFIED** |

## 36. FSRS isolation

| Field | Value |
|---|---|
| **Status** | **IMPLEMENTED (as a proven pattern)** |
| **Existing code path** | `src/components/review/answerAssessmentIntegration.ts:5-12` — *"Scheduler authority is preserved BY CONSTRUCTION… `recordCardAssessment` is a SEPARATE `record_answer_assessment` invoke fired after grading — it receives no scheduling inputs and touches no scheduling table. The `submitReview` call sequence is identical with or without an assessment present."* `computeSuggestedRating` (22) is advisory only; `shouldSuggestGrade` (36) requires `confidence ≥ 0.8`; `AUTO_GRADE_CONFIDENCE_THRESHOLD = 0.8` (19). `answer_assessments` has no FK to `learning_items`. |
| **Related OpenSpec** | `ai-answer-assessment` req. *"Scheduler authority is preserved"*. |
| **Reusable infrastructure** | The whole separation pattern. |
| **Missing behaviour** | Nothing — but the exam path **must** copy the pattern exactly. |
| **Risks** | **The single most important invariant.** If exam questions were stored as `learning_items`, they'd enter the scheduler. The exam attempt/question tables must be **completely separate** from `learning_items`, and grading must never write `interval`/`ease_factor`/`due_date`/`state`/`review_count`/`lapses`. Also note `learning_items` has `ON DELETE CASCADE` to `extracts`/`documents` — exam questions must define their **own** deletion semantics. |
| **Confidence** | **VERIFIED** |

## 37. Provider selection

| Field | Value |
|---|---|
| **Status** | **IMPLEMENTED** |
| **Existing code path** | `src/lib/ai/providers/` — `appleCoreAiProvider`, `appleFoundationProvider`, `cloudProvider`, `foundryLocalProvider`, `localModelProvider`, `onDeviceProvider`, `windowsSystemProvider`. `AIProviderKind = "ondevice"\|"cloud"\|"local-model"` (`providers/types.ts:123`). Router: `src/lib/ai/tasks/router.ts` — `fast`/`full`/`reasoning` classes + `reasoningFallback`. Per-task `requirement: OnDeviceRequirement`. |
| **Related OpenSpec** | `ai-task-architecture` req. *"Capability-aware availability"*. |
| **Reusable infrastructure** | The whole provider registry + task router. |
| **Missing behaviour** | Nothing structural. **But** the brief's warning applies: `AIProviderKind` classification alone does **not** prove an endpoint is local. `local-model` (a user-configured OpenAI-compatible endpoint) is a **separate kind** from `ondevice`. Run B must specify endpoint-aware privacy behaviour per provider. |
| **Risks** | Silently sending document content to a cloud endpoint the user believes is local. |
| **Confidence** | **VERIFIED** |

## 38. Local-first / offline operation

| Field | Value |
|---|---|
| **Status** | **PARTIAL** |
| **Existing code path** | On-device providers (Gemini Nano / Apple / Windows / Foundry); `LlmRequestPolicy` frozen before request construction and re-checked on retry (`types.ts:80-81`); `COVERAGE_LIMITATIONS.remoteDenied`/`remoteEmbeddingConsent`; `src/lib/ai/features/activation.ts`; `src/lib/ai/enrichmentPolicy.ts`. |
| **Related OpenSpec** | `ai-task-architecture`, `ai-library-rag` req. *"Privacy and offline indicators"*, `knowledge-gap-detection` req. *"Local-first with capability-gated model analysis"*, `adaptive-learning-paths` req. *"Local-first with capability-gated generation"* — *"Rules-based planning SHALL function locally without any LLM or subscription."* |
| **Reusable infrastructure** | The task layer's `requirement`/`kind` gating; the coverage runner's `blocked` flag (`CoverageAnalysisResult.blocked`). |
| **Missing behaviour** | A **rules-only** curriculum planner that produces a valid, ordered, source-cited plan with no LLM. Nothing like it exists. |
| **Risks** | If curriculum generation requires the cloud, Plethora's local-first promise breaks for a core feature. |
| **Confidence** | **VERIFIED** |

## 39. Source privacy and user consent

| Field | Value |
|---|---|
| **Status** | **IMPLEMENTED (as a mechanism)** |
| **Existing code path** | `UNTRUSTED_CONTAINMENT_CLAUSE` + `wrapUntrustedBlock` — every task wraps untrusted content; `assess-answer` adversarially hardens the *user answer*; `requestPolicy` two-phase check; `remoteDenied` / `remoteEmbeddingConsent` limitations; `src/lib/ai/features/` per-feature flags; `src/api/llm/policy.ts`. |
| **Related OpenSpec** | `ai-task-architecture` req. *"Untrusted content containment in prompts"*; `ai-library-rag` req. *"Privacy and offline indicators"*. |
| **Reusable infrastructure** | **Strong.** |
| **Missing behaviour** | A **disclosed data-flow statement** for exam generation (which excerpts leave the device), and a user-visible indicator per generation. |
| **Risks** | The brief asks for *"source privacy and user consent"* — the mechanism exists; the **disclosure** for the new feature must be written. |
| **Confidence** | **VERIFIED** |

## 40. Mobile compatibility

| Field | Value |
|---|---|
| **Status** | **PARTIAL / UNVERIFIED** |
| **Existing code path** | `src/lib/ai/android/`, `src/lib/ai/apple/`, `src-tauri/src/mobile/`, `src-tauri/src/lib.rs:1454/1484` (embedder install), `PlatformCapabilityId` gating on navigation destinations, `OnDeviceRequirement` per task. `learnThisTask.ts` timeout was **raised from 20 s to 60 s** *"after device testing"* because *"on-device structured generation of full proposals regularly exceeds that on Nano hardware"*. |
| **Related OpenSpec** | `validate-ai-learning-cross-platform-readiness` (11/17), `ai-library-rag`. |
| **Reusable infrastructure** | The platform capability gate; the provider registry's native bridges. |
| **Missing behaviour** | A device-feasibility envelope for exam generation (item counts, model choice, generation budget). |
| **Risks** | **Direct evidence of the risk:** the existing card generator already had to double its timeout on Nano. An exam generator producing *many* items is strictly heavier. Run B must specify a bounded, incremental generation strategy for mobile. |
| **Confidence** | **PARTIALLY VERIFIED** |

---

## 41. Summary — capability status counts

| Status | Count | Capabilities |
|---|---|---|
| **IMPLEMENTED** | 6 | 10 (material coverage), 14 (cloze gen), 24 (AI grading), 33 (tutor), 35 (flashcard suggestions), 37 (provider selection) |
| **PARTIAL** | 17 | 1, 2, 3, 4, 5, 8, 11, 15, 17, 18, 20, 26, 29, 30, 32, 38, 40 |
| **SCAFFOLD-ONLY** | 1 | 7 (curriculum editing) |
| **ABSENT** | 15 | 6, 9, 13, 16, 19, 21, 22, 23, 25, 27, 28, 31, 34 (also partial), 3 (partial) |
| *(spec-only but types exist)* | 1 | 29 |

**The 12 genuinely-absent capabilities that block the requested feature:**
1. AI curriculum generation (6)
2. Curriculum versioning + diff (9)
3. Multi-select generation (13)
4. Essay generation (16)
5. Exam blueprint configuration (19)
6. Exam attempt persistence (21)
7. Exam interruption/recovery (22)
8. Deterministic grading (23)
9. Rubric-based essay grading (25)
10. Manual grading correction (27)
11. Historical exam results (28)
12. Mastery/uncertainty representation (31)

Plus the two that are *structurally* present but hollow:
13. Curriculum persistence (8) — exists in the wrong medium (localStorage).
14. Knowledge-gap identification (29) — types exist, no engine.

---

## 42. Cross-cutting observation

Every one of the 12 absent capabilities requires **new persistent artifacts**. Plethora's persistence layer is SQLite via sqlx, with migrations in `src-tauri/src/database/migrations.rs` (highest observed number: **138** ⇒ next free ≈ 139). The minimum new table set implied by the gaps:

| Table | Serves capabilities |
|---|---|
| `study_goals` | 1 |
| `curricula` + `curriculum_nodes` + `curriculum_node_prereqs` | 6, 7, 8, 9, 11 |
| `curriculum_versions` (or a version column + history table) | 9 |
| `exam_blueprints` | 19 |
| `exam_questions` + `exam_options` + `exam_question_sources` | 12, 13, 14, 15, 16, 17, 18 |
| `exam_attempts` + `exam_attempt_items` | 21, 22, 23, 24 |
| `exam_rubrics` + `exam_rubric_criteria` | 25 |
| `grading_corrections` (or columns on attempt items) | 27 |
| `concept_mastery` | 31 |

**Run B must design these.** This document deliberately does **not** specify them — it only records which capability forces which artifact.

---

## 43. LearnHarness capability comparison (for the rows above)

| Capability | LearnHarness | Plethora | Gap direction |
|---|---|---|---|
| Diagnostic probing | **Implemented** (`probe_done` assessment, floor/ceiling/misconceptions per strand) | **Absent** | **Port from LearnHarness** |
| Agent-based teaching | **Implemented** | Partial (tutor, not agentic) | Adapt |
| Prerequisite DAG | **Implemented** (session-scoped, cycle-rejecting) | Partial (concept-level, no curriculum-level DAG) | Adapt (port cycle rejection) |
| Adaptive practice | **Partial** (mode taxonomy + hint ladder + missClass + retest) | Absent | Adapt |
| Precommitted answers | **Implemented, strong** | Partial | **Port, but make mechanically immutable** |
| Structured question validation | **Implemented, strong** | Partial (cards only) | **Port** (`quizInputProblems` invariant) |
| Targeted feedback | **Implemented** (`conclude.verdict` + `missClass`) | Partial (`AnswerAssessment.feedback`) | Adapt |
| Knowledge extraction | **Implemented** (extractor → auditor → merger) | Partial (concepts, not propositions) | Adapt (add verification) |
| Session persistence/recovery | **Implemented** (durable transcript = source of truth) | Partial | Port the principles |
| Persistent curriculum | **Absent** | Absent | **Build from scratch** |
| Configurable exam length | **Absent** | Absent | Build |
| Mixed-format exams | **Absent** | Absent | Build |
| Cloze in exams | **Absent** (but cloze *cards* exist in Plethora) | Partial | Build on existing cloze gen |
| Essay rubrics | **Absent** | Absent | Build |
| Numeric grading | **Absent** | Absent | Build |
| Exam history | **Absent** | Absent | Build |
| Mastery estimation | **Absent** | Absent | Build (Plethora's spec already wants it) |
| Source-linked remediation | **Partial** (provenance only) | Partial (stronger locators) | Build the routing |
| Flashcard scheduling | **Absent** | **Implemented** | Plethora is ahead |
