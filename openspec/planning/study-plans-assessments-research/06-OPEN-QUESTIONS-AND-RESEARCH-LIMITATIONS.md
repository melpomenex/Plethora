# Open Questions, Decisions Reserved for Run B & Research Limitations

**Plethora commit:** `340661b2c5a42bf0c2a8fb7d5a5d384f3ef04481`
**LearnHarness commit:** `da08cb5f7d098598ba963c6689b22054c9f2a5a3`

This document separates two different things that are easy to conflate:

- **MISSING EVIDENCE** — Run A did not find, or could not establish, a fact. Run B must **verify** it.
- **DECISION** — the evidence is sufficient; the answer is a **product/architecture choice** that Run B (and ultimately the user) must make.

Every question below is prioritized by **impact** on the implementation plan.

---

## PART 1 — DECISIONS (evidence is sufficient; Run B must choose)

### D1. Capability naming and OpenSpec placement — **HIGHEST PRIORITY**

**Known:** `adaptive-learning-paths` is the canonical Plethora capability for curricula and is currently a stub. `design-source-grounded-ai-curricula-and-assessments` is an **active** change that claims a capability id containing "curricula" and "assessments" but delivers flashcard syntax validation (0/9 tasks done). `ai-answer-assessment` already owns the word "assessment" for free-response answer grading.

**Unknown / to decide:**
1. Should the persistent curriculum **extend** `adaptive-learning-paths` (using `## MODIFIED Requirements`) or should a **new** capability be proposed alongside it?
2. What name for the exam capability? Candidates that avoid collision: `exam-generation-and-grading`, `study-examinations`, `assessment-blueprints`. **Avoid** `source-grounded-ai-curricula-and-assessments`.
3. Should exam grading be a **separate capability** from `ai-answer-assessment` (which is per-card, review-flow) or a modification of it?
4. Should the mastery/gap capability extend `knowledge-gap-detection` (recommended) or be new?

**Why it matters:** the capability ids determine which spec files Run B writes, which existing specs get `MODIFIED` sections, and whether the implementation agent lands in the right place.

**Run B must decide before writing any proposal.**

---

### D2. Where does a curriculum live, and does it replace or supersede the localStorage store?

**Known:** `src/stores/learningPathsStore.ts` is a localStorage Zustand store with no production consumer; `src/types/learningPaths.ts` holds the type shapes and a topological sort that does not reject cycles.

**To decide:**
1. Replace the localStorage store with a SQLite-backed implementation, or keep the store as a **client-side cache** over SQLite?
2. Does `LearningGoal` remain the goal entity, or is a new `study_goal` entity introduced (given `src/lib/daqe/sessionGoal.ts` already owns "session goal" and `src/components/goals/ReadingGoalsPanel.tsx` owns "reading goals")?
3. Does `LearningPathNode.prerequisiteNodeIds` become a real FK-backed edge table, or stay a JSON column?

**Why it matters:** three "goal" concepts already exist in the codebase with different meanings. Adding a fourth without disambiguation is a real risk.

---

### D3. Is the curriculum a *plan of study* or a *plan of teaching*?

**Known:** LearnHarness's plan is explicitly *"a map, not a syllabus"* (`src/agent/tools/plan.ts:71`) — a session-scoped structure-only DAG whose progress is derived from the transcript. Plethora's `adaptive-learning-paths` spec describes something much richer: concepts, rationales (`why_here`), source references, material-gap markers, mastery targets, and a queue feed.

**To decide:** Does a Plethora curriculum node carry **teaching content** (objectives, explanations, worked examples) or only **references to source material** (concepts, sources, ordering)?

**Why it matters:** it determines whether curriculum generation is a *retrieval+ordering* task (cheap, local-first friendly) or a *content-authoring* task (expensive, model-heavy, mobile-hostile). Given the local-first requirement and the mobile constraint, this decision drives almost everything else.

---

### D4. Deterministic grading vs AI grading — the per-item-type policy

**Known:** Plethora has only AI grading (`assess-answer` → `AnswerAssessment`). LearnHarness has deterministic MCQ grading (`isCorrect`, `resolveCorrect`) and model-graded free recall with a **precommitted** answer. Plethora's cloze cards have a deterministic deletion match available.

