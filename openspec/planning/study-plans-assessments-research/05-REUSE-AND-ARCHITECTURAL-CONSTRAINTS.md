# Reuse Map & Architectural Constraints

**Plethora commit:** `340661b2c5a42bf0c2a8fb7d5a5d384f3ef04481`
**Scope:** what Run B may reuse as-is, what it must adapt, what it must not touch, and the constraints any design must honour. **This document deliberately does not choose the final architecture.**

---

## 1. Subsystems that MUST be reused (not reimplemented)

### 1.1 The AI task layer — `src/lib/ai/tasks/`

**Why it must be reused:** `openspec/specs/ai-task-architecture` is a canonical spec with 7 requirements, all implemented. Bypassing it would forfeit provider resolution, capability gating, token budgeting, fail-closed validation, the repair retry, cancellation, coalescing, containment, and diagnostics — all in one place.

| Element | Location | Contract |
|---|---|---|
| Task definition | `src/lib/ai/tasks/types.ts:90-143` | `AITaskDefinition<I,O>` — prompt in the task, never in a component |
| Run options | `types.ts:45-88` | `signal`, `onChunk`, `onRetry`, `targetId`, `kind`, `provider`, `resolvedProvider`, `maxOutputTokens`, `requestPolicy`, `timeoutMs`, `streaming`, `retrieval`, `observation` |
| Validation outcomes | `types.ts:146-154` | `text \| native-structured \| strict-json \| truncated-json-salvaged \| truncated-json \| empty-response \| repaired \| invalid-structured-output` |
| Result envelope | `types.ts:158-172` | `providerId`, `providerKind`, `requestedModelClass`, `servedModelClass`, `fallbackPath`, `validationOutcome`, `baseModelName`, `usage` |
| Routing | `src/lib/ai/tasks/router.ts:45+` | `resolveTaskRoute` — `fast`/`full`/`reasoning` + `reasoningFallback` |
| Execution | `src/lib/ai/tasks/runTask.ts` (665 lines) | cancellation, coalescing, repair retry, diagnostics |
| Registry | `src/lib/ai/tasks/registry.ts` | `registerTasks(...)` |
| Containment | `src/lib/ai/tasks/containment.ts` | `UNTRUSTED_CONTAINMENT_CLAUSE`, `wrapUntrustedBlock(name, content)` |

**Hard rules for new exam/curriculum tasks:**
1. `systemInstruction` **must** start with `UNTRUSTED_CONTAINMENT_CLAUSE` (all untrusted content in the user turn inside `wrapUntrustedBlock`).
2. `outputKind: "structured"` + a `schema` + a **fail-closed** `validate`.
3. Register via `registerTasks(...)`.
4. If the task is a reasoning-class task, **declare a `reasoningFallback` twin** (`assess-answer`/`assess-answer-full` and `tutor-turn`/`tutor-turn-full` are the two precedents).
5. Cap `maxOutputTokens` and set `timeoutMs` deliberately (mobile reality: `learnThisTask` was raised 20 s → 60 s after device testing).

### 1.2 Source grounding & retrieval — `src-tauri/src/ai_learning/` + `src/api/ai-learning.ts`

- `retrieveFromLibrary(query, k)` — semantic + **lexical fallback** + prefilter.
- `getAIIndexStatus()` → `IndexCompleteness`.
- `ChunkLocation` — the finest-grained citation anchor.
- The `ai-semantic-index` spec requires the index be a **rebuildable cache** — do not treat it as durable truth.

### 1.3 Evidence coverage — `src/lib/ai/concepts/coverage.ts`

**The most important existing asset for this feature.** Must be reused verbatim as the *content* half of any coverage report:

- `EvidenceCoverage = "unknown" | "not-covered" | "partial" | "supported"`
- `CoverageActivity = "none" | "encountered" | "studied" | "reviewed"`
- `CoverageLocator` (4 kinds: chunk / extract / card / annotation)
- `CoverageEvidenceRef` (with `sourceRevision`, `strength`, resolved `text`)
- `COVERAGE_LIMITATIONS` (16 content-free keys) — **the vocabulary for honest degraded states**
- `conceptPhrasePattern`, `hasConceptMention`, `countConceptMentions`, `hasDefinitionHeading`, `computeEvidenceCoverage`, `computeActivity`

