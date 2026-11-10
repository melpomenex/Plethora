# Source Evidence Index

**Plethora:** `340661b2c5a42bf0c2a8fb7d5a5d384f3ef04481` (`main`)
**LearnHarness:** `da08cb5f7d098598ba963c6689b22054c9f2a5a3` (`main`, cloned to `/tmp/plethora-learnharness-research`)

Purpose: let the planning model **skip re-discovery**. Every entry was opened and read during Run A. Confidence reflects the depth of verification.

**Confidence:** `VERIFIED` = read the source at the cited line · `PARTIAL` = read, but the surrounding system was not fully traced · `SPEC` = documentation only.

---

## 1. Plethora — Curriculum / learning paths (the stub)

| File | Symbol / line | Purpose | Caller / consumer | Conf |
|---|---|---|---|---|
| `src/types/learningPaths.ts` | `LearningGoal` 4-14 | Goal shape (title, scope, status) | type-only | VERIFIED |
| | `LearningPathNode` 16-29 | Node shape (concept, sources, prereqs, mastery fields, status) | type-only | VERIFIED |
| | `LearningPath` 31-40 | Path shape (version, nodes) | type-only | VERIFIED |
| | `generateLearningPathTopology` 45-102 | Kahn topological sort; **does not reject cycles** (94-99); **ignores dangling prereq ids** (60) | `learningPathsStore.ts:54` | VERIFIED |
| `src/stores/learningPathsStore.ts` | `useLearningPathsStore` 31 | Zustand + `persist` → **localStorage** key `plethora-learning-paths` (124) | **NO production consumer** | VERIFIED |
| | `createGoal` 39 / `createPath` 52 / `updateNodeStatus` 73 / `reorderNodes` 86 | CRUD; `reorderNodes` **drops nodes not in the supplied id list** | — | VERIFIED |
| `src/main.tsx` | 346-366 (esp. 358) | Legacy **debug** store registry `window.plethora.stores` — the only "consumer" | debug only | VERIFIED |
| `src/types/__tests__/learningPaths.test.ts`, `src/stores/__tests__/learningPathsStore.test.ts` | — | Unit tests for the stub | — | VERIFIED |
| `openspec/changes/archive/2026-10-15-implement-plethora-ai-generated-adaptive-learning-paths/tasks.md` | all `[x]` | **STALE-COMPLETE** — claims migrations/Rust/planner/PathView/queue-feed | — | VERIFIED |
| `openspec/specs/adaptive-learning-paths/spec.md` | 6 requirements | The real (much richer) intent | — | VERIFIED |

---

## 2. Plethora — Knowledge graph, concepts, coverage, gaps