**To decide:** the grading policy per item type —
- MCQ / multi-select / cloze → deterministic only?
- Short answer → deterministic with accepted-variants, or AI, or both (deterministic first, AI fallback)?
- Essay → rubric-based AI, with a deterministic floor (e.g. word count / required concepts present)?

**Why it matters:** it determines whether an exam can run **fully offline after generation** (a stated local-first benefit) and how much the model can be trusted.

---

### D5. Rubric model: analytic vs holistic; fixed vs per-exam; authored vs generated

**Known:** no rubric exists anywhere. `AnswerAssessment` gives one overall `score`, `completeness`, and `missingConcepts[]` — a **holistic** shape.

**To decide:**
1. Analytic (per-criterion scores) or holistic (one score) or hybrid?
2. Are rubrics **per-exam** (authored for the exam) or **per-concept** (reusable across exams)?
3. Who authors rubrics — the model, the user, or a template system?
4. Are rubric criteria themselves source-grounded (must cite a source) or free-form?

**Why it matters:** this is the highest-cost new subsystem. A per-concept reusable rubric is far more valuable long-term but much harder; a per-exam rubric is simpler and disposable.

---

### D6. Mastery estimation: inputs, output shape, and the uncertainty contract

**Known:** the `knowledge-gap-detection` spec requires mastery *"blending FSRS retrievability, assessments, coverage, and recency"* with **variance/level**, and *"UI language SHALL remain probabilistic (no certainty claims)"*. `coverage.ts` explicitly refuses to model mastery. `KnowledgeGap` already has `masteryEstimate` + `variance`.

**To decide:**
1. Exact inputs and their weights.
2. Output shape: a point + variance? A band (`low/medium/high`)? A posterior?
3. Where is it computed — Rust (scheduler-adjacent, has FSRS state) or TS (has the coverage runner)? **This is a real architectural fork**: `coverage.ts` is TypeScript, FSRS state is Rust. A master estimate spanning both has a natural boundary problem.
4. How is it invalidated (a new exam attempt, a new source, a card lapse)?

**Why it matters:** mastery is the input to gap detection, remediation routing, and node progress. Getting its shape wrong cascades.

---

### D7. What is the unit of progress on a curriculum node?

**Known:** the spec says *"Path completion SHALL require terminal-node target mastery (estimate-based) or explicit user declaration — never inflated by activity metrics alone."* `coverage.ts` provides `CoverageActivity` (encountered/studied/reviewed) as an **orthogonal** axis.

**To decide:** does a node show (a) coverage, (b) activity, (c) mastery — three separate indicators — or a single composite? And what does the user *see* when they have read everything but demonstrated nothing?

**Why it matters:** it is the difference between an honest product and one that inflates progress. The spec forbids the inflated version.

---

### D8. Exam attempt lifecycle and recovery semantics

**Known:** Plethora persists no in-flight work. `runTask` supports cancellation but no resume. LearnHarness derives pending state from the persisted transcript.

**To decide:**
1. Is the attempt resumable across app restarts? (Requires persisting in-progress answers — new schema.)
2. Is generation resumable? (Requires a persisted generation job.)
3. Does a restart mid-exam resume, or does it abandon and let the user restart?
4. Is the attempt timed? (A timer has privacy, fairness, and mobile-background implications.)

**Why it matters:** Plethora has **no job infrastructure** (see `02-...md` §10.3). If resumability is required, Run B must also design a job/attempt model — a significant scope increase.

---

### D9. Multi-document citations: the envelope shape

**Known:** `CardSourceReference` is **single-document** (`document_id` + one `locator`). `CoverageEvidenceRef` is also one `documentId` per ref, but a *list* of refs is the natural unit. `concept_links.provenance_json` is a free-form JSON blob.

**To decide:**
1. Does an exam question carry **one** citation, a **list** of citations, or a primary + supporting list?
2. Is a citation to a *chunk* (fine-grained, rebuildable index) or to a *document position* (stable, durable) or both? The index is explicitly a **rebuildable cache** (`ai-semantic-index`), so chunk ids may not be durable across a reindex.
3. What happens to a question whose cited material is deleted — orphan-mark, auto-remove from future attempts, or keep with a "source unavailable" marker?

