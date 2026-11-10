# RUN B HANDOFF — AI Curricula, Examinations, Grading & Adaptive Learning

**Primary entry point for Kimi K3.1 Pro.**

| | |
|---|---|
| **Plethora commit** | `340661b2c5a42bf0c2a8fb7d5a5d384f3ef04481` (branch `main`, clean tree at audit start) |
| **LearnHarness commit** | `da08cb5f7d098598ba963c6689b22054c9f2a5a3` (branch `main`, cloned to `/tmp/plethora-learnharness-research`) |
| **Feature request** | https://github.com/melpomenex/Plethora/issues/6#issuecomment-6719953181 |
| **Research output** | `openspec/planning/study-plans-assessments-research/` (this directory) |
| **Run A scope** | **Research and technical investigation only.** No feature was designed, implemented, or specced. No production file was modified. No OpenSpec was created. No commit, branch, or push. |

> **Read `00-RUN-B-HANDOFF.md` (this file) first, then `04-FEATURE-GAP-MATRIX.md` and `05-REUSE-AND-ARCHITECTURAL-CONSTRAINTS.md`.** The other five files are reference detail.

---

## 1. The objective, restated

Deliver, in Plethora: AI-generated curricula from the user's imported material → customizable examinations (MCQ, multi-select, cloze, short-answer, essay) → automated grading → knowledge-gap identification → adaptive study recommendations — local-first, user-selected AI providers, user-controlled scheduling.

**The single most important reframing this research produced:** Plethora already has a deep, well-built **AI plumbing layer** (task runner, source grounding, retrieval, evidence coverage, concept graph, flashcard generation, free-response grading, tutor). What it lacks is an **artifact layer**: persistent curricula, exam blueprints, question banks, exam attempts, rubrics, and mastery estimation. Run B should build the artifact layer on the existing plumbing — **not** rebuild the plumbing.

---

## 2. What was investigated

| Area | Depth | Result file |
|---|---|---|
| LearnHarness end-to-end (agents, probe, plan, questions, grading, practice, graph, persistence, UI) | **Deep** — every named file read; the actual implementation verified against its docs | `01-LEARNHARNESS-END-TO-END.md` |
| Plethora current architecture (grounding, graph, coverage, task layer, tutor, assessment, flashcards, queue/FSRS, persistence, UI) | **Deep** — production call sites traced, not just declarations | `02-PLETHORA-CURRENT-ARCHITECTURE.md` |
| OpenSpec inventory, overlap, conflicts | **Deep** — every named spec + change read; every `[x]` re-verified against source | `03-EXISTING-OPENSPEC-AND-CONFLICT-AUDIT.md` |
| 40-capability feature-gap matrix | **Complete** | `04-FEATURE-GAP-MATRIX.md` |
| Reuse map, constraints, risks | **Complete** | `05-REUSE-AND-ARCHITECTURAL-CONSTRAINTS.md` |
| Open questions + research limitations | **Complete** | `06-OPEN-QUESTIONS-AND-RESEARCH-LIMITATIONS.md` |
| Source evidence index (navigable, ~250 entries) | **Complete** | `07-SOURCE-EVIDENCE-INDEX.md` |

---

## 3. The eight findings that must shape Run B

### F1 — The adaptive-learning-paths feature is a localStorage stub. Its archived OpenSpec lies.

`openspec/changes/archive/2026-10-15-implement-plethora-ai-generated-adaptive-learning-paths/tasks.md` marks **all 12 tasks `[x]`**, claiming SQLite migrations, `src-tauri/src/learning_paths/`, `commands/learning_paths.rs`, a deterministic planner, a `path-generation` task, an adaptation engine with version diffs, a Goal creator, a `PathView` DAG, a `NodeCard`, edit actions, a queue-composition feed, and a 6-locale i18n pass.

**None of it exists.** The only real code: `src/types/learningPaths.ts` (types + a topological sort) and `src/stores/learningPathsStore.ts` (a **localStorage** Zustand store). **No production consumer** — the sole reference is the debug registry at `src/main.tsx:358`.

This is not a one-off. The repo itself documents the same pattern twice more (see `03-...md` §7). **⇒ Never trust a task checkbox in this repo. Verify by call-site search excluding tests.**