| File | Symbol / line | Purpose | Caller / consumer | Conf |
|---|---|---|---|---|
| `src-tauri/src/database/migrations.rs` | `concepts` 2773-2780 | Canonical concept identity (`normalized_name TEXT NOT NULL UNIQUE`) | — | VERIFIED |
| | `concept_links` 2782-2800 | Typed edges: `relation_type`, `confidence`, `provenance_json`, `created_by`, `is_dismissed`, `proposal_fingerprint` | — | VERIFIED |
| | `recall_prompt_history` 2803-2815 | Question fingerprint dedup + history (`chunk_ids`, `fingerprint`, `outcome`) | `commands/recall_history.rs` | VERIFIED |
| | `answer_assessments` 2817-2836 | Free-response grading persistence + `provider`/`model` provenance | `commands/answer_assessment.rs` | VERIFIED |
| | `learning_items` 109-137 | The FSRS unit (`interval`, `ease_factor`, `due_date`, `state`, `lapses`); FK cascade to `extracts`/`documents` | review/queue | VERIFIED |
| | `source_reference` migration 4035-4037 | `ALTER TABLE learning_items ADD COLUMN source_reference TEXT` (migration 116) | card creation | VERIFIED |
| | highest migration number observed | **138** ⇒ next free ≈ **139** (re-derive at implementation time) | — | VERIFIED |
| `src-tauri/src/commands/concept_links.rs` | 16 commands, 170-424 | `upsert_concept` 170 … `get_concept_evidence_annotation` 424; propose→accept/dismiss lifecycle | `src/api/concept-links.ts` | VERIFIED |
| `src/api/concept-links.ts` | — | TS wrapper for the above | `concepts/coverage.ts`, `concepts/relationships.ts`, `pages/KnowledgeGraphPage.tsx`, `components/graph/conceptProjection.ts`, `components/viewer/SelectionActionsSheet.tsx`, `lib/ai/agent/tools/relationshipAdapter.ts`, `components/recording/SessionConceptRelations.tsx` | VERIFIED |
| `src/lib/ai/concepts/coverage.ts` | header 1-27 | **Coverage ≠ mastery doctrine** | — | VERIFIED |
| | `CoverageLocator` 71-110 | 4 anchor kinds: chunk / extract / card / annotation | coverage runner | VERIFIED |
| | `CoverageEvidenceRef` 112-125 | `sourceRevision`, `strength` (mention/direct), resolved `text` | coverage runner | VERIFIED |
| | `ConceptCoverage` 127-135 | `evidenceCoverage` × `activity` × `indexCompleteness` × `evidenceRefs` × `limitations` | UI | VERIFIED |
| | `COVERAGE_LIMITATIONS` 149-166 | 16 content-free limitation keys (honest degraded states) | UI | VERIFIED |
| | `conceptPhrasePattern` 182-199 | Unicode token-boundary phrase matching | predicates | VERIFIED |
| | `computeEvidenceCoverage` 329 / `computeActivity` 350 | The two orthogonal axes | UI | VERIFIED |
| | constants 53-63 | `COVERAGE_POLICY_VERSION="coverage-v1"`, `MAX_COVERAGE_CONCEPTS=12`, `COVERAGE_RETRIEVAL_K=6`, `COVERAGE_QUERY_CONCURRENCY=2` | — | VERIFIED |
| `src/lib/ai/concepts/relationships.ts` | — | Typed relationship draft handling | agent adapter | PARTIAL |
| `src/lib/ai/tasks/definitions/prerequisiteTask.ts` | `PREREQUISITE_TASK_ID` 27, instruction 44-49 | Proposes 1-8 prerequisite concepts; empty list allowed | `SelectionActionsSheet.tsx:469` | VERIFIED |
| `src/lib/ai/tasks/definitions/relationshipTask.ts` | `MAX_RELATIONSHIP_HANDLES` 30, instruction 42-50 | Handle-bound typed relations; `contradicts` among the allowed types | agent adapter | VERIFIED |
| `src/types/knowledgeGaps.ts` | `KnowledgeGapKind` 1-7, `GapEvidence` 9-13, `KnowledgeGap` 15-25, `formatGapTitle` 27 | 6 gap kinds; `masteryEstimate` + `variance`; evidence records | type-only | VERIFIED |
| `src/stores/knowledgeGapsStore.ts` | `recordGap` 24-40 | localStorage store; **dedupes by `(conceptName, kind)`** | **NO production caller of `recordGap`** | VERIFIED |
| `src/pages/KnowledgeGraphPage.tsx` | 29 KB | The live Knowledge Graph page | routes | VERIFIED |
| `src/components/graph/conceptProjection.ts` | `conceptNodeId` 14, `isConfirmedConceptLink` 18, `buildConceptGraphProjection` 48, `request/consume/subscribeConceptFocus` 127-139 | Projects confirmed concepts into the graph; cross-surface focus | `KnowledgeGraph.tsx` | VERIFIED |
| `src/components/graph/` | `KnowledgeGraph.tsx`, `KnowledgeSphere.tsx`, `KnowledgeUniverse.tsx`, `ObsidianGraph.tsx`, `NodeDetailPanel.tsx`, `NodeDetailView.tsx`, `GraphFilters.tsx`, `GraphExport.tsx` | Graph surfaces | tabs | VERIFIED |
| `src/components/tabs/knowledge/` | `KnowledgeNetworkTab.tsx`, `KnowledgeSphereTab.tsx` | Tab hosts | tab registry | VERIFIED |

---

## 3. Plethora — Source grounding & retrieval

| File | Symbol / line | Purpose | Caller / consumer | Conf |
|---|---|---|---|---|
| `src/types/cardSourceReference.ts` | `CardSourceReference` 17-31 | The canonical provenance envelope (version 1) | card creation | VERIFIED |
| | `parseCardSourceReference` 50-88 | **Fails closed to `null`** on malformed provenance | card rendering | VERIFIED |
| | `serializeCardSourceReference` 91-99 | Excerpt clamped to 300 chars | card creation | VERIFIED |
| | `CARD_SOURCE_EXCERPT_MAX_CHARS` 34 | Excerpt bound | — | VERIFIED |
| `src/types/searchHit.ts` | `ExactSearchHitLocation` 1-8 | Discriminated union: pdf / epub / html / markdown / youtube / audio | navigation | VERIFIED |
| `src-tauri/src/ai_learning/retrieval.rs` | — | Semantic + **lexical fallback** + prefilter | `api/ai-learning.ts` | PARTIAL |
| `src-tauri/src/ai_learning/{chunker,indexer,embeddings_backend,spotlight}.rs` | — | Chunking (with source-location metadata), index lifecycle, embeddings | retrieval | PARTIAL |
| `src/api/ai-learning.ts` | `retrieveFromLibrary`, `getAIIndexStatus`, `RetrievalResponse`, `ChunkLocation`, `IndexStatusResponse` | The retrieval seam | coverage, tutor, agent | VERIFIED |

