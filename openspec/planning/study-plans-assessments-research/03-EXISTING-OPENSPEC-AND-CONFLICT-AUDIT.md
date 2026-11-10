# Existing OpenSpec Inventory, Overlap & Conflict Audit

- **Plethora commit:** `340661b2c5a42bf0c2a8fb7d5a5d384f3ef04481` (`main`)
- **LearnHarness commit:** `da08cb5f7d098598ba963c6689b22054c9f2a5a3` (`main`)

> **Method:** every claim below was checked against the live tree at the Plethora commit above. **Task checkboxes were never trusted as evidence of implementation** — each was re-verified by searching for the claimed file/symbol/table. This proved necessary: see §3.

---

## 1. How to read this document

Status vocabulary used throughout:

| Status | Meaning |
|---|---|
| **IMPLEMENTED** | The capability exists in production code and is reachable from a user surface. |
| **PARTIAL** | Real implementation exists but is narrower than the spec claims, or lacks a required part. |
| **SCAFFOLD-ONLY** | Types, a store, or a spec exist but no producer, consumer, persistence, or UI. |
| **SPEC-ONLY** | Described in a spec or change; not found in production code. |
| **STALE-COMPLETE** | A change marks tasks `[x]` but the claimed implementation is absent. **Highest risk class.** |
| **ACTIVE** | A change directory exists in `openspec/changes/` (not archived). |
| **ARCHIVED** | A change directory exists in `openspec/changes/archive/`. |

---

## 2. Canonical (archived) specifications that overlap the requested feature

### 2.1 `openspec/specs/adaptive-learning-paths/spec.md` — **STALE-COMPLETE / SCAFFOLD-ONLY**

| Field | Value |
|---|---|
| Status | **STALE-COMPLETE** (archived change) / **SCAFFOLD-ONLY** (live tree) |
| Intended functionality | 6 requirements: concept-graph-derived deterministic ordering with `why_here` rationales + source refs or material-gap markers; versioned paths with reviewable diffs and user-locked nodes; signal-based honest progress (terminal-node mastery); optional additive queue feed; local-first rules-based planning with quota-bounded cloud jobs; first-class scoped goals with full history. |
| Actual implementation | `src/types/learningPaths.ts` (types + a Kahn topological sort that does **not** reject cycles) and `src/stores/learningPathsStore.ts` (a **localStorage** Zustand store). **No production consumer** — the only reference is the debug registry at `src/main.tsx:358`. |
| Overlap with the requested feature | **Very high.** This is the canonical Plethora capability name for "curriculum / study plan". |
| Recommendation | **Reuse the capability name and the type shape; extend rather than duplicate.** The archived change's claims must **not** be treated as a baseline. |
| Naming conflict | The spec name `adaptive-learning-paths` is already taken. A new change that modifies it must use `## MODIFIED Requirements`, not a new capability. |
| File-ownership conflict | `src/stores/learningPathsStore.ts` + `src/types/learningPaths.ts` are claimed by the (unimplemented) archived change. New work should own these files or replace them wholesale — but **must not** silently leave a localStorage store shadowing a SQLite-backed one. |

**The archived change:** `openspec/changes/archive/2026-10-15-implement-plethora-ai-generated-adaptive-learning-paths/`
All 12 tasks `[x]`. Full claim-by-claim verification table in `02-PLETHORA-CURRENT-ARCHITECTURE.md` §1.4. **9 of 12 claims are entirely absent; 1 is partial; 2 are N/A.**

### 2.2 `openspec/specs/ai-answer-assessment/spec.md` — **IMPLEMENTED**

| Field | Value |
|---|---|
| Requirements | Structured free-response assessment (classification/score/completeness/confidence/omitted key points); **Scheduler authority is preserved**; assessment persistence and provenance; graceful unavailability; calibration evaluation. |
| Actual implementation | `src/lib/ai/schemas/answerAssessment.ts` (125 lines, fail-closed validator); `src/lib/ai/tasks/definitions/assessmentTask.ts` (127 lines, reasoning + full fallback, adversarial-answer containment); `src/components/review/AssessmentPanel.tsx`; `src/components/review/answerAssessmentIntegration.ts`; `src-tauri/src/commands/answer_assessment.rs` (513 lines, 3 commands); `answer_assessments` table (`migrations.rs:2817-2836`) with `provider`/`model` provenance columns. |
| Overlap | **High** — this is Plethora's canonical free-response grading contract. |
| Recommendation | **REUSE the `AnswerAssessment` envelope.** Do **not** fork a parallel grading type. |
| Gaps for exams | No rubric, no aggregate score, no attempt grouping, no source citation column, no manual-correction field. |