### F2 — There is no mastery estimation anywhere in Plethora.

No mastery table in `migrations.rs`; no mastery code in Rust; `masteryEstimate` exists only in two unpopulated type files. The repo's own audit agrees: *"production searches found no replacement `coverageLevel`/`evidenceRefs` runner there… This completion program deliberately supplies evidence coverage only and does not implement that separate mastery/gap program"* (`openspec/planning/ai-learning-completion-audit.md`).

Mastery is therefore the **single largest new subsystem** in this feature.

### F3 — Plethora has a rigorous *evidence-coverage* system and a deliberate firewall around it. Mastery must not be wired into it.

`src/lib/ai/concepts/coverage.ts` (the strongest existing asset for this feature):
- `EvidenceCoverage = unknown | not-covered | partial | supported` (**content**)
- `CoverageActivity = none | encountered | studied | reviewed` (**history**)
- `CoverageLocator` (chunk / extract / card / annotation), `CoverageEvidenceRef` (with `sourceRevision` and `strength`), `COVERAGE_LIMITATIONS` (16 honest degraded-state keys).
- Module doctrine: *"It never models what a user knows, never reads a mastery score, and never lets model rationale or vector similarity raise an evidence level."*
- The change that built it (`complete-knowledge-relationships-and-coverage`, 16/16) explicitly excluded *"mastery scoring"* from scope and stated the goal as *"a usable evidence workflow **without claiming mastery**."*

**⇒ Reuse the coverage module verbatim as the content half. Put mastery in a separate module with separate UI language.**

### F4 — The canonical AI answer-assessment contract already exists, is well-built, and is persisted. What is missing is a **rubric**, not a grading envelope.

`src/lib/ai/schemas/answerAssessment.ts` → `{classification: correct|partial|incorrect|misconception, score, completeness, missingConcepts[], misconception?, feedback, suggestedCorrection?, confidence}`; fail-closed validator with `misconception` **required** when classified as such; persisted to `answer_assessments` with `provider`/`model` provenance (`migrations.rs:2817-2836`).

**Reuse the envelope; do not fork a parallel grading type.** Missing: rubric, aggregate score, attempt grouping, source citation on the grade, manual-correction field.

### F5 — The FSRS-isolation invariant the brief demands **already exists as a proven pattern**.

`src/components/review/answerAssessmentIntegration.ts:5-12`:
> *"Scheduler authority is preserved BY CONSTRUCTION… `recordCardAssessment` is a SEPARATE `record_answer_assessment` invoke fired after grading — it receives no scheduling inputs and touches no scheduling table. The `submitReview` call sequence is identical with or without an assessment present."*

**⇒ The exam path must copy this shape exactly. Exam questions must never be `learning_items` rows** (those carry `interval`, `ease_factor`, `due_date`, `state`, `lapses`).

### F6 — LearnHarness is a *tutoring* harness, not an examination platform. Its plans are session-scoped maps, not curricula.

Verified absences (repo-wide, word-boundary): `blueprint` 0 files · `rubric` 0 · `cloze` 0 · `essay` 0 · `flashcard` 0 · `fsrs` 0 · `curriculum` 0. The word "mastery" appears only in 4 comments naming an id-normalization contract.

Its plan is explicitly *"a map, not a syllabus"* (`src/agent/tools/plan.ts:71`) — a **structure-only, session-scoped, wholesale-replaced DAG whose progress is derived from the transcript and never stored** (`src/core/contracts/plan.ts:36-40`: progress fields *"GONE by design"*).

**⇒ LearnHarness contributes patterns, not a product. The 15 absent capabilities in Plethora must be built from scratch.**

### F7 — The single highest-value pattern to port: **precommitted, immutable answer keys**.

LearnHarness commits the answer **before** the learner sees the question and makes it structurally immutable:
- MCQ: `correctAnswer` keyed by **option value, never position** (`src/core/question-core.ts:185-188`).
- Free recall: *"COMMITTED before the learner ever sees the question… never revise the commitment after seeing his words, and never mark a wrong answer right to be kind"* (`question-core.ts:310-314`).
- Practice: *"committed BEFORE the learner sees the problem. This IS the reveal — never re-author it"* (`src/agent/tools/practice.ts:90-92`).
- The **client payload omits the answer** (`toClientQuestion`, `question-core.ts:688-697`).
- The model-visible answer result contains **only what the learner added** (`compactAnswerForModel`, `question-core.ts:779-802`).