---

## 4. Plethora — AI task layer, providers, agent

| File | Symbol / line | Purpose | Caller / consumer | Conf |
|---|---|---|---|---|
| `src/lib/ai/tasks/types.ts` | `AITaskDefinition` 90-143 | The unit of AI work | every task | VERIFIED |
| | `AITaskRunOptions` 45-88 | signal / onChunk / onRetry / targetId / kind / provider / requestPolicy / timeoutMs / retrieval | `runTask` | VERIFIED |
| | `AITaskValidationOutcome` 146-154 | 8-value validation ledger | diagnostics | VERIFIED |
| | `AITaskResult` 158-172 | Full provenance envelope | callers | VERIFIED |
| `src/lib/ai/tasks/runTask.ts` | 665 lines | Provider resolution, gating, budgeting, streaming, fail-closed validation + repair retry, cancellation, coalescing, diagnostics | every task | VERIFIED |
| `src/lib/ai/tasks/router.ts` | `resolveTaskRoute` 45+; class policy 8-13 | `fast`/`full`/`reasoning` + `reasoningFallback` | `runTask` | VERIFIED |
| `src/lib/ai/tasks/registry.ts` | `registerTasks` | Task registration | task definitions | VERIFIED |
| `src/lib/ai/tasks/containment.ts` | `UNTRUSTED_CONTAINMENT_CLAUSE`, `wrapUntrustedBlock` | Mandatory untrusted-content wrapping | every task | VERIFIED |
| `src/lib/ai/providers/` | `types.ts:123` `AIProviderKind = "ondevice"\|"cloud"\|"local-model"` | Provider kinds (3, not 2) | router | VERIFIED |
| | `onDeviceProvider.ts`, `appleCoreAiProvider.ts`, `appleFoundationProvider.ts`, `windowsSystemProvider.ts`, `foundryLocalProvider.ts`, `localModelProvider.ts`, `cloudProvider.ts` | Provider implementations | provider registry | VERIFIED |
| `src/lib/ai/agent/bounds.ts` | 23-28 | `MAX_AGENT_TOOL_CALLS=12`, `MAX_AGENT_PROPOSALS=20`, `MAX_AGENT_WALL_CLOCK_MS=60_000`, `MAX_AGENT_RETRIEVAL_HOPS=2`, `AGENT_LOOP_REPEAT_LIMIT=3` | agent | VERIFIED |
| `src/lib/ai/agent/loop.ts` | `runAgentLoop` 348, `agentRunnerTask` 129, `AGENT_MAX_OUTPUT_TOKENS=2048` 85, `AGENT_TRANSCRIPT_CHAR_BUDGET=12_000` 92 | The bounded agent loop | `assistant/learningAgent.ts:1405` | VERIFIED |
| `src/lib/ai/agent/tools/proposals.ts` | `propose_link` 852, "draft-only adapter, typed unavailable" 829 | Agent proposal tools | agent | VERIFIED |
| `src/lib/ai/agent/tools/{readonly,relationshipAdapter,validation}.ts` | — | Read-only tools, relationship adapter, arg validation | agent | VERIFIED |
| `src/lib/ai/assistant/learningAgent.ts` | `LEARNING_AGENT_FEATURE_ID` 100, `LEARNING_AGENT_MAX_RUN_MS=60_000` 101, `preflightLearningAgent` 511, `createFrozenAgentEnvironment` 849, `bindLearningAgentPlan` 810, `createLearningAgentGuard` 1067, `runLearningAgent` 1212, `recordLearningAgentStage` 1464 | The production learning-agent pipeline | **`src/components/assistant/AssistantPanel.tsx:2018`** | VERIFIED |
| `src/lib/ai/assistant/learningAgentAcceptance.ts` | `deriveConceptKey` 74, `proposalToLearningCandidate` 89, `primarySource` 113, `sourceGroupKey` 119, `buildAgentProposalGroups` 202, `validateAgentCardReview` 330 | Agent proposal → card candidates, review validation | Assistant | VERIFIED |
| `src/lib/ai/assistant/learningAgentHandoff.ts` | — | Agent → UI handoff | Assistant | PARTIAL |
| `src/lib/ai/features/activation.ts`, `features/types.ts` | per-feature flags + `FeatureId` | Capability gating | settings, tasks | VERIFIED |
| `src/api/llm/policy.ts` | `LlmRequestPolicy` | **Two-phase consent** (frozen pre-request, re-checked on retry) | `runTask` | VERIFIED |

---

## 5. Plethora — Assessment, tutor, flashcards