**Non-negotiable doctrine (from the module header, lines 6-11):**
> *"It never models what a user knows, never reads a mastery score, and never lets model rationale or vector similarity raise an evidence level."*
> *"historical activity is orthogonal and cannot change evidence level."*

And from `complete-knowledge-relationships-and-coverage/tasks.md` task 1.2:
> *"Done when model rationale/similarity alone cannot change evidence level or assert mastery."*

**⇒ Mastery estimation MUST live in a separate module and MUST NOT be wired into `coverage.ts`.**

### 1.4 The concept graph — `concept_links.rs` + `concepts`/`concept_links` tables

Reuse for:
- canonical concept identity (`concepts.normalized_name UNIQUE`),
- typed relationships (`prerequisite-of`, `contradicts`, `definition-of`, `example-of`, `supports`, `extends`, `same-as`, `analogous-to`, `application-of`, `related-to`),
- **provenance-carrying edges** (`provenance_json`),
- the **propose → accept/dismiss** lifecycle (a precedent for AI-proposes-user-disposes),
- `proposal_fingerprint` (a **dedupe key for AI proposals** — reusable for duplicate exam questions),
- `is_dismissed` (user suppression that must survive restarts).

### 1.5 The answer-assessment contract — `src/lib/ai/schemas/answerAssessment.ts`

Reuse the **envelope**; do not fork a parallel grading type:
```
{ classification: correct|partial|incorrect|misconception, score, completeness,
  missingConcepts[], misconception?, feedback, suggestedCorrection?, confidence }
```
Validation invariants to preserve: numeric 0-1 clamping; `missingConcepts` defaults to `[]`; **`misconception` required when `classification === "misconception"`**.

### 1.6 The flashcard generation pipeline — `learnThisTask` → `learnThisValidation` → preview → accept

Reuse the **pipeline shape** for exam questions:
`task → schema → per-candidate validation → flagged preview → explicit accept → persist`.

Specifically reusable:
- `checkCandidateGrounding(candidate, sourcePassage)` → `{grounded, groundingScore, issues[]}` — verbatim cloze + answer grounding.
- `dedupeCandidates` / `candidateSignature` — self-dedup, flagged not dropped.
- `DUPLICATE_SIMILARITY_THRESHOLD = 0.85` — mirrors the Rust-side refusal.
- `checkSemanticDuplicateCandidates` — existing-library semantic duplicate detection.
- `normalizeCardType` — off-enum spelling healing.
- The **flagged-not-dropped** candidate model — a flagged candidate is fixable by the user editing it.

### 1.7 The question-fingerprint dedup pattern — `recall_prompt_history`

Table (`migrations.rs:2803-2815`): `id, document_id, chunk_ids, fingerprint, question, asked_at, outcome`.
Spec `ai-active-recall` req. *"Question deduplication by fingerprint"*: *"normalized question text plus concept keys … effectively identical questions SHALL NOT be re-asked within the deduplication window."*
Command module: `src-tauri/src/commands/recall_history.rs`.

**Reuse for exam question banks** (prevent the same question appearing twice in one exam and across attempts).

### 1.8 The tutor — `src/lib/ai/tutor/` + `TutorSheet.tsx`

Reuse as the remediation surface. Grounding already comes from `retrieveFromLibrary(topic, k≈3)` with drift-triggered refresh (≤2/session).

### 1.9 The session-goal primitive — `src/lib/daqe/sessionGoal.ts`

`normalizeSessionGoal` / `validateSessionGoal` / `MAX_SESSION_GOAL_LENGTH = 200` / `MAX_RECENT_GOALS = 5`.
**Do not write a second goal normalizer.** The *"refusal rather than truncation"* doctrine applies to study goals too.

### 1.10 The card source envelope — `src/types/cardSourceReference.ts`

`CardSourceReference` (version 1) + `ExactSearchHitLocation` + `parseCardSourceReference` (fail-closed to `null`).
**Constraints:** single document; mutually exclusive with the extract-anchor path; excerpt ≤ 300 chars; has a `fingerprint` for staleness detection.