Also port: the **gradeability invariant** — *"schema-valid ⇔ gradeable"*, with the validation rules mirroring the grading path exactly (`quizInputProblems`, `question-core.ts:112-142`), and **deterministic grading** (`isCorrect` exact-set match, `resolveCorrect` unknown-value-is-a-hard-error).

**Caveat to carry forward:** LearnHarness's immutability is enforced by *persistence order + prompt doctrine*, not mechanically. Plethora should make it **mechanically** immutable — a stored answer-key row the grader cannot rewrite.

### F8 — ⚠️ NAMING CONFLICT: `design-source-grounded-ai-curricula-and-assessments` is a flashcard-quality change wearing a curriculum/exam name.

**Verified:** its complete task list (all 9 unchecked) is cloze-bracket validation, prompt coherence for Q&A alignment, and Flashcard Studio routing calibration. Its own proposal declares the capability as *"Syntactic and semantic validation of AI-generated study cards, minimum-step enforcement for procedural cards, and accurate card complexity routing."* Its spec has exactly **two** requirements, both about cards. **It implements no curriculum and no examination.**

**⇒ Run B must (a) not treat it as existing implementation, (b) not rename or modify it, (c) use a distinct capability name, and (d) decide whether to *depend on* its validators (task 1.1's `validateGeneratedCard` in `src/lib/ai/schemas/recallQuestion.ts` is exactly what an exam question bank also needs) or implement independently.**

---

## 4. Capability status at a glance (40 rows in `04-FEATURE-GAP-MATRIX.md`)

**IMPLEMENTED (6):** material coverage analysis · cloze generation · AI grading · tutor · flashcard suggestions · provider selection

**PARTIAL (17):** study goals · source selection · concept extraction · prerequisite inference · diagnostic assessments · curriculum persistence (wrong medium) · topic progress · short-answer generation · question validation · answer-key commitment · exam preview/editing · grading provenance · knowledge-gap identification (types only) · misconception tracking · source-linked remediation · local-first · mobile compatibility

**SCAFFOLD-ONLY (1):** curriculum editing

**ABSENT (15):** AI curriculum generation · curriculum versioning/diff · multi-select generation · essay generation · exam blueprint configuration · exam attempt persistence · exam interruption/recovery · **deterministic grading** · rubric-based essay grading · manual grading correction · historical exam results · **mastery/uncertainty** · practice generation · (curriculum persistence is wrong-medium) · long-term mastery

**Two are structurally present but hollow:** curriculum persistence (localStorage) and knowledge-gap identification (types + a store whose `recordGap` has **zero** production callers).

---

## 5. What to reuse (exact APIs)

| Need | Reuse | Cost |
|---|---|---|
| Run AI generation | `runTask` (`src/lib/ai/tasks/runTask.ts`) + `registerTasks` + `reasoningFallback` twin pattern | Low |
| Ground in the user's library | `retrieveFromLibrary` / `getAIIndexStatus` (`src/api/ai-learning.ts`) | Low |
| Know whether the library *covers* a concept | `src/lib/ai/concepts/coverage.ts` **verbatim** | **Zero** |
| Canonical concept identity | `concepts` table + `src/api/concept-links.ts` (production-wired) | Low |
| Propose prerequisites | `prerequisiteTask` + `prerequisite-of` links | Low |
| Detect ungrounded / duplicate candidates | `checkCandidateGrounding`, `dedupeCandidates`, `DUPLICATE_SIMILARITY_THRESHOLD = 0.85` (`learnThisValidation.ts`) | Low |
| Grade free response | `assess-answer` + `AnswerAssessment` | Low |
| **Deterministic** MCQ / multi-select / cloze grading | **New** — port `isCorrect` + `resolveCorrect` (LearnHarness, ~30 lines) | Low |
| Dedupe questions | `recall_prompt_history` fingerprint pattern | Low |
| Tutor afterwards | `TutorSession` + `TutorSheet` | Low |
| Suggest flashcards | `learnThis` pipeline + `acceptLearnThis` | Low |
| Capture a study goal | `src/lib/daqe/sessionGoal.ts` (`normalizeSessionGoal`) | Low |
| Present a question + feedback + record the outcome | **The recall pipeline is production-wired in the reader** — `useRecallPrompts.ts` + `RecallPromptOverlay.tsx` | Low |
| Persist durably | SQLite + numbered migration (**next free ≈ 139**, re-derive) | Medium |
| Track versions / diffs | **New** | Medium |
| Exam + attempts | **New** | Medium |
| Rubrics | **New** | **High** |
| Mastery + uncertainty | **New** | **High** |
| Gap detection | **New** (types exist) | **High** |
| Resume interrupted work | **New** — Plethora has **no** persisted in-flight work and **no** job infrastructure | Medium |

---

## 6. Architectural constraints Run B must honour

1. **Every AI call goes through `runTask`** with a registered `AITaskDefinition`, a fail-closed `validate`, the `UNTRUSTED_CONTAINMENT_CLAUSE` in `systemInstruction`, and — for reasoning-class tasks — a declared `reasoningFallback` twin.
2. **Tasks propose; commands persist.** Follow the `concept_links` propose→accept/dismiss lifecycle. No silent mass creation.
3. **Never write FSRS scheduling state from an exam.** Separate tables; a separate `record_*` command fired *after* the learner's response.
4. **Coverage ≠ activity ≠ mastery.** Three separate modules, three separate UI languages. Never let model rationale or vector similarity raise an evidence level or a mastery estimate.
5. **User priority and user ratings stay authoritative.** AI output is advisory.
6. **Source grounding must be resolved against the live source**, not trusted from the model. `checkCandidateGrounding` (verbatim cloze) and the coverage runner's source hydration are the precedents.
7. **Model output must never mint identifiers.** Constrain the model to **opaque handles** (the `MAX_RELATIONSHIP_HANDLES = 24` pattern). Use server-assigned ids.
8. **Provider kind ≠ locality.** `AIProviderKind = "ondevice" | "cloud" | "local-model"` — `local-model` is a *user-configured* endpoint. Specify endpoint-aware privacy behaviour and disclose exactly which excerpts leave the device.
9. **Local-first:** a rules-only path must produce a valid, ordered, source-cited curriculum with no LLM (the `adaptive-learning-paths` spec requires this explicitly).
10. **Mobile budget:** the existing card generator needed its timeout raised 20 s → 60 s on Nano. Bound exam generation; prefer incremental generation; grade deterministically wherever possible so grading needs no model call.
11. **Two hard gates:** a new Settings control needs a target id + a `settingsSearchCatalog.ts` entry + a `settingsSearchCoverage.ts` row + tests (`AGENTS.md:13-21`, `docs/settings-search.md`). A new navigation destination must be added to `src/navigation/tabDestinations.ts` and pass its drift test.
12. **Additive migrations only**, with inline `#[cfg(test)]` coverage.

---

## 7. Must remain unchanged

Existing document data and lifecycle · flashcard identity (`learning_items.id`) · FSRS scheduling semantics · user priority / manual importance · the `submitReview` call sequence · AI provider privacy (`LlmRequestPolicy`, containment, feature flags) · the `AnswerAssessment` envelope · the `coverage-v1` ruleset · the `concept_links` lifecycle · unrelated learning workflows (review, reader recall, audio, language, NotebookLM) · the active `design-source-grounded-ai-curricula-and-assessments` change · migration numbering discipline.

---

## 8. Where models must not be trusted blindly

Generated **citations** (resolve against the live source) · **prerequisite relations** (model proposes, user accepts) · **correct answers** (commit before posing; make the commitment mechanically immutable) · **rubric scoring** (the hardest trust boundary — see D5) · **mastery estimates** (uncertain, probabilistic, never certain) · **persisted AI tool calls** (the learning agent's propose→approve pattern exists; do not let a model write a domain row directly).

---

## 9. Active OpenSpec conflicts & dispositions

| Artifact | Status | Disposition |
|---|---|---|
| `adaptive-learning-paths` | canonical spec; stub implementation | **EXTEND** — own the curriculum capability here |
| `knowledge-gap-detection` | canonical spec; types only | **EXTEND** — implement the mastery half |
| `ai-answer-assessment` | canonical spec; implemented | **REUSE + EXTEND** |
| `ai-task-architecture` | canonical spec; implemented | **REUSE** |
| `ai-learning-material-generation` | canonical spec; implemented | **REUSE** (mirror the pipeline shape) |
| `ai-knowledge-relationships` + `complete-knowledge-relationships-and-coverage` | 16/16 checked | **REUSE** (the "coverage ≠ mastery" template) |
| `ai-active-recall` | canonical spec; implemented in the reader | **REUSE** (question generation + fingerprint dedup + feedback + record) |
| `ai-socratic-tutoring` | canonical spec; implemented | **REUSE** as the remediation surface |
| `knowledge-graph`, `ai-library-rag`, `ai-semantic-index` | canonical specs; implemented | **REUSE** |
| **`design-source-grounded-ai-curricula-and-assessments`** | **ACTIVE, 0/9** | **AVOID** — do not extend, do not rename; use a distinct capability name; optionally *depend on* its validators |
| `complete-ai-learning-agent-integration` | ACTIVE, 19/19 | **REUSE** its propose→approve seam (verify wiring first) |
| `add-dynamic-adaptive-queue-engine` | ACTIVE, 130/134 | **REUSE** `sessionGoal.ts`; do not touch ranking |
| `fix-issue-6-scheduling-and-learning-workflows` | ACTIVE, 57/57 | **DO NOT MODIFY** — read for the priority-authority contract |
| `validate-ai-learning-cross-platform-readiness` | ACTIVE, 11/17 | **COORDINATE** |
| `harden-ai-learning-actions-and-card-quality` | ACTIVE, 0/18 | **COORDINATE** |

---

## 10. Open decisions Run B must make (full list in `06-...md` Part 1)

| # | Decision | Why it blocks |
|---|---|---|
| **D1** | Capability naming + OpenSpec placement; how to avoid the `source-grounded-ai-curricula-and-assessments` collision | Determines every file Run B writes |
| **D2** | Does the curriculum replace or sit beside the localStorage store? Which "goal" entity? | Two stores for one entity is a correctness hazard |
| **D3** | Is a curriculum a *plan of study* (references) or a *plan of teaching* (authored content)? | Drives cost, local-first feasibility, mobile viability |
| **D4** | Per-item-type grading policy (deterministic vs AI vs hybrid) | Determines offline gradability and model trust |
| **D5** | Rubric model: analytic vs holistic; per-exam vs per-concept; authored vs generated | Highest-cost subsystem |
| **D6** | Mastery inputs, output shape, and **Rust vs TS boundary** (coverage is TS, FSRS state is Rust) | Cascades into gaps, remediation, node progress |
| **D7** | Node progress: one composite or three indicators (coverage / activity / mastery)? | The spec forbids activity-inflated progress |
| **D8** | Attempt & generation lifecycle; resumability across restarts | No job infrastructure exists |
| **D9** | Multi-document citation envelope; chunk-id vs document-position durability; deletion behaviour | Durable citations are the difference between a trustworthy exam and a brittle one |
| **D10** | Share the `learnThis` candidate model with exam questions, or a separate schema? | Avoids a second cloze implementation |
| **D11** | Fixed paper vs adaptive exam | Reproducibility ⇒ historical reporting |
| **D12** | Provider + privacy policy for exam generation; what leaves the device | The brief calls this out explicitly |
| **D13** | Scope of the first increment | The implementation agent is a less capable model; sequencing is everything |

**Part 4 of `06-...md` lists 10 questions that require *user input*** (exam scope, length, adaptive-vs-fixed, whether exams consume study time, whether flashcards are suggested automatically, whether gap detection runs in background, rubric visibility, user override of grades, whether a diagnostic is a distinct artifact type).

---

## 11. Recommended deeper investigation before designing

**Plethora (highest value first):**
1. `src/lib/ai/concepts/coverage.ts` — read end-to-end; it is the model for the coverage/mastery firewall.
2. `src/components/viewer/useRecallPrompts.ts` + `RecallPromptOverlay.tsx` — the production "generate → dedupe → present → feedback → record" precedent.
3. `src/lib/ai/assistant/learningAgent.ts` + `learningAgentAcceptance.ts` — the propose→approve→persist pipeline; also check whether the agent's `AGENT_MAX_OUTPUT_TOKENS = 2048` / `AGENT_TRANSCRIPT_CHAR_BUDGET = 12_000` can host a full exam (probably not — a task-based flow with a persisted artifact is likely correct).
4. `src/lib/ai/tutor/context.ts` + `session.ts` — how a curriculum node + coverage evidence would be passed in as tutor context.
5. `src/lib/ai/tasks/runTask.ts` — the exact contract every new task must satisfy.
6. `src-tauri/src/algorithms/daqe/learning.rs` + `src-tauri/src/database/item_stats_repository.rs` — what FSRS/retrievability signals are reachable from TS (bears on D6).

**LearnHarness (read for the port, do not copy — AGPL-3.0):**
1. `src/core/question-core.ts` — the whole file is the single most valuable reference for gradeable question design.
2. `src/agent/tools/practice.ts` — commit-before-pose, hint ladder, miss classification.
3. `src/core/plan-tree.ts` + `src/agent/tools/mermaid-plan.ts` — DAG validation and cycle rejection (port the *validation*, not the Mermaid format).
4. `src/agent/tools/probe.ts` + `src/core/contracts/probe.ts` — the diagnostic assessment model.

---

## 12. Research limitations (full list in `06-...md` Part 3)

No code was executed (no builds, no tests, no `npm run bench:check`); LearnHarness's UI was not run; LearnHarness's `extraction.ts` (1,452 lines), `core/graph.ts` (695 lines) and `src/server/` were read selectively rather than line-by-line; Plethora's Rust modules were read selectively (though the **absence** claims are backed by repo-wide word-boundary searches); i18n was not swept; no device/emulator testing.

---

## 13. File index

| File | Lines | Read it for |
|---|---|---|
| **`00-RUN-B-HANDOFF.md`** | this | The whole picture in one page |
| `01-LEARNHARNESS-END-TO-END.md` | 1045 | What LearnHarness actually does — the probe→plan→teach→practice trace, the question/grading contracts, the graph, the persistence model, and the **adopt/adapt/reject matrix** |
| `02-PLETHORA-CURRENT-ARCHITECTURE.md` | 867 | The live Plethora audit — grounding, coverage, concepts, task layer, tutor, assessment, flashcards, FSRS, persistence, UI entry points, and the **claim-by-claim verification of the archived learning-paths change** |
| `03-EXISTING-OPENSPEC-AND-CONFLICT-AUDIT.md` | 313 | Every overlapping spec/change, what it really implements, and the disposition table |
| `04-FEATURE-GAP-MATRIX.md` | 569 | The 40-capability matrix with code paths, reusable infra, missing behaviour, risks, confidence |
| `05-REUSE-AND-ARCHITECTURAL-CONSTRAINTS.md` | 354 | Must-reuse subsystems, API boundaries, persistence/privacy/source-identity/provider/FSRS constraints, testing conventions, 18 numbered risks |
| `06-OPEN-QUESTIONS-AND-RESEARCH-LIMITATIONS.md` | 354 | 13 decisions + 12 evidence gaps (3 already resolved in a second pass) + 11 limitations + 10 user questions |
| `07-SOURCE-EVIDENCE-INDEX.md` | 318 | ~250 navigable file/symbol entries with confidence, grouped by subsystem, plus the **negative-search record** |

---

## 14. Statement of scope

**Run A did not design or implement the feature.** No domain model, schema, state machine, API, or UI was designed. No OpenSpec was created. No production source file was modified. No dependency was installed. No commit, branch, or pull request was created. The only filesystem change is the new `openspec/planning/study-plans-assessments-research/` directory (7 Markdown files, ~3,820 lines), which `git status` shows as the sole untracked path.

All architecture, contracts, schemas, migrations, and task decomposition remain **Run B's responsibility**, informed by the evidence in this directory.