| File | Symbol / line | Purpose | Caller / consumer | Conf |
|---|---|---|---|---|
| `src/lib/ai/schemas/answerAssessment.ts` | `ANSWER_CLASSIFICATIONS` 15, `AnswerAssessment` 18-31, `ANSWER_ASSESSMENT_SCHEMA` 33-46, `validateAnswerAssessment` 48-112 | **The canonical free-response grading contract**; fail-closed; `misconception` required when classified as such (86-88) | `assessmentTask.ts` | VERIFIED |
| `src/lib/ai/tasks/definitions/assessmentTask.ts` | `ASSESS_ANSWER_TASK_ID` 29, `ASSESS_ANSWER_FALLBACK_TASK_ID` 31, input 36-44, instruction 46-56, `runAssessAnswer` 114-125 | Grading task + full-class fallback + adversarial-answer hardening (54) | review flow | VERIFIED |
| `src/components/review/answerAssessmentIntegration.ts` | header 5-12, `AUTO_GRADE_CONFIDENCE_THRESHOLD` 19, `computeSuggestedRating` 22-33, `shouldSuggestGrade` 36-47, `recordCardAssessment` 69-83 | **Scheduler-authority preservation by construction** | review flow | VERIFIED |
| `src/components/review/AssessmentPanel.tsx` | 134 lines | Assessment result UI | review | VERIFIED |
| `src-tauri/src/commands/answer_assessment.rs` | `record_answer_assessment` 91, `get_answer_assessments_for_item` 154, `get_answer_assessment_counts` 193 | Persistence commands | `src/api/answer-assessment.ts` | VERIFIED |
| `src/api/answer-assessment.ts` | `invokeCommand` from `../lib/tauri` | TS wrapper convention | review | VERIFIED |
| `src/lib/ai/tutor/session.ts` | policy table 10-22, `DEFAULT_TUTOR_LIMITS` 88-92, `TutorPolicyOverride` 95-100, `initialTutorPolicyState` 111-119 | The Socratic tutor state machine; 8 ordered bounds | `TutorSheet.tsx` | VERIFIED |
| `src/lib/ai/tutor/context.ts` | `TUTOR_MAX_SESSION_TURNS`, `TUTOR_RETRIEVAL_K`, `TUTOR_MAX_RETRIEVAL_REFRESHES`, `detectTopicDrift`, `topicSignature`, `buildTutorContext`, `capText` | Bounded context + drift-triggered retrieval refresh | tutor | VERIFIED |
| `src/lib/ai/tutor/lesson.ts` | 120 lines | Lesson assembly | tutor | VERIFIED |
| `src/lib/ai/tasks/definitions/tutorTask.ts` | `TUTOR_TURN_TASK_ID` 35, `TUTOR_TURN_FALLBACK_TASK_ID` 37 | Tutor turn task + fallback | tutor | VERIFIED |
| `src/components/tutor/TutorSheet.tsx` | 464 lines | The tutor UI | `SelectionActionsSheet.tsx`, `LanguageTutorHost.tsx` | VERIFIED |
| `src/lib/ai/tasks/definitions/learnThisValidation.ts` | `LearnCandidateStatus` 39, `DUPLICATE_SIMILARITY_THRESHOLD` 42, `ValidatedLearnCandidate` 44-55, `checkCandidateGrounding` 95-116, `validateLearnThisProposal` 122+ | **Source grounding + duplicate detection — directly reusable** | `LearnThisProposalSheet` | VERIFIED |
| `src/lib/ai/schemas/learningMaterial.ts` | `LEARNING_CARD_TYPES` 33-44, `KNOWLEDGE_TYPES` 50-61, `LearningCardCandidate` 63-82, `LEARNING_MATERIAL_SCHEMA` 94, `normalizeCardType` 267, `normalizeLearningMaterialProposal` 276, `validateLearningMaterialProposal` 303 | Card/cloze schema + healing | learnThis | VERIFIED |
| `src/lib/ai/tasks/definitions/learnThisTask.ts` | `LEARN_THIS_TASK_ID` 38, `LEARN_THIS_TIMEOUT_MS = 60_000` 47, `LEARN_THIS_MAX_OUTPUT_TOKENS = 1500` 48 | Card-generation task (timeout raised 20→60 s for Nano) | learnThis | VERIFIED |
| `src/components/learn/LearnThisProposalSheet.tsx`, `acceptLearnThis.ts` | — | The preview/edit/accept flow (the template for exam preview) | reader selection | VERIFIED |
| `src/lib/ai/schemas/recallQuestion.ts` | — | Card-question schema; **claimed by the active change (task 1.1) — not yet modified** | recall/assistant | VERIFIED |
| `src/features/assistant/chatFlashcardArtifacts.ts` | — | Assistant card artifacts; **claimed by the active change (task 1.2)** | assistant | VERIFIED |
| `src/components/review/studio/DraftCardList.tsx` | — | Studio complexity routing; **claimed by the active change (task 3.1)** | review | VERIFIED |
| `src/components/viewer/useRecallPrompts.ts`, `RecallPromptOverlay.tsx`, `recallChunkSampling.ts` | — | **Production recall-prompt pipeline in the reader** | reader | VERIFIED |
| `src/lib/ai/tasks/definitions/recallTask.ts` | `RECALL_QUESTION_TASK_ID` 28, timeout 45 s, 350 tokens | Recall question generation | reader | VERIFIED |