**Why it matters:** durable citations are the difference between a trustworthy exam and one that breaks on the next reindex.

---

### D10. Relationship to the existing `recall` and `learnThis` question generators

**Known:** Plethora has at least three AI question-producing paths: `learnThis` (cards from a selection), `recall-question` (in-reading prompts), and the learning agent's proposal tools. All three have their own schemas, validation, and dedup.

**To decide:** does the exam generator **reuse** `learnThis`'s candidate model (with exam-specific types added), or does it get its own question schema? Sharing means inheriting cloze/QA support; separate means a second cloze implementation.

**Why it matters:** duplication of cloze generation and validation across two subsystems is a real maintenance and correctness hazard.

---

### D11. Does an exam generate a *question bank* or a *fixed paper*?

**Known:** LearnHarness's answer is "fixed paper" — the teacher poses one question per turn, adaptively. The brief asks for *"customizable examinations"* with *"length of exam"* — which implies a fixed, pre-generated paper.

**To decide:** is the exam a **stable artifact** the user previews/edits and then takes (reproducible, gradeable, comparable across attempts), or an **adaptive** session that picks questions as it goes (not reproducible, harder to grade historically)?

**Why it matters:** reproducibility is a precondition for historical reporting and for "compare attempts". Also determines whether the answer key is committed before the attempt (D11 → precommitted key).

---

### D12. Provider and privacy policy for exam generation

**Known:** three provider kinds (`ondevice`, `cloud`, `local-model`); `LlmRequestPolicy` frozen pre-request and re-checked on retry; `remoteDenied` / `remoteEmbeddingConsent` limitations; the `local-model` kind is a **user-configured endpoint**, not necessarily local.

**To decide:**
1. Which provider may generate exam content — the same rules as card generation, or stricter?
2. What exactly leaves the device (question text with its answer key? the source excerpt? the concept list?).
3. Is a **cloud exam** allowed to persist its source excerpts in the cloud provider's logs? (Disclose, or forbid by routing to a provider with a no-retention mode?)
4. Does a "local-model" endpoint count as local for the disclosure?

**Why it matters:** the brief explicitly calls out *"local-first operation and user-selected AI providers"* and warns that *"provider classification alone may not prove an endpoint is local"*.

---

### D13. Scope of the first increment

**Known:** 15 capabilities are absent; 3 subsystems (rubrics, mastery, gap detection) are high cost. Plethora's history shows a pattern of large multi-proposal programs (`issue-6-comprehensive-remediation-plan.md` → 8 proposals).

**To decide:** ship order. A plausible minimum that is genuinely useful and low-risk:
1. Deterministic question types (MCQ / multi-select / cloze) with a committed answer key + blueprint + attempt + deterministic grading + history.
2. Then rubric-based essay grading.
3. Then mastery + gaps + remediation.
4. Curriculum authoring (manual-first, AI-assisted) either first (as the source of exams) or later.

**Why it matters:** the brief asks for a *monumental* feature, but the implementation agent is a less capable model. Sequencing is the difference between a working system and a large pile of half-landed changes.

---

## PART 2 — MISSING EVIDENCE (Run B must verify; Run A could not establish)

### E1. The `ai-knowledge-relationships` spec vs the live coverage implementation — ✅ **RESOLVED IN RUN A (second pass)**

**Resolution:** `src/api/concept-links.ts` **exists** and has **many production consumers**:
`src/lib/ai/concepts/relationships.ts`, `src/lib/ai/concepts/coverage.ts`, `src/lib/ai/schemas/conceptRelationship.ts`, `src/services/recording/conceptRelationsAdapter.ts`, `src/components/recording/SessionConceptRelations.tsx`, `src/pages/KnowledgeGraphPage.tsx`, `src/lib/ai/agent/tools/relationshipAdapter.ts`, `src/components/viewer/SelectionActionsSheet.tsx`, `src/components/graph/conceptProjection.ts`.

The prior audit's *"No frontend command callers were found"* was true at baseline `615570ff` but is **no longer true** at `340661b`. **The concept graph is production-wired.**

**Remaining (low):** whether every one of the 16 Rust `concept_links` commands has a production caller, or only a subset. Not blocking.