### 2.3 `openspec/specs/ai-task-architecture/spec.md` — **IMPLEMENTED** (the integration spine)

| Requirements | Unified task execution layer (`runTask`); capability-aware availability; **structured output is validated and fail-closed**; unified error taxonomy with graceful degradation; cancellation and request coalescing; untrusted content containment; diagnostics without user content. |
| Actual implementation | `src/lib/ai/tasks/{types,registry,router,runTask,containment,completion}.ts` (1,151 lines total). |
| Overlap | **Foundational.** Every exam-generation task must be a registered `AITaskDefinition`. |
| Recommendation | **REUSE.** New tasks register via `registerTasks(...)` and follow the `reasoningFallback` twin pattern. |

### 2.4 `openspec/specs/ai-learning-material-generation/spec.md` — **IMPLEMENTED**

| Requirements | "Learn this" action; knowledge-type-aware card candidates; candidate validation; preview/edit/accept/reject/regenerate; provenance retention; no silent mass creation. |
| Actual implementation | `learnThisTask.ts` + `learnThisValidation.ts`; `src/lib/ai/schemas/learningMaterial.ts`; `src/components/learn/{LearnThisProposalSheet.tsx,acceptLearnThis.ts}`; `src/components/viewer/SelectionActionsSheet.tsx`. |
| Overlap | **High** — the generation/validation/approval pipeline is the closest analogue to exam question generation. |
| Recommendation | **REUSE the pipeline shape** (task → schema → per-candidate validation → flagged preview → explicit accept). Reuse `checkCandidateGrounding` + `dedupeCandidates` + `DUPLICATE_SIMILARITY_THRESHOLD` directly. |

### 2.5 `openspec/specs/ai-knowledge-relationships/spec.md` — **IMPLEMENTED**

| Requirements | Prerequisite inference; evidence-based coverage with hedged language; typed concept links with confidence and provenance; related-content discovery; passage extract-worthiness. |
| Actual implementation | `prerequisiteTask.ts`, `relationshipTask.ts`, `src/lib/ai/concepts/{coverage,relationships}.ts`, `concept_links.rs` (16 commands), `concepts`/`concept_links` tables. |
| Overlap | **Very high** — prerequisite inference and grounded concept coverage are core curriculum inputs. |
| Recommendation | **REUSE.** Build curricula on top of the concept graph + coverage runner; do not re-implement prerequisite inference. |

### 2.6 `openspec/specs/ai-socratic-tutoring/spec.md` — **IMPLEMENTED**

| Requirements | Socratic tutoring mode; responsive tutoring with bounded context; progressive hints, stuck detection, escape hatch; task-policy routing with graceful fallback; **grounding and learning-object conversion**. |
| Actual implementation | `src/lib/ai/tutor/{session,context,lesson}.ts`; `src/components/tutor/TutorSheet.tsx`; `tutorTask.ts`. |
| Overlap | **Medium-high** — the tutor is the natural remediation surface after an exam. |
| Recommendation | **REUSE for remediation.** The tutor's grounding already comes from `retrieveFromLibrary(topic, k≈3)`; a curriculum node's `conceptId` + coverage evidence refs are sufficient inputs. **Do not build a replacement tutor.** |

### 2.7 `openspec/specs/ai-active-recall/spec.md` — **IMPLEMENTED**

| Requirements | Optional active-recall reading mode; interruption budget; **question deduplication by fingerprint**; recall loop with feedback; promotion to durable card. |
| Actual implementation | `recallTask.ts` (`RECALL_QUESTION_TASK_ID = "recall-question"`); `recall_prompt_history` table (`migrations.rs:2803-2815`) with `fingerprint`, `chunk_ids`, `outcome`; `src-tauri/src/commands/recall_history.rs`. |
| Overlap | **High** — the closest existing **question-generation + fingerprint-dedup + feedback-loop** implementation. |
| Recommendation | **REUSE the fingerprint-dedup pattern** for exam question banks (normalized question text + concept keys ⇒ fingerprint ⇒ suppress near-duplicates). |