### 1.11 The DAQE decision envelope — `src/lib/ai/schemas/daqeDecision.ts`

`DaqeDecision { goalAlignment, atomicExtractability, tier, prerequisitesMet, staleForPruning, reason }` + `DECISION_TIERS` + `TIER_COMPLEPURITY`.
Reusable for **blueprint-level planning signals** (e.g. "is this material worth including", "is the tier appropriate for the target").

---

## 2. API boundaries Run B must respect

### 2.1 The Tauri command boundary

| Rule | Detail |
|---|---|
| **Command location** | `src-tauri/src/commands/<feature>.rs`, `#[tauri::command] pub async fn …` |
| **Registration** | `src-tauri/src/lib.rs` (the concept commands are registered at `:1885` per the coverage change's proposal) |
| **TS wrapper** | `src/api/<feature>.ts` exporting typed wrappers, importing `invokeCommand` from `../lib/tauri` (see `src/api/answer-assessment.ts`) |
| **Shape** | Wrapper exports a typed *record* interface (camelCase fields) mirroring the Rust row |
| **Error handling** | Frontend wrappers are fire-and-forget-tolerant where the spec says "no errors surfaced" (see `recordCardAssessment`) |
| **Repositories** | `src-tauri/src/database/repository.rs` (central), `item_stats_repository.rs`, `concept_repository.rs` |

### 2.2 The persistence boundary

- **Rust owns SQLite.** The frontend must not open the DB.
- **Migrations** live in `src-tauri/src/database/migrations.rs` (numbered string keys; **highest observed 138** ⇒ next free ≈ **139**). A legacy `.sql` file layout also exists in `src-tauri/migrations/` — **prefer the inline registry** (that is where the recent, live migrations are).
- **Migration convention:** additive, non-destructive, idempotent; a matching test in the file's `#[cfg(test)]` module (see `migrations.rs:5946` for the `source_reference` migration test).
- **Version guards:** `ChatRecord.version` and `CURRENT_GRAPH_FORMAT_VERSION` show the house pattern — *"a record stamped NEWER than this build is REFUSED on read."*

### 2.3 The AI↔domain boundary

- A **task** may only **propose**; a **command** persists.
- The `concept_links` lifecycle is the reference: `propose_concept_link` → `save_concept_link_suggestions` → `accept_concept_link` / `dismiss_concept_link`.
- The learning agent has the same shape: `src/lib/ai/agent/tools/proposals.ts` + `src/components/assistant/LearningAgentProposals.tsx` — **propose, never auto-save**.
- Spec: `ai-learning-agent` req. *"Writes require user approval"*; `ai-learning-material-generation` req. *"No silent mass creation."*

### 2.4 The frontend-state boundary

- **Zustand** for client state; **localStorage** via `persist` only for trivial, non-authoritative state.
- The debug registry `window.plethora.stores` (`src/main.tsx:346-366`) must **not** be mistaken for a consumer.
- **`src/navigation/tabDestinations.ts`** is the SSOT for navigation. A new tab/destination requires: a `NavigationDestination` entry + `TabType` + i18n label keys, and must pass `src/navigation/__tests__/tabDestinations.test.ts`.

### 2.5 The Settings-search boundary (hard gate)

Per `AGENTS.md:13-21` and `docs/settings-search.md`, any new user-configurable Settings control or meaningful group requires:
1. A **stable search target id** via `SettingsRow searchId=`, `SettingsSection searchId=`, `<SettingsSearchTarget id=>`, or `useSettingsSearchTarget(id)`; plus a `revealTargetId` for collapsed content.
2. A **catalog entry** in `src/components/settings/search/settingsSearchCatalog.ts` (id, targetId, labelKey, descriptionKey, aliases, availability).
3. A **coverage row** in `settingsSearchCoverage.ts` (`section`, `sources`, `catalogPrefixes`, `exclusions`).
4. **Tests** alongside the change.

The reveal callback may open UI but must not persist a setting, select a provider, submit a form, start a download, record audio, or run a destructive action.

---

## 3. Persistence conventions

| Convention | Evidence |
|---|---|
| SQLite via sqlx; tables created in numbered migrations | `migrations.rs` |
| **Additive migrations only** — never rewrite an existing table destructively | the `source_reference` migration pattern (4035-4037) |
| Migration tests live inline in `#[cfg(test)]` | `migrations.rs:5946` |
| Stable string ids (`TEXT PRIMARY KEY`) | `concepts`, `concept_links`, `learning_items`, `answer_assessments` |
| Timestamps: `TEXT NOT NULL DEFAULT (datetime('now'))` | same |
| Booleans as `INTEGER NOT NULL DEFAULT 0` | `concept_links.is_dismissed`, `learning_items.is_suspended` |
| JSON-in-TEXT for structured payloads | `concept_links.provenance_json`, `learning_items.tags` |
| Indexes on every FK-ish column and every filter column | `idx_concept_links_source/target/fingerprint`, `idx_answer_assessments_item` |
| **Foreign keys with explicit `ON DELETE` behaviour** | `learning_items`: `ON DELETE CASCADE` to `extracts`/`documents` |
| **Fingerprint columns for AI-proposal dedupe** | `concept_links.proposal_fingerprint`, `recall_prompt_history.fingerprint` |
| Version stamps for read-modify-write records | `ChatRecord.version` |

**⚠ Deletion semantics are a design decision Run B must make explicitly.** `learning_items` cascades on document/extract deletion. Exam questions citing documents should probably **orphan-mark** (like `knowledge-graph`'s edge rule: *"Source deletion SHALL orphan-mark affected edges (preserving audit) rather than silently dropping them"*) rather than cascade — an exam history should not vanish when a source document is deleted.

---

## 4. Privacy constraints

| Constraint | Enforcement point |
|---|---|
| Untrusted content is **data**, never instructions | `UNTRUSTED_CONTAINMENT_CLAUSE` + `wrapUntrustedBlock`; `assess-answer`'s explicit adversarial-answer clause |
| **Remote work requires consent** | `LlmRequestPolicy` frozen before source preparation, **re-checked on both attempts** (`types.ts:80-81`) |
| Consent denial is a **first-class degraded state**, not an error | `COVERAGE_LIMITATIONS.remoteDenied`, `.remoteEmbeddingConsent`; `CoverageAnalysisResult.blocked` |
| Feature-level capability flags | `src/lib/ai/features/activation.ts` + `settingsStore.ts` (11 default-true learning flags) |
| **Provider kind ≠ locality** | `AIProviderKind = "ondevice" \| "cloud" \| "local-model"` — `local-model` is a *user-configured* endpoint and must be treated by **endpoint**, not by kind string |
| Index is a rebuildable cache, not durable truth | `ai-semantic-index` req. *"Index data is rebuildable cache"* |
| AI-exclusion flags must be honoured | `knowledge-gap-detection`, `adaptive-learning-paths` |

**Run B must state, per exam-generation call, exactly which excerpts leave the device** and under which provider.

---

## 5. Source identity & durability

| Rule | Evidence |
|---|---|
| Document ids are stable `TEXT PRIMARY KEY`s | `documents`, `extracts` |
| Concept identity is canonicalized (`normalized_name UNIQUE`) and **server-assigned** | `concepts` table |
| Locators are a **discriminated union**, not free text | `ExactSearchHitLocation` |
| Evidence carries a **`sourceRevision`** token | `CoverageEvidenceRef.sourceRevision` |
| Stale / removed sources are **named limitations**, not silent failures | `staleSource`, `removedSource`, `unresolvedHit` |
| Deletion **orphan-marks** rather than dropping | `knowledge-graph` spec |
| Provenance parse **fails closed to `null`** | `parseCardSourceReference` |
| Cloze answers must appear **verbatim** in the source | `checkCandidateGrounding` |

**⇒ Anchors are durable across restarts (they are rows, not memory) and invalidatable by revision (the `sourceRevision` / `fingerprint` fields).** A curriculum node or exam question citing a document must carry the same revision-awareness.

---

## 6. Provider routing constraints

- Model class per task (`fast` / `full` / `reasoning`); `reasoningFallback` prevents a hard failure on non-reasoning devices.
- `options.kind` pins the provider kind when the caller already resolved availability (`types.ts:69-75`).
- `resolvedProvider` is *"frozen during source preparation"* (`types.ts:76-77`) — the provider cannot change mid-run.
- `AITaskRunOptions.maxOutputTokens` and `timeoutMs` can override per call.
- **Do not infer locality from `providerKind`.** The `local-model` kind exists precisely because a user-configured endpoint is *not* the built-in on-device model. Endpoint-aware privacy behaviour must be specified per provider.
- Mobile: `learnThisTask` needed 60 s (not 20 s) on Nano. **Any exam-generation task must be budgeted for the slowest advertised device, or must generate incrementally.**

---

## 7. FSRS isolation constraints — **the invariant that must not be broken**

**Verified statement** (`src/components/review/answerAssessmentIntegration.ts:5-12`):
> *"Scheduler authority is preserved BY CONSTRUCTION:
>  - `computeSuggestedRating` only derives an advisory highlight; nothing ever submits it;
>  - `recordCardAssessment` is a SEPARATE `record_answer_assessment` invoke fired after grading — it receives no scheduling inputs and touches no scheduling table. The `submitReview` call sequence is identical with or without an assessment present."*

**Binding rules for an exam system:**

1. **Exam questions must NOT be `learning_items`.** `learning_items` rows carry `interval`, `ease_factor`, `due_date`, `state`, `review_count`, `lapses`, `last_review_date` and are the FSRS unit. Store exam questions in **separate tables**.
2. **Grading must never write scheduling columns.** Use a separate `record_*` command, fired **after** the learner's response is committed.
3. **AI classification is advisory.** `computeSuggestedRating` may highlight a button; it must never submit one.
4. **The user's own rating remains the FSRS input.** An exam result is *evidence*, not a rating.
5. **Never alter the `submitReview` call sequence** based on the presence of an assessment.
6. **Queue integration is additive and default-off.** (`adaptive-learning-paths` spec: *"as an additive source (default off), without altering scheduling algorithms or non-path behavior"*.)
7. **User priority is manual and authoritative** — derived once from live rank, shared across keyboard/pointer/touch (`fix-issue-6-scheduling-and-learning-workflows`).
8. **Deletion semantics differ.** `learning_items` cascades on document/extract deletion; exam artifacts should not.

---

## 8. Testing conventions

| Rule | Detail |
|---|---|
| Runner | **Vitest** (`vitest.config.ts`), `environment: "jsdom"`, `setupFiles: "./src/test/setup.ts"`, `globals: true`, `css: true` |
| Include | `src/**/*.{test,spec}.{js,jsx,ts,tsx}` |
| Exclude | `src-tauri/`, `dist/`, `src/**/*.bench.ts(x)` |
| Coverage | v8 provider |
| Rust tests | inline `#[cfg(test)]` modules + `src-tauri/src/**/test_support.rs` fixtures |
| E2E | Playwright (`playwright.config.ts`); `src/e2e/` |
| **Performance gate** | `npm run bench:check` — runs every `src/**/*.bench.ts` via `vitest bench`, compares against `scripts/perf-baselines.json` (exit 1 on regression), then the bundle budget check. A plain `npm run bench` only measures (exit 0, writes `.bench/results.json`). |
| **Bench rules** | Use `seededRandom(seed)` from `src/test/bench-support.ts`; never `Math.random()`; never clock-sized inputs; no network/fs/Tauri runtime; consume the result into a module-level `sink`; bench bodies return `void` |
| **Perf change protocol** | An intentional performance change MUST update `scripts/perf-baselines.json` in the same PR, with the reason in the PR description |
| Script tests | `npm run test:scripts` (`node --test` on `scripts/__tests__/*.test.ts`) |
| CI gate | **GitHub Actions is not used as a gate** (per `AGENTS.md`) |

**⇒ Every new exam/curriculum module needs unit tests; anything touching the queue or scheduler needs the existing queue tests/benches to remain valid.**

---

## 9. Cross-platform considerations

| Consideration | Evidence |
|---|---|
| **Capability gating everywhere** | `PlatformCapabilityId` on navigation destinations; `OnDeviceRequirement` on tasks; `CapabilityId::*` in entitlements (`src-tauri/src/entitlements/snapshot.rs`) |
| **An entitlement capability already exists for this feature area** | `CapabilityId::AdaptiveLearningPaths => "adaptive_learning_paths"` (`snapshot.rs:57`) — Run B must decide reuse vs. a new id |
| Native embedder install | `src-tauri/src/lib.rs:1454` (Android), `:1484` (iOS) |
| Platform directories | `src/lib/ai/android/`, `src/lib/ai/apple/`, `src/lib/ai/windows/`, `src/lib/ai/foundryLocal/`, `src-tauri/src/mobile/` |
| **Mobile generation cost is real** | `learnThisTask.ts` timeout 20 s → **60 s** after device testing |
| Platform evidence discipline | `validate-ai-learning-cross-platform-readiness` (11/17) — *"no complete AI-learning platform evidence matrix was found… This audit executed no physical-device inference."* |
| Mobile lifecycle | `mobile-lifecycle-webview-reliability`, `harden-ios-feature-availability-and-mobile-product-scope` |
| E-ink / low-end rendering | `eink-display-mode`; the archived learning-paths change claimed *"PathView DAG (e-ink safe)"* |

**⇒ An exam generator must have a bounded, incremental, mobile-viable path. The minimum viable ordering (cloze → MCQ → multi-select → short answer → essay) also happens to be the right mobile ordering, because deterministic items need no model call at grading time.**

---

## 10. Relevant technical risks (constraints, not solutions)

| # | Risk | Evidence | Constraint on the design |
|---|---|---|---|
| R1 | **AI-generated correct answers drift** | LearnHarness's own principle: *"never revise the commitment after seeing his words"* (`question-core.ts:310-314`) | The answer key must be **mechanically immutable** once the question is published — a stored row the grader cannot rewrite, not prompt doctrine. |
| R2 | **Ungradable questions reach the learner** | LearnHarness's invariant *"schema-valid ⇔ gradeable"* (`question-core.ts:74-79`) | Validate gradeability **at generation time** using the *same* rules the grader uses. |
| R3 | **Generated citations are untrustworthy** | `complete-knowledge-relationships-and-coverage` task 1.2: *"model rationale/similarity alone cannot change evidence level"* | Every citation must be **resolved against the live source** before display (the coverage runner already does this: `runCoverageAnalysis` *"hydrates every retrieval hit against the real source record"*). |
| R4 | **Coverage is mistaken for mastery** | `coverage.ts` header; the coverage change's explicit non-goal | Mastery and coverage must be **separate modules and separate UI language**. |
| R5 | **The learning agent's production wiring may be incomplete** | `complete-ai-learning-agent-integration` claims 19/19 but cites baseline `615570ff`; prior audit: *"Only tests call the loop"* | **Re-verify at implementation time.** Do not depend on agent wiring that may not exist. |
| R6 | **Stale task checkboxes** | 3 independent instances (§3 of `03-...md`) | Every dependency must be **verified by call-site search**, not by checkbox. |
| R7 | **Name collision on `source-grounded-ai-curricula-and-assessments`** | `design-source-grounded-ai-curricula-and-assessments` (active, 0/9) | Use a **distinct** capability name for curricula/exams; do not modify the active change. |
| R8 | **Two stores for the same entity** | `learningPathsStore` + `knowledgeGapsStore` are localStorage orphans | A SQLite-backed implementation must **replace** them, not coexist. |
| R9 | **LocalStorage data is unsynced and unbacked-up** | `zustand/middleware` persist | Any authoritative learning artifact goes to SQLite. |
| R10 | **No background-job infrastructure** | No job table; only DAQE idle-gating | Long generations must be inline+timeout, or Run B must build a job system. |
| R11 | **No resumable work** | Nothing persists in-flight generation | If generation must survive restart, a persisted job/attempt model is required. |
| R12 | **Model-authored identities are unstable** | LearnHarness `PlanNode.id` is a model-copied slug | Use **server-assigned ids**; constrain the model to **opaque handles** (the `relationshipTask.ts` `MAX_RELATIONSHIP_HANDLES` pattern). |
| R13 | **Prompt injection through source material and learner answers** | `assessmentTask.ts:54`; `ai-task-architecture` containment requirement | Wrap everything untrusted; treat the learner's answer as adversarial data. |
| R14 | **Contradictions have no representation** | LearnHarness's graph has no conflict model | Plethora's `concept_links` has `contradicts` as a relation type — the closest existing hook. Decide how a contradiction surfaces in a curriculum. |
| R15 | **Migration numbering collisions** | Highest observed 138; many active changes touch `migrations.rs` | Take the next free number at implementation time; **re-derive**, do not assume 139. |
| R16 | **The settings-search gate is easy to miss** | `AGENTS.md` + `docs/settings-search.md` | Any new Settings control needs a target id, a catalog entry, a coverage row, and tests. |
| R17 | **Command-palette drift** | `src/navigation/tabDestinations.ts` drift test | A new destination must be registered in the SSOT. |
| R18 | **Mobile generation cost** | `learnThisTask` timeout doubled | Bound item counts and generation time; prefer incremental generation. |

---

## 11. What must remain UNCHANGED

These are **not** Run B's to modify:

| Must not change | Why |
|---|---|
| **Existing document data** and its lifecycle | User data; the `knowledge-graph` orphan-mark rule already governs it |
| **Flashcard identity** (`learning_items.id`) | Referenced by reviews, answers, stats, sync, deck export, Anki export |
| **FSRS scheduling semantics** (`interval`, `ease_factor`, `due_date`, `state`, `lapses`) | The scheduler's contract with the user; FSRS-7 migration (`src-tauri/src/migrations/fsrs7_migration.rs`) |
| **User priority / manual importance** | Explicitly user-owned (`fix-issue-6-scheduling-and-learning-workflows`); DAQE ranking must not override it |
| **`submitReview`'s call sequence** | The scheduler-authority invariant |
| **AI provider privacy** (`LlmRequestPolicy`, containment clause, feature flags) | The privacy contract |
| **The `AnswerAssessment` envelope** | Canonical contract; extend, don't fork |
| **`coverage.ts`'s ruleset** | Versioned (`COVERAGE_POLICY_VERSION = "coverage-v1"`); changing it silently would invalidate coverage claims |
| **The `concept_links` lifecycle** | Another change owns it (`complete-knowledge-relationships-and-coverage`) |
| **Unrelated learning workflows** (review, reader recall, audio learning, language learning, NotebookLM) | Out of scope; must not regress |
| **`design-source-grounded-ai-curricula-and-assessments`** (active) | Do not rename or modify |
| **Migration numbering discipline** | Do not reuse or renumber existing migrations |

---

## 12. Reuse summary table

| Need | Reuse | Effort |
|---|---|---|
| Run AI generation | `runTask` + task registry + `reasoningFallback` | Low |
| Ground content in the user's library | `retrieveFromLibrary` + `ChunkLocation` | Low |
| Know whether the library *covers* a concept | `src/lib/ai/concepts/coverage.ts` | **Zero** (already built) |
| Resolve a concept's canonical identity | `concepts` + `normalize_concept_name` + `find_concepts_by_names` | Low |
| Propose prerequisites | `prerequisiteTask` + `prerequisite-of` links | Low |
| Detect ungraded/duplicate candidates | `checkCandidateGrounding` + `dedupeCandidates` | Low |
| Grade a free-response answer | `assess-answer` + `AnswerAssessment` | Low |
| Deterministic MCQ/multi-select/cloze grading | **New** — but LearnHarness's `isCorrect`/`resolveCorrect` are ~30 lines of reference | Low |
| Detect near-duplicate questions | `recall_prompt_history` fingerprint pattern | Low |
| Tutor the learner afterwards | `TutorSession` + `TutorSheet` | Low |
| Suggest flashcards | `learnThis` pipeline + `acceptLearnThis` | Low |
| Capture a study goal | `src/lib/daqe/sessionGoal.ts` | Low |
| Persist anything durable | SQLite + numbered migration | Medium |
| Track user edits / versions | **New** | Medium |
| Store an exam + attempts | **New** | Medium |
| Define and apply rubrics | **New** | **High** |
| Estimate mastery with uncertainty | **New** | **High** |
| Detect knowledge gaps | **New** (types exist) | **High** |
| Resume interrupted work | **New** | Medium |