**⇒ Implication for Run B:** the concept graph is a usable, live substrate for curriculum construction. Do not plan to build it.

---

### E2. Whether the learning agent's proposal path can host curriculum/exam generation — **HIGH**

**Known (Run A correction):** `runLearningAgent` **is** called from production UI code — `src/components/assistant/AssistantPanel.tsx:2018` — with `src/lib/ai/assistant/learningAgent.ts` providing `preflightLearningAgent`, `createFrozenAgentEnvironment`, `bindLearningAgentPlan`, `createLearningAgentGuard`, `recordLearningAgentStage`, `runLearningAgent`; plus `learningAgentAcceptance.ts` (`buildAgentProposalGroups`, `validateAgentCardReview`, `deriveConceptKey`, `proposalToLearningCandidate`) and `learningAgentHandoff.ts`.

**This corrects** the prior audit's *"Only tests call the loop"* — that was true at `615570ff`, not at `340661b`.

**What remains unknown:** the agent's **tool registry** — can it call a *new* "propose curriculum" / "propose exam" tool, and what are the constraints on a tool that returns a **large structured artifact** rather than a card? `AGENT_MAX_OUTPUT_TOKENS = 2048` and `AGENT_TRANSCRIPT_CHAR_BUDGET = 12_000` (`src/lib/ai/agent/loop.ts:85,92`) are tight for a full exam.

**How to verify:** read `src/lib/ai/agent/registry.ts` and `src/lib/ai/agent/tools/proposals.ts` (829+ lines); read `learningAgentAcceptance.ts` end-to-end.

**Why it matters:** it determines whether Run B builds a **new task-based generation flow** (recommended) or extends the agent. Given the output-size limits, a **task-based flow with a persisted artifact** is likely correct — but Run B must confirm.

---

### E3. `propose_link` stub status — MEDIUM

**Known:** `src/lib/ai/agent/tools/proposals.ts:829` — *"propose_link (concept links: draft-only adapter, typed unavailable)"*, tool at `:852`, input validation at `:897`. The coverage change task 3.4 said *"Expose a read-only/draft relationship adapter for `agent/tools/proposals.ts` to replace the unavailable seam"* (16/16 checked).

**What remains unknown:** whether the adapter is now functional or still returns "unavailable".

**Why it matters:** it indicates whether the agent→concept-graph path is live, which is adjacent to curriculum authoring.

---

### E4. Whether `src/components/graph/` renders the *concept* graph or the *document* graph — ✅ **RESOLVED IN RUN A (second pass)**

**Resolution:** **Both.** `src/pages/KnowledgeGraphPage.tsx` (29 KB) is the live page; `src/components/graph/conceptProjection.ts` provides:
- `conceptNodeId(conceptId)` (14), `isConfirmedConceptLink(link)` (18),
- `ConceptGraphProjection` (38), `buildConceptGraphProjection(input)` (48),
- `requestConceptFocus(conceptId)` (127) / `consumeConceptFocus()` (133) / `subscribeConceptFocus(listener)` (139) — **focus navigation between surfaces**.

`src/components/graph/KnowledgeGraph.tsx` and `NodeDetailView.tsx` also reference concepts.

**⇒ Implication for Run B:** the Knowledge Graph page is a **real host surface** for a Study Plans feature, and the concept→graph projection machinery already exists. This materially lowers the UI cost. Note the archived learning-paths change's claimed `PathView DAG (e-ink safe)` and the coverage change's claimed `KnowledgeGraphPage.tsx` are both consistent with this page existing.

**Remaining (low):** whether the concept graph renders **pending (unaccepted) links** or only confirmed ones — `isConfirmedConceptLink` suggests confirmed-only, which matches the spec's *"pending links excluded from confirmed edges"* scenario.

---

### E5. The `recall` active-recall prompt flow's full production wiring — ✅ **RESOLVED IN RUN A (second pass)**

**Resolution:** **It is production-wired in the reader.**
- `src/components/viewer/useRecallPrompts.ts` — the hook.
- `src/components/viewer/RecallPromptOverlay.tsx` — the overlay.
- `src/components/viewer/DocumentViewer.tsx` — the host.
- `src/components/viewer/recallChunkSampling.ts` — chunk sampling for prompt selection.
- `src/stores/settingsStore.ts`, `src/stores/reviewStore.ts` — settings/state.