### 2.8 `openspec/specs/ai-library-rag/spec.md` — **IMPLEMENTED**

| Requirements | Library-wide grounded QA; honest handling of weak/missing evidence; **source references navigate to origin**; durable indexing policy; privacy and offline indicators. |
| Actual implementation | `src-tauri/src/ai_learning/{retrieval,indexer,chunker}.rs`; `src/api/ai-learning.ts`; `src/lib/ai/concepts/coverage.ts`. |
| Overlap | **High** — grounding + navigable citations for generated content. |
| Recommendation | **REUSE the retrieval + citation navigation path.** |

### 2.9 `openspec/specs/ai-semantic-index/spec.md` — **IMPLEMENTED**

| Requirements | Semantic chunking **with source-location metadata**; embedding provider abstraction; incremental indexing lifecycle; retrieval API with **lexical fallback** and prefilter; index data is a rebuildable cache; index status visibility. |
| Actual implementation | `src-tauri/src/ai_learning/*`; `ChunkLocation` in `src/api/ai-learning.ts`. |
| Overlap | **Foundational** for source grounding. |
| Recommendation | **REUSE.** Chunk locators are the finest-grained citation anchor available. |

### 2.10 `openspec/specs/knowledge-gap-detection/spec.md` — **SPEC-ONLY**

| Requirements | 6 gap kinds via documented rules; every gap explainable and disputable; **mastery estimates express uncertainty**; actions route to concrete remediation (Explain / Teach me / Find material / Generate practice / Make cards / Dismiss); local-first with capability-gated model analysis; no mid-session interruption. |
| Actual implementation | **Types only.** `src/types/knowledgeGaps.ts` defines all 6 kinds + `masteryEstimate` + `variance` + `GapEvidence`. `src/stores/knowledgeGapsStore.ts` is a localStorage store whose `recordGap` has **zero production callers**. **No detection engine, no SQLite table, no UI.** |
| Overlap | **Very high** — this is the canonical Plethora capability for the "reveals gaps in your knowledge" requirement. |
| Recommendation | **REUSE the capability name and the `KnowledgeGap` shape.** The **mastery** half is entirely unimplemented and is the single largest new subsystem in this feature. |
| Note | The spec's remediation actions map **exactly** onto the requested feature (Teach me → tutor; Generate practice / Make cards → practice + flashcards; Find material → library search). |

### 2.11 `openspec/specs/knowledge-graph/spec.md` — **IMPLEMENTED**