---

## 6. Plethora — Queue, FSRS, DAQE, scheduling

| File | Symbol / line | Purpose | Caller / consumer | Conf |
|---|---|---|---|---|
| `src-tauri/src/migrations/fsrs7_migration.rs` | — | FSRS-7 adoption | migrations | PARTIAL |
| `src-tauri/src/models/daqe.rs` | `RANKER_RUBRIC_VERSION: i32 = 2` 285 | **Ranking** rubric version — NOT an assessment rubric | DAQE | VERIFIED |
| `src-tauri/src/algorithms/daqe/` | `ranker.rs`, `goal_alignment.rs`, `learning.rs`, `terms.rs`, `decision_model/{mod,http_provider}.rs` | The adaptive ranking engine | queue | PARTIAL |
| `src/lib/ai/schemas/daqeDecision.ts` | `DECISION_TIERS` 29, `TIER_COMPLEPURITY` 32, `DaqeDecision` 43-52 | `goalAlignment`, `atomicExtractability`, `tier`, `prerequisitesMet`, `staleForPruning` | DAQE | VERIFIED |
| `src/lib/daqe/sessionGoal.ts` | `MAX_SESSION_GOAL_LENGTH=200` 23, `MAX_RECENT_GOALS=5` 30, `normalizeSessionGoal` 43, `validateSessionGoal` — | **Reusable goal primitive; refusal-not-truncation doctrine** | DAQE | VERIFIED |
| `src/lib/daqe/` | `knobs.ts`, `presets.ts`, `snapshot.ts`, `systemOne.ts`, `decisionModelDownloads.ts`, `decisionModelProbe.ts`, `remotePayload.ts`, `useDaqeIdleTimeout.ts` | Ranking knobs, snapshots, idle-gated passes | DAQE | PARTIAL |
| `src-tauri/src/algorithms/priority_queue.rs`, `algorithms/relevance.rs` | — | Priority + relevance math | queue | PARTIAL |

---

## 7. Plethora — Navigation, settings gates, migrations

| File | Symbol / line | Purpose | Conf |
|---|---|---|---|
| `src/navigation/tabDestinations.ts` | `NAVIGATION_DESTINATIONS` 39+ | **SSOT** for palette navigation + navigate-event resolution + help-intent sections; drift test asserts path↔tabType↔label | VERIFIED |
| `src/navigation/__tests__/tabDestinations.test.ts` | — | The drift gate | VERIFIED |
| `src/components/settings/search/settingsSearchCatalog.ts` | — | Catalog of searchable Settings destinations | VERIFIED |
| `src/components/settings/search/settingsSearchCoverage.ts` | `SETTINGS_SEARCH_COVERAGE` | One row per Settings section (sources / prefixes / exclusions) | VERIFIED |
| `docs/settings-search.md` | — | The contributor guide (target primitive, reveal rules, privacy constraints) | VERIFIED |
| `src-tauri/src/entitlements/snapshot.rs` | `CapabilityId::AdaptiveLearningPaths => "adaptive_learning_paths"` 57 | **An entitlement capability already exists for this feature area** | VERIFIED |
| `src-tauri/src/lib.rs` | concept commands registered at :1885 (per the coverage change); embedder install at :1454 (Android) / :1484 (iOS) | Command registration + native bridges | PARTIAL |
| `src/lib/tauri.ts` | `invokeCommand` | The Tauri invoke wrapper | VERIFIED |
| `vitest.config.ts` | `include: src/**/*.{test,spec}.*`, jsdom, `setupFiles: ./src/test/setup.ts` | Test conventions | VERIFIED |
| `AGENTS.md` | 13-21 (settings-search gate), 26-32 (bench gate) | The two hard gates | VERIFIED |

---

## 8. LearnHarness — agent orchestration