**⇒ Implication for Run B:** this is the **closest existing end-to-end precedent** for the whole feature: generate a question from source → dedupe by fingerprint → present it during reading → grade/feedback → record the outcome → optionally promote to a durable card (`ai-active-recall` req. *"Promotion to durable card"*). Read `useRecallPrompts.ts` + `RecallPromptOverlay.tsx` before designing the exam presentation flow.

**Remaining (low):** whether the fingerprint dedup is enforced at generation time or only recorded post-hoc.

---

### E6. The `coverage.ts` runtime cost at scale — MEDIUM

**Known:** `MAX_COVERAGE_CONCEPTS = 12`, `COVERAGE_RETRIEVAL_K = 6`, `COVERAGE_QUERY_CONCURRENCY = 2` — deliberately bounded. `coverageOf`/`runCoverageAnalysis` hydrate every retrieval hit against the live source record.

**What remains unknown:** the wall-clock cost of a 12-concept run on a mid-range phone with a large library. An exam blueprint might want 30+ concepts.

**Why it matters:** if a curriculum has 40 nodes, coverage over all of them may need a different execution shape (batched, incremental, or a persisted per-node result).

---

### E7. Whether `answer_assessments.item_id` has any FK to `learning_items` — LOW (verified absent FK)

**Known:** the table has **no** FOREIGN KEY clause. `item_id` is a bare `TEXT`.

**What remains unknown (low impact):** whether anything joins on it.

**Why it matters:** minimal — but confirms the exam path must not reuse this table for attempts.

---

### E8. The FSRS-7 migrator's exact semantics for retrievability — MEDIUM

**Known:** `src-tauri/src/migrations/fsrs7_migration.rs` exists; `RANKER_RUBRIC_VERSION = 2` references the policy `M = 0.8 * T + 0.2 * P` (SRS/memory urgency term). `src-tauri/src/database/repository.rs` references FSRS.

**What remains unknown:** the exact retrievability quantity available per item (stability? retrievability?) and whether it is exposed to the frontend.

**Why it matters:** mastery estimation wants *"FSRS retrievability"* as an input (spec requirement). Whether that value is accessible in TS determines whether mastery must be computed in Rust.

---

### E9. Rust↔TS boundary for mastery — MEDIUM (an architectural fork, see D6)

**Known:** `coverage.ts` (TS) has the coverage signals; `learning_items` (Rust) has the FSRS state; `concept_links` (Rust) has the concept graph; `item_stats_repository.rs` has per-item stats.

**What remains unknown:** whether a single component can see both sides. The pattern in the codebase is: TS calls Rust commands via `invokeCommand` and receives typed records.

**Why it matters:** it decides whether mastery is a Rust command (has FSRS) or a TS module (has coverage) or a split (TS computes coverage-derived features → Rust blends with FSRS).

---

### E10. The `entitlements` / paywall position for this feature — LOW

**Known:** `CapabilityId::AdaptiveLearningPaths => "adaptive_learning_paths"` exists in `src-tauri/src/entitlements/snapshot.rs:57`. `src/types/paywall.ts` contains the only `curricul*` string in the codebase.

**What remains unknown:** whether the feature is intended to be paid, and whether the existing capability id is already wired to any UI.

**How to verify:** `rg -n "adaptive_learning_paths" src src-tauri/src`.

**Why it matters:** decides whether Run B adds a new entitlement id or reuses this one.

---

### E11. The `docs/IMPLEMENTATION_STATUS.md` claims — LOW (trust calibration)

**Known:** the prior audit noted *"docs/IMPLEMENTATION_STATUS.md:199 describes broad AI/RAG functionality, not completion evidence"*.

**Why it matters:** another document that may overstate. Run B should treat **only** call-site evidence as proof.

---

### E12. Whether the `design-source-grounded-ai-curricula-and-assessments` change will land first — MEDIUM (coordination)

**Known:** 0/9 tasks done; it owns `src/lib/ai/schemas/recallQuestion.ts` and `src/components/review/studio/DraftCardList.tsx`.

**What remains unknown:** whether it will be implemented before or after Run B's work.