| Requirements | Graph edges always retain provenance (orphan-mark, don't drop); incremental budgeted correctable extraction; conservative entity resolution; budget-bounded graph queries; local-first with capability-gated cloud extraction; graph feeds downstream features. |
| Actual implementation | `src/components/graph/*`; `src/components/tabs/knowledge/*`; `concepts`/`concept_links` tables. |
| Overlap | **High** — the concept graph is the substrate for prerequisites and remediation. |
| Recommendation | **REUSE.** Note the *"orphan-mark affected edges (preserving audit)"* rule — the same rule must apply to exam questions citing deleted documents. |

### 2.12 `openspec/specs/document-qa-study-artifact-generation/spec.md` — **IMPLEMENTED**

| Requirements | Cloze deletion generation from selection; Q&A card generation from selection; brainstorm prompt helpers; **artifact provenance tracking**. |
| Actual implementation | `src/components/tabs/DocumentQATab.tsx`, `DocumentQASources.tsx`, `src/components/notebooklm/*`. |
| Overlap | **Medium** — proves cloze generation + provenance tracking already work end-to-end. |
| Recommendation | **REUSE the cloze generation + provenance approach**; consider whether the Document QA workspace is the right host for exam authoring. |

---

## 3. ⚠️ THE NAMING CONFLICT — `design-source-grounded-ai-curricula-and-assessments`

**This is the single most important conflict for Run B.**

### 3.1 The change

`openspec/changes/design-source-grounded-ai-curricula-and-assessments/` — **ACTIVE** (not archived).

Files: `proposal.md`, `design.md`, `investigation.md`, `tasks.md`, `traceability.md`, `verification.md`, `specs/source-grounded-ai-curricula-and-assessments/spec.md`.

### 3.2 What it actually is (VERIFIED)

**It is a flashcard syntax/semantics validation + Studio routing change. It is not a curriculum or examination platform.**

Its own `proposal.md` "Why" section:

> *"AI flashcard and curricula generation is only as valuable as the pedagogical quality of the synthesized items. Currently, AI card generation frequently produces non-sequitur Q&A pairs … misclassifies single Q&A items as 'Ordered steps' … generates cloze cards missing mandatory `{{c1::...}}` syntax … and flags ordinary simple Q&A cards as complex, forcing users into an unnecessary Flashcard Studio redirect."*

Its own "New Capabilities" declaration:

> *"`source-grounded-ai-curricula-and-assessments`: Syntactic and semantic validation of AI-generated study cards, minimum-step enforcement for procedural cards, and accurate card complexity routing."*

Its complete task list (`tasks.md`) — **all 4 tasks unchecked `[ ]`, i.e. NOT implemented**:

| # | Task | Area |
|---|---|---|
| 1.1 | `validateGeneratedCard` in `src/lib/ai/schemas/recallQuestion.ts` (valid cloze brackets, degrade 1-step `ordered-steps` → `qa`) | card syntax |
| 1.2 | Execute `validateGeneratedCard` in `src/features/assistant/chatFlashcardArtifacts.ts` | card syntax |
| 1.3 | Vitest tests in `src/lib/ai/schemas/__tests__/recallQuestion.validation.test.ts` | card syntax |
| 2.1 | Refactor the generation system prompt for strict question-answer semantic alignment and atomic focus | prompt quality |
| 2.2 | Unit test verifying prompts require ≥2 steps for sequential procedures | prompt quality |
| 3.1 | Complexity logic in `src/components/review/studio/DraftCardList.tsx` — reserve Studio redirects for multi-deletion clozes, complex occlusions, multi-line LaTeX | routing |
| 3.2 | Standard Q&A cards render inline edit controls in Chat and Review | routing |
| 3.3 | Component test `src/components/review/studio/__tests__/DraftCardList.complexity.test.tsx` | routing |
| 3.4 | Run `npm run bench:check` | gate |

**Its spec (`specs/source-grounded-ai-curricula-and-assessments/spec.md`) has exactly TWO requirements:**
1. *"Syntactic and structural validation of generated cards"* — cloze `{{c1::...}}` validity; `ordered-steps` → `qa` degradation.
2. *"Accurate card complexity classification"* — simple Q&A and single-deletion cloze stay inline; no Studio redirect.

### 3.3 The conflict — precisely stated

| Dimension | Finding |
|---|---|
| **Name implies** | Source-grounded AI **curricula** and **assessments** as learning artifacts. |
| **Delivers** | Flashcard **syntax validation** + **Studio routing calibration**. |
| **Curriculum generation** | **ABSENT** — no curriculum, path, module, objective, or prerequisite-plan generation. |
| **Assessment/exam generation** | **ABSENT** — no exam, blueprint, question bank, attempt, rubric, or grading. |
| **"Source-grounded"** | Only one bullet: *"Ground all generated cards in verified source passage spans, attaching citation handles and text offsets."* — and it is a card-level concern. |
| **Status** | **ACTIVE, 0/9 tasks done.** |
| **Capability name collision** | It **claims the capability id** `source-grounded-ai-curricula-and-assessments` for a flashcard-validation scope. Any new curricula/exams capability would collide on the words *curricula* and *assessments*. |

### 3.4 Why this matters to Run B

1. **Do not treat this change as the existing implementation of the requested feature.** It is not.
2. **Do not rename or modify it in Run A** (per the brief). Run B must decide: (a) let it complete as a flashcard-quality change and use a **distinct** capability name for curricula/exams; or (b) propose an explicit rename/scope-split. **Option (a) is lower risk** — it avoids touching an in-flight change.
3. **There is a genuine seam worth sharing:** task 1.1's `validateGeneratedCard` (cloze bracket validity) and task 2.1's *"strict question-answer semantic alignment"* are **exactly the validators an exam question bank needs**. Run B should plan to **depend on** that change landing (or reimplement the same validators in a shared module) rather than duplicate them.
4. **`recallQuestion.ts` is the file that would hold a shared card/question validator** — a plausible home for exam-question validation if the change lands first. But if it does not land, exam validation must not depend on it.

### 3.5 Other capability-name collisions to avoid

| Existing capability id | Owner | Collision risk |
|---|---|---|
| `source-grounded-ai-curricula-and-assessments` | `design-source-grounded-ai-curricula-and-assessments` (active) | **HIGH** — contains "curricula" and "assessments" |
| `adaptive-learning-paths` | archived change + canonical spec | **MEDIUM** — this is the *right* home for a persistent curriculum; do not invent a second curriculum capability |
| `ai-answer-assessment` | canonical spec | **MEDIUM** — "assessment" already means *free-response answer grading*. A new capability should not also be called "assessment" without disambiguation. Prefer `exam-grading` / `study-assessment`. |
| `knowledge-gap-detection` | canonical spec | **LOW** — reuse, don't rename |
| `ai-socratic-tutoring` | canonical spec | **LOW** — reuse |
| `document-qa-study-artifact-generation` | canonical spec | **LOW** — "study artifact" is the closest existing umbrella term for generated study items |

---

## 4. Other active changes that overlap

### 4.1 `complete-ai-learning-agent-integration` — **ACTIVE, 19/19 checked**

- **Why:** *"P0: the bounded learning agent exists but cannot be invoked through the production Assistant."*
- **Scope:** wire the bounded learning agent into the production Assistant with source-grounded learning proposals that remain editable and require approval before saving.
- **Overlap:** The agent is a plausible host for curriculum/exam generation ("propose artifacts without saving them"). Its **proposal → user approval** model is the correct pattern for AI-generated curricula.
- **Status note:** the change's own "Current Verified Behavior" cites baseline `615570ff` and says *"repository-wide call-site search finds only agent tests"*. **Run B must re-verify the current production wiring at `340661b`** — do not assume the 19 checked tasks reflect the live tree.
- **Recommendation:** **Reuse the agent's proposal/approval seam** rather than inventing a second one; verify wiring first.

### 4.2 `harden-ai-learning-actions-and-card-quality` — **ACTIVE, 0/18 checked**

- **Why:** brittle tool argument validation aborts the agent on natural parameter aliases; on-device models trigger unexplained safety blocks on standard medical texts; flashcard batch creation hits SQLite FK errors.
- **Overlap:** **Low direct overlap**, but it establishes the **agent tool-argument normalization** pattern that any new curriculum/exam agent tool will need. Also its safety-block degradation path is relevant to exam generation (a safety refusal must degrade, not crash).
- **Recommendation:** Coordinate; do not duplicate the normalization work.

### 4.3 `fix-issue-6-scheduling-and-learning-workflows` — **ACTIVE, 57/57 checked**

- **Why:** Issue #6 exposed inconsistent ranking mathematics and learning workflows.
- **Scope:** bounded monotone urgency policy; higher-means-more-important global priority; manual importance derived once from live rank; shared persistence/error handling across keyboard/pointer/touch; AI source identity.
- **Overlap:** **Indirect but critical.** This is the change that established the **user-priority-authority** invariants and the **AI source identity** rules. A curriculum/exam feature must respect them.
- **Recommendation:** **Do not modify scheduling.** Read this change's design for the priority-authority contract before touching anything queue-related.

### 4.4 `validate-ai-learning-cross-platform-readiness` — **ACTIVE, 11 checked / 6 unchecked**

- **Why:** native and configured-provider paths differ materially across platforms.
- **Scope:** reproducible platform evidence and explicit unsupported behaviour.
- **Overlap:** **Medium.** Any AI-heavy exam feature inherits the platform matrix obligation.
- **Recommendation:** Reuse its evidence matrix shape when specifying exam generation on mobile.

### 4.5 `complete-knowledge-relationships-and-coverage` — **ACTIVE, 16/16 checked** ✅ (the good example)

- **Why:** *"P1: prerequisite inference reaches the selection sheet, but learners cannot inspect actual library coverage or manage cross-document relationships. Existing relational infrastructure should become a usable evidence workflow **without claiming mastery**."*
- **Scope:** complete prerequisite cancellation/consent gating; deterministic evidence assessment over shared retrieval; canonical concepts + typed link lifecycle; **separate evidence completeness from historical activity and from mastery**; bounded relationship proposal adapter.
- **Non-goals (explicit):** *"No graph database, second index, automatic synonym merge, **mastery scoring** or background relationship generation."*
- **Overlap:** **Very high — and it is the closest precedent for how to build this correctly.** It is the change that produced `src/lib/ai/concepts/coverage.ts` with the *"never models what a user knows"* doctrine and the `COVERAGE_LIMITATIONS` vocabulary.
- **Recommendation:** **REUSE.** Its "coverage ≠ activity ≠ mastery" three-way separation is **the architectural template** Run B should follow when adding mastery.

### 4.6 `add-dynamic-adaptive-queue-engine` — **ACTIVE, 130 checked / 4 unchecked**

- **Scope:** the DAQE ranking engine.
- **Overlap:** **Medium** — provides `goalAlignment`, `prerequisitesMet`, `staleForPruning`, `DECISION_TIERS`, `RANKER_RUBRIC_VERSION`, and the **session-goal primitive** (`src/lib/daqe/sessionGoal.ts`).
- **Recommendation:** **REUSE the session-goal primitive** for exam/curriculum goal capture; do not build a second goal normalizer. **Do not** reuse DAQE's "rubric" — it is a *ranking* rubric version, unrelated to assessment rubrics.

### 4.7 Changes with **no** overlap (explicitly checked)

`improve-knowledge-graph-mobile-ux`, `knowledge-universe`, `knowledge-peck-startup-animation`, `upgrade-dictionary-peek-for-language-learning`, `upgrade-latex-engine-comprehensive`, `add-language-content-recommendations` (adjacent: retrieval/ranking/queue integration), `add-next-gen-srs-platform` (SRS semantics), `unified-recording-ingestion-and-learning-studio` (media).

---

## 5. Planning documents

| Document | Relevance |
|---|---|
| `openspec/planning/ai-learning-completion-audit.md` | **High.** An evidence-based audit (baseline `615570ff`) that independently confirms the mastery gap and the coverage≠mastery separation. Cites the `knowledge-gap-detection` spec as a *"broader mastery-estimation program"* that the completion program *"deliberately … does not implement"*. |
| `openspec/planning/ai-learning-completion-program.md` | **High.** The implementation program that follows the audit. |
| `openspec/planning/ai-learning-completion-traceability.md` | Medium. |
| `openspec/planning/issue-6-comprehensive-remediation-plan.md` | **High.** The master plan for Issue #6 — the very issue the user's feature request quotes. Establishes the queue/priority invariants and the 8-proposal decomposition pattern Run B should follow. |
| `openspec/planning/plethora-transformation-roadmap.md` | Medium. |
| `openspec/TRACEABILITY_MATRIX.md` | Medium. |
| `openspec/project.md` | High — project conventions. |

---

## 6. File-ownership conflicts Run B must respect

| Path | Claimed by | Risk |
|---|---|---|
| `src/stores/learningPathsStore.ts`, `src/types/learningPaths.ts` | archived `implement-plethora-ai-generated-adaptive-learning-paths` | The archived change claims them but ships nothing. A new change may own them — but must **delete or replace** the localStorage store rather than add a parallel SQLite one, or users will have two sources of truth. |
| `src/stores/knowledgeGapsStore.ts`, `src/types/knowledgeGaps.ts` | (no active owner found) | Same localStorage-shadowing risk. |
| `src/lib/ai/schemas/recallQuestion.ts` | active `design-source-grounded-ai-curricula-and-assessments` (task 1.1) | **Conflict.** If exam validation extends card validation, coordinate. |
| `src/components/review/studio/DraftCardList.tsx` | active `design-source-grounded-ai-curricula-and-assessments` (task 3.1) | Conflict if exam UI touches Studio. |
| `src/lib/ai/schemas/answerAssessment.ts` | canonical `ai-answer-assessment` | **Extend, do not fork.** |
| `src/lib/ai/tasks/definitions/*` | canonical `ai-task-architecture` | New exam tasks register here — expected, but follow the existing `reasoningFallback` pattern exactly. |
| `src/components/tabs/knowledge/*` | `knowledge-universe`, `improve-knowledge-graph-mobile-ux` | If the Study Plans UI is hosted on a knowledge tab, coordinate. |
| `src/navigation/tabDestinations.ts` | `command-palette-navigation`, `improve-settings-search` | Any new tab/destination **must** be added here and pass the drift test. |
| `src/components/settings/search/settingsSearchCatalog.ts` | `improve-settings-search` | **Hard gate** per `AGENTS.md:13-21` for any new Settings control. |
| `src-tauri/src/database/migrations.rs` | every DB-touching change | New migrations must take the **next free number** (138 is the highest observed at this commit ⇒ start at 139) and follow the additive, non-destructive convention. |

---

## 7. The stale-checkbox hazard — a repo-wide pattern, not a one-off

Three independent instances were found in this audit:

| Change | Claim | Reality |
|---|---|---|
| `archive/2026-10-15-implement-plethora-ai-generated-adaptive-learning-paths` | 12/12 tasks complete, incl. Rust module, migrations, planner, `path-generation` task, PathView DAG, queue feed | **9/12 entirely absent** |
| `archive/…` (referenced by `add-dynamic-adaptive-queue-engine`'s proposal) | *"the `recommendation-engine` change already claimed to solve this with a `relevance_weight` blend, but it was marked complete while none of its fields (`relevance_score`, `relevance_computed_at`, the blend formula) exist anywhere in `src/` or `src-tauri/src/`"* | **Corroborated by the repo itself** |
| `openspec/planning/ai-learning-completion-audit.md` | *"The archive `openspec/changes/archive/2026-10-15-add-ondevice-ai-learning-system/` marks tasks 6.2–6.7 and 8.6–8.7 complete, but the current tree does not establish those user paths."* | **Corroborated by the repo itself** |

**Directive for Run B and its implementation agent:** every task checkbox in this repo must be treated as a **claim to be verified**, not evidence. The strongest available check is a repository-wide call-site search that excludes tests, exactly as `ai-learning-completion-audit.md` describes its own method:

> *"Used repository-wide symbol/command call-site searches excluding tests to distinguish entry points from infrastructure."*

---

## 8. Recommended disposition per overlapping artifact

| Artifact | Disposition |
|---|---|
| `adaptive-learning-paths` (canonical spec) | **EXTEND.** Own the curriculum capability here. Reuse the name; extend the requirements to cover persistent, versioned, user-editable plans + exam generation + gap-driven remediation. |
| `knowledge-gap-detection` (canonical spec) | **EXTEND.** Add the mastery-estimation requirement implementation; keep the existing 6 gap kinds and the explainable/disputable requirement. |
| `ai-answer-assessment` (canonical spec) | **REUSE + EXTEND.** Keep the `AnswerAssessment` envelope; add a rubric contract and an attempt-scoped variant rather than a parallel type. |
| `ai-task-architecture` | **REUSE.** All exam AI work runs through `runTask`. |
| `ai-learning-material-generation` | **REUSE.** Mirror the task→schema→validate→preview→accept pipeline for exam questions. |
| `ai-knowledge-relationships` / `complete-knowledge-relationships-and-coverage` | **REUSE.** The coverage runner and concept graph are curriculum inputs. |
| `ai-active-recall` | **REUSE.** The fingerprint-dedup + recall-history pattern for exam question banks. |
| `ai-socratic-tutoring` | **REUSE** as the remediation surface. |
| `knowledge-graph` | **REUSE.** Concepts + provenance-carrying edges. |
| `design-source-grounded-ai-curricula-and-assessments` | **AVOID** (do not extend, do not rename in Run A). If its validators land, **depend on them**; if not, implement exam validators independently. Use a **distinct** capability name for curricula/exams to avoid the collision. |
| `complete-ai-learning-agent-integration` | **REUSE** its proposal/approval seam (after verifying current wiring). |
| `add-dynamic-adaptive-queue-engine` | **REUSE** the session-goal primitive; do not touch ranking. |
| `fix-issue-6-scheduling-and-learning-workflows` | **DO NOT MODIFY.** Read for the priority-authority contract. |
| `validate-ai-learning-cross-platform-readiness` | **COORDINATE.** Reuse its evidence-matrix shape. |
| `harden-ai-learning-actions-and-card-quality` | **COORDINATE.** Reuse its argument-normalization approach. |