| File | Symbol / line | Purpose | Conf |
|---|---|---|---|
| `src/agent/teacher-agent.ts` | `composeInstructions` 77 | Segmented prompt composition with per-segment overrides | VERIFIED |
| | `makeQuestionStopper` 157-177 | A **resolved** question ends the turn; a **failed** one does not | VERIFIED |
| | `baseAgentOptions` 179-273 | Shared construction (prompt, tools, convertToLlm, usage, narration guard) | VERIFIED |
| | `createProberAgent` 283 / `createTeacherAgent` 293 / `createPracticeAgent` 344 | The three agents | VERIFIED |
| `src/agent/tools/probe.ts` | `probeDoneTool` 49-98 | The probe→teach seam; refuses on open question / already concluded | VERIFIED |
| `src/core/contracts/probe.ts` | `probeDoneInputSchema` 47-72, `PROBE_DONE_ACK_TEXT` 93 | The probe assessment contract (strands + assessment) | VERIFIED |
| `src/agent/tools.ts` | `createProberTools` / `createTeacherTools` / `bareQuestionTools` 309-332 | Tool registries; the per-session `nodeId` validation lives here | PARTIAL |
| `src/agent/tool-execute.ts` | `serverExecute` 196, `questionResult` 222 (`terminate: true`), `problemResult` 240, `concludeResult` 256, `invalidInputResult` 117 | Tool execution + synthetic results | VERIFIED |
| `src/core/pending.ts` | `QUESTION_TOOLS` 53, `toolQuestionKind` 64, `filterEnabledTools` 106, `TOGGLEABLE_TOOLS` 87, `WRITABLE_TOOL_KEYS` 94 | Tool gating + the pending-question gate | VERIFIED |
| `src/core/phases.ts` | `phaseAt3` 63, `phaseAt3Lh` 166, `teachStepIndex` 115 | probe / plan / teach phase detection | VERIFIED |
| `src/server/chat-handler.ts` | `handleChatRequest` 171, `handleChatInput` 200, `resolveEngine` 153 | Turn admission, liveness (409), agent construction | PARTIAL |
| `src/agent/models.ts` | `piEngineFor`, `APP_IDENTITY` | Provider/model composition; no factory model pins | PARTIAL |

---

## 9. LearnHarness — question authoring & grading (the highest-value port)

| File | Symbol / line | Purpose | Conf |
|---|---|---|---|
| `src/core/question-core.ts` | `quizInputBase` 158-193 | MCQ contract (question / options / multiSelect / explanation / correctAnswer) | VERIFIED |
| | `quizInputObject` 256-268 | Teach-side quiz (+ `type`, `nodeId`) | VERIFIED |
| | `explainInputBase` 303-318 | **Free-recall commitment contract** | VERIFIED |
| | `explainInputObject` 326-338 | Teach-side explain (+ `type`, `nodeId`) | VERIFIED |
| | `askInputSchema` 367-389 | Ungraded preference collection | VERIFIED |
| | `optionProblems` 85-103 | Option sanity (non-empty labels, distinct resolved keys) | VERIFIED |
| | `quizInputProblems` 112-142 | **The gradeability contract** — correctAnswer must match an option; multiSelect required when >1 correct | VERIFIED |
| | `explainInputProblems` 352-357 | Commitment must exist | VERIFIED |
| | `normalizeOptions` 558-581 / `shuffleOptions` 610-618 / `seededRandom` 588-602 | Option normalization + deterministic hydration-safe shuffle | VERIFIED |
| | `coerceCorrectAnswer` 631-652 / `resolveCorrect` 657-676 | Value-keyed answer resolution; **unknown value ⇒ hard error** | VERIFIED |
| | `isCorrect` 679-684 | **Exact-set match** (deterministic grader) | VERIFIED |
| | `toClientQuestion` 688-697 | The client payload **omits the answer** | VERIFIED |
| | `buildAnswer` 708-751 | Grades MCQ; snapshots the commitment | VERIFIED |
| | `compactAnswerForModel` 779-802 | The model-visible projection (only what the learner added) | VERIFIED |
| | `questionNeedsReveal` 232-235 / `normalizeQuizType` 217-221 | The predict/check reveal law | VERIFIED |
| | `CONFIDENCE_STOPS` 500 | 0-100 confidence snap stops | VERIFIED |
| `src/core/contracts/chat.ts` | `ChatRecord` 30-63, `ChatSettings` 75-83, `CURRENT_CHAT_VERSION` 66 | The durable record | VERIFIED |
| `src/core/native-messages.ts` | `toLlmMessages`, `hasProbeDone`, `hasUnresolvedQuestion`, `activeProblemOf`, `nativeInputCause` | The provider-boundary projection + seam scans | PARTIAL |
| `src/core/view.ts` | `projectView` | The UI projection (not the stored format) | PARTIAL |

---

## 10. LearnHarness — plan, practice, graph, storage