**Why it matters:** if it lands first, exam validation should depend on its `validateGeneratedCard`; if not, exam validation must be independent (and must not create a merge conflict on `recallQuestion.ts`).

---

## PART 3 — RESEARCH LIMITATIONS OF RUN A

Stated plainly so Run B does not over-trust this document.

| # | Limitation | Impact |
|---|---|---|
| L1 | **No code was executed.** No builds, no tests, no `npm run bench:check`. All findings are from reading source. | A behavioural claim that depends on runtime (e.g. exact timing, actual mobile performance) is unverified. |
| L2 | **LearnHarness's UI was not run.** Its components were read, not exercised. | The UI data-flow description is source-derived; runtime behaviour (streaming, reconnection) is documented from `docs/architecture.md` + code, not observed. |
| L3 | **LearnHarness's `src/agent/subagents/extraction.ts` (1,452 lines) was read selectively** — exports, key constants, and the pipeline contract — not line-by-line. | The extractor's internal prompt/validation details are described at the contract level, not the prompt level. The auditor's identity-verdict mechanics are described from `contracts/graph.ts` + `docs/architecture.md`. |
| L4 | **LearnHarness's `src/core/graph.ts` (695 lines) and `src/server/` were not read end-to-end.** | The mergeer's exact conflict-resolution semantics are inferred from `contracts/graph.ts` comments and the architecture doc. |
| L5 | **Plethora's `src-tauri/src/` was read selectively** — tables, commands, migration numbers, and key algorithms — not every repository module. | A hidden table or command that overlaps the feature could exist. The targeted searches for `exam`, `curricul`, `blueprint`, `rubric`, `StudyPlan`, `mastery` were repo-wide, so the *absence* claims are strong; the *presence* claims about adjacent subsystems are weaker. |
| L6 | **The `src/` component tree was inventoried, not read.** | A component may implement part of a capability without the capability's keywords appearing. Mitigated by the keyword searches (which used word boundaries) plus checking production consumers for the two orphan stores. |
| L7 | **i18n coverage was not audited.** | The archived learning-paths change claimed "i18n 6 locales"; the absence of i18n keys was inferred from the absence of the components, not from a locale sweep. |
| L8 | **Platform capability runtime behaviour was not verified** (no device, no emulator). | Matches the repo's own stated limitation (`validate-ai-learning-cross-platform-readiness`: *"This audit executed no physical-device inference"*). |
| L9 | **Both repos were read at a single commit.** | Plethora's `main` is active; the commit SHA is recorded so line anchors can be re-checked after a rebase. |
| L10 | **The `exam`/`rubric`/`quiz` absence searches were case-insensitive regex over `src/` and `src-tauri/src/`, excluding `__tests__`.** | Test-only or doc-only mentions are not counted; a capability implemented purely in a test harness would be missed. |
| L11 | **LearnHarness was cloned `--depth 50`.** | Full history is unavailable, so "when was X added" questions cannot be answered. The working tree is complete at `da08cb5`. |

---

## PART 4 — QUESTIONS THAT REQUIRE **USER INPUT** (product decisions)

These are not technical unknowns; they are choices only the requester can settle. Run B should surface them explicitly.

1. **Exam scope** — one document? a collection? the whole library? a user-picked set?
2. **Exam length and mix** — how many items, which formats, how much time? Fixed defaults the user can tune?
3. **Is the exam adaptive or fixed?** (D11)
4. **Should the exam draw only from material the user has actually read/studied, or from the whole imported library?** (A major pedagogical fork.)
5. **Should exams consume study time / queue slots, or live entirely outside the scheduler?** (The brief says "preserving user control over scheduling" — but does an exam count as studying?)
6. **Should the AI propose flashcards after an exam automatically, or only on request?** ("optional flashcards" suggests on-request.)
7. **Should gap detection run continuously in the background, or only on demand after an exam?** (The spec says background/idle-gated; the background-job infrastructure does not exist.)
8. **Is a rubric visible to the user before they take the exam?** (Transparency vs. difficulty.)
9. **Can the user override the AI's grading?** (The brief implies user control; the current implementation has no override.)
10. **Should a "diagnostic" exam be a distinct artifact type from a "graded" exam?** (LearnHarness's `probe_done` suggests yes.)