| File | Symbol / line | Purpose | Conf |
|---|---|---|---|
| `src/agent/tools/plan.ts` | `planInitInput` 52-60, `planTools` 62-109, `PLAN_NODE_IDS_REMINDER` 14 | The **single** plan tool; wholesale replacement | VERIFIED |
| `src/agent/tools/mermaid-plan.ts` | `parseMermaidPlan` 77-163, `SLUG_RE` 45, `HEADER_RE` 44, `ARROW_RE` 47 | Hand-parsed Mermaid subset; collects all problems with line numbers | VERIFIED |
| `src/core/plan-tree.ts` | `createTree` 112-126, `assertValidEdge` 91-107, `createsCycle` 71-88, `PlanTreeError` 22 | **DAG validation incl. cycle rejection**; mutation ops deleted by design (128-132) | VERIFIED |
| `src/core/contracts/plan.ts` | `PlanNode` 13-20, `PlanEdge` 22-27, `PlanTree` 29-34, `derivePlanStatuses` 82-102, `derivePlanStatusesLh` 132-149 | Structure-only tree; **progress derived, never stored** (36-40) | VERIFIED |
| `src/agent/tools/practice.ts` | `problemInputObject` 72-93, `problemTool` 97-161, `concludeInputObject` 165-197, `concludeTool` 199-220, `createPracticeGate` 65-68 | The practice engine: commit-before-pose, turn-scoped gate, outcome/rung/missClass/retest | VERIFIED |
| `src/core/chains.ts` | `resolveTargetId` 70-88 | Name→id resolution for practice targets | VERIFIED |
| `src/core/contracts/graph.ts` | `GraphNode` 126-147, `GraphChain` 42-54, `ProvenancePoint` 77-83, `NotesSource` 93-105, `ExtractedProposition` 215-245, `AuditVerdicts` 284-286, `GraphSnapshot` 303-347 | The knowledge-graph contract; **knowledge only, no mastery** (9-11) | VERIFIED |
| `src/core/coverage.ts` | `messageViewLines` 38-51, `messageFingerprint` 77-81, `coverageOf` 115-150, `batchRuns` 159-177, `batchTag` 188-192 | Fingerprinted, teacher-prose-only coverage; **idempotent batch tag** | VERIFIED |
| `src/agent/subagents/extraction.ts` | `createExtractionPipeline` 803, `extractionStatuses` 699, `abortExtraction` 708, `EXTRACTION_CORE` 404, `SESSION_MESSAGE_ID_RULE` 388 | Extractor → auditor → deterministic merger | PARTIAL |
| `src/store/` | `chats.ts`, `jobs.ts`, `graph.ts`, `atomic-write.ts`, `prompt-overrides.ts` | Filesystem adapters (JSON / JSONL) | PARTIAL |
| `src/server/jobs.ts` | — | Background jobs: independent completion + delivery, restart recovery | PARTIAL |
| `src/core/ports.ts` | — | Storage ports (semantic interfaces) | PARTIAL |

---

## 11. LearnHarness — UI

| File | Symbol | Purpose | Conf |
|---|---|---|---|
| `components/question-dock.tsx` | `QuestionDock` 102, `QuestionDockBar` 191 | The question UI + composer gate | VERIFIED |
| `components/answered-card.tsx` | — | The answered question card | VERIFIED |
| `components/malformed-question.tsx` | — | Recovery UI for a malformed persisted call | VERIFIED |
| `components/plan-block.tsx`, `components/plan-window.tsx` | `planExists` 39, `PlanMarginalia` 44 | Plan rendering | VERIFIED |
| `components/practice-dock.tsx` | `PracticeDock` 52 | The practice problem surface | VERIFIED |
| `components/practice-cards.tsx` | `ProblemCard` 58, `ConcludeCard` 96, `ThinkingCard` 292 | Practice cards | VERIFIED |
| `components/confidence-rail.tsx` | — | The 0-100 confidence slider | VERIFIED |
| `components/reading-thinking.tsx` | — | The "thinking while reading" channel | VERIFIED |
| `components/graph-view.tsx` | `GraphView` 927, `GraphChromeRow` 840 | The knowledge-graph canvas | VERIFIED |
| `components/chain-table.tsx` | — | The chains browser (stored truth) | VERIFIED |
| `components/session-core.ts` | — | Reattachment, 409 recovery, canonical-state adoption | PARTIAL |
| `components/new-session.tsx`, `start-session.ts`, `minimal-home.tsx` | — | Session creation | VERIFIED |
| `components/sidebar.tsx`, `top-bar.tsx`, `model-picker.tsx`, `model-catalog.ts` | — | Chrome + provider/model selection | VERIFIED |
| `app/api/` | `chat/route.ts`, `chats/[id]/stream/route.ts`, `chats/[id]/steer/route.ts`, `graph/route.ts`, `graph/import/route.ts`, `graph/coverage/extract/route.ts`, `events/route.ts` | The HTTP surface | VERIFIED |

---

## 12. Tests worth reading before designing

### Plethora

| Test | Why |
|---|---|
| `src/lib/ai/concepts/__tests__/` | The coverage ruleset's expected semantics — the model for any coverage-vs-mastery test |
| `src/lib/ai/tasks/__tests__/` | How a task is validated, mocked and asserted |
| `src/lib/ai/schemas/__tests__/` | The fail-closed validator pattern |
| `src/lib/ai/agent/__tests__/` | The bounded-agent contract |
| `src/lib/ai/tutor/__tests__/` | The tutor policy state machine |
| `src/types/__tests__/learningPaths.test.ts`, `src/stores/__tests__/learningPathsStore.test.ts` | The stub's current contract (must be replaced, not extended) |
| `src/stores/__tests__/knowledgeGapsStore.test.ts` | The gap store's contract |
| `src/navigation/__tests__/tabDestinations.test.ts` | The navigation drift gate |
| `src/components/settings/search/__tests__/` | The Settings-search gate |
| `src-tauri/src/**/test_support.rs`, inline `#[cfg(test)]` in `migrations.rs` | Rust test conventions |

### LearnHarness

| Test | Why |
|---|---|
| `tests/question-core.test.ts` | The grading/validation contract — **the single most valuable file to port the *ideas* of** |
| `tests/question-tools.test.ts` | Tool-boundary behaviour |
| `tests/plan-tree.test.ts` | DAG validation (incl. cycle rejection) |
| `tests/probe-done.test.ts` | The probe→teach seam |
| `tests/practice-flow.test.ts`, `tests/practice-record.test.ts` | The practice engine |
| `tests/extraction.test.ts`, `tests/coverage.test.ts` | The extraction pipeline and coverage |
| `tests/malformed-question-recovery.test.ts`, `tests/tool-heal.test.ts` | Failure recovery |
| `tests/golden-fixtures.test.ts` + `tests/fixtures/golden-data/` | Schema-stamp / compatibility discipline |
| `tests/turn-recovery.test.ts`, `tests/job-delivery-recovery.test.ts` | Recovery semantics |

---

## 13. Negative-search record (what is definitively absent)

Recorded so Run B does **not** repeat these searches.

| Query | Scope | Result |
|---|---|---|
| `blueprint` | LearnHarness `src components app` | **0 files** |
| `rubric` | LearnHarness `src components app` | **0 files** |
| `cloze` | LearnHarness `src components app` | **0 files** |
| `essay` | LearnHarness `src components app` | **0 files** |
| `flashcard` | LearnHarness `src components app` | **0 files** |
| `fsrs` | LearnHarness `src components app` | **0 files** |
| `curriculum` | LearnHarness `src components app` | **0 files** |
| `mastery` | LearnHarness `src components app` | 4 files, **all comments** naming an id-normalization contract |
| `StudyPlan` / `studyPlan` | Plethora `src src-tauri/src` | **0 files** |
| `blueprint` | Plethora `src src-tauri/src` | **0 files** |
| `curricul*` (word-boundary) | Plethora `src src-tauri/src` | **1 file** — `src/types/paywall.ts` (a tier name) |
| `\brubric(s)?\b` | Plethora `src src-tauri/src` | DAQE **ranking** rubric version only |
| `\bexam(s\|ination)\b` | Plethora `src src-tauri/src` | DAQE queue-ranking + i18n/help strings — **no exam entity** |
| `learning_goals` / `learning_path_nodes` | Plethora `src-tauri/src/database/` | **0 hits** |
| `path-generation` / `pathGeneration` | Plethora `src src-tauri/src` | **0 hits** |
| `pathFeed` / `path_feed` / `todaysPath` | Plethora `src` | **0 hits** |
| `recordGap` / `dismissGap` / `resolveGap` / `getActiveGaps` | Plethora `src src-tauri/src` (excl. tests, excl. the store) | **0 hits** |
| `mastery` tables | Plethora `src-tauri/src/database/migrations.rs` | **0 hits** |
| `masteryEstimate` / `mastery_estimate` | Plethora `src` (excl. tests) | **2 type files only** |
| `src-tauri/src/learning_paths/` | Plethora filesystem | **does not exist** |
| `PathView` / `NodeCard` / `GoalCreator` | Plethora `src` | **0 files** |
| `learnharness`-side `\bquiz\b` | LearnHarness `src components app` | only "example"/"examine" substrings + the quiz tool itself |

---

## 14. Confidence summary

| Confidence | Meaning | Count in this index |
|---|---|---|
| **VERIFIED** | Opened and read at the cited line | The large majority |
| **PARTIAL** | Read, but the surrounding system was not traced end-to-end | ~20 entries (LearnHarness server/store/graph internals; some Plethora Rust modules) |
| **SPEC** | Documentation only | `docs/architecture.md`, `docs/teaching-methodology.md` |

**The specific PARTIAL items Run B most likely needs**: `src/agent/subagents/extraction.ts` (the merger's exact conflict semantics), `src/core/graph.ts` (LearnHarness), `src/server/jobs.ts` (LearnHarness), `src-tauri/src/ai_learning/retrieval.rs`, `src-tauri/src/algorithms/daqe/*`, `src-tauri/src/migrations/fsrs7_migration.rs`.
