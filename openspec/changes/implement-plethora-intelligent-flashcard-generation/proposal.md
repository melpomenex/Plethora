# Change: Implement Plethora Intelligent Flashcard Generation

> Wave 2 — Intelligence (after 7; parallel with 8/9). Capability: `enhanced_card_generation` for Plethora-hosted generation; the existing BYO/on-device studio flows stay ungated. **This change owns the card-generation quality pipeline** (duplicate detection, quality heuristics, preference learning).

## Why

High-quality automated flashcards from selections, highlights, documents, concepts, lessons, detected gaps, and images/figures — in multiple forms (Q/A, cloze, image occlusion, conceptual, application, compare/contrast, worked-example follow-ups) — with source provenance, duplicate suppression, and preview/edit/accept UX. Anti-goal: card spam.

## What exists today (a lot — this is an upgrade, not a build)
- **Flashcard Studio**: `FlashcardStudioModal.tsx` (5.2k lines) — DraftCard types (qa/cloze/multiple-choice/image-occlusion), chat-based generation against any provider (incl. `__notebooklm__`, `__ondevice__` sentinels), QUICK_TEMPLATES, localStorage history, cost estimates; studio sub-components (`review/studio/`); occlusion composer (`components/occlusion/` with AI assist tasks).
- **Knowledge-formulation engine**: `knowledgeFormulation.ts` (Wozniak's 20 rules) already feeds prompts.
- **Card validators**: `cardValidator.ts`, `parseGenerated.ts`; tasks `studio-review-hint`/`studio-explain-card`; image tasks `image-cards`, `image-occlusions`; occlusion label/region tasks.
- **Provenance**: `ai_provenance` recording wired from acceptance flows.
- **Duplicate signals**: `extracts.source_hash` dedup; FTS5 `extract_search`; `queue_item_embeddings`; but **no card-level duplicate detection**.
- **Preference input**: no learning loop over accept/reject history.
- Generation from lessons/gaps/paths: 12 routes here via proposal flow.

## What Changes

### 1. Generation quality pipeline (`src/lib/ai/cards/`)
- **Multi-form generator tasks** (structured outputs): extend the studio task set with form-aware outputs — `qa`, `cloze`, `conceptual` (why/how), `application` (scenario), `compare-contrast`, `worked-example-followup`, `image-occlusion` (existing). Each result carries: form, difficulty estimate, target concept(s), source quote (must validate against the source text — string/anchor check), and knowledge-formulation rule references (minimum information principle applied).
- **Card-quality heuristics** (deterministic pre-filters, extend `cardValidator`): answer-in-question leakage, overly broad/narrow scopes, yes/no trivia, ambiguity checks, cloze-key salience, length budgets per form; heuristics score and annotate (not silently drop).
- **Duplicate detection**: new `card_similarity` stage — embedding similarity against existing cards in the same deck/collection (reusing the semantic index vectors; cards optionally indexed per 7's `source_kind` decision) + lexical near-dup (normalized token Jaccard) + `source_hash`-anchored identity. Duplicates block acceptance with a side-by-side comparison (keep both/merge/skip).
- **Preference learning**: accept/reject/edit-distance signals per user (bounded local store) adjust generator prompt parameters (preferred forms, length, difficulty) — local only, transparent ("your preferences" view + reset).

### 2. Sources of generation
- Selection/highlight (existing), whole document/chapter (batch with per-section candidate selection driven by `passage_scores` extract-worthiness), concept (graph node → cards across sources), lesson weaknesses (12), gaps (10 "make cards"), figures/images (existing occlusion flow upgraded), path nodes (11).
- Batch generation always lands in the **pending queue** (`pendingFlashcardsStore` evolution: bulk preview with per-card accept/reject/edit, kebab actions, and a session summary (proposed/kept/merged/duplicates blocked).

### 3. Provenance & lifecycle
- Every accepted card records `ai_provenance` (task, model, source citation) + a stable `source_ref` (document/locator/extract/concept) enabling later audits (14's lifecycle analysis) and re-anchoring when sources change.
- Card counts and studio usage respect the task engine's token budgeting; hosted tier below.

### 4. Hosted tier (`enhanced_card_generation`)
- Plethora-hosted premium models for generation (better decomposition, figure understanding) via jobs (batch document → candidate cards, quota cards/month); content excerpts + images leave the device when used (disclosed); exclusion flags honored; BYO/Nano routes remain fully free.

## Impact

### Affected Specs
- `intelligent-card-generation` — New (multi-form outputs, heuristics, duplicate blocking, preference learning, provenance, hosted tier).

### Affected Code Areas
- `src/lib/ai/cards/` (new pipeline), `flashcardStudioAI.ts`, `cardValidator.ts` extensions, `FlashcardStudioModal` + `pendingFlashcardsStore` bulk-preview evolution, task definitions (additive), optional card indexing hook (7), i18n.

### Non-goals
- No auto-adding cards without acceptance (invariant), no lifecycle optimization (14), no deck management changes, no social sharing.

## Dependencies

### Hard dependencies
- 7 (similarity vectors + citations for duplicate detection and provenance). Soft: 9 (concept sources), 10/11/12 (entry points via their action contracts), 2 (hosted gate).

### May run concurrently
- 8, 9, 12, 14, 15 — this change owns `lib/ai/cards/` and studio quality internals exclusively.

### Must not start yet
- 14 (consumes provenance + review history this change guarantees).

## Shared interfaces
- `generateCards(request) → CardProposal[]` API (used by studio, lessons, gaps, paths, concept nodes); `CardProposal` schema (form, fields, quality annotations, duplicate info, source_ref); duplicate-check command (`cards_check_duplicates`); preference-store API.

## Ownership boundaries
- **May modify**: card generation/validation pipeline, studio modal internals, pending-cards store.
- **Must treat as external**: retrieval internals (7), deck/scheduling internals (read-only), provenance repository APIs (additive writes).

## Collision risks
- `FlashcardStudioModal.tsx` (large file; this change owns it in this wave — 14/15 must not touch it); task-definition registry (append-only); `pendingFlashcardsStore` (owned here).

## Integration contract
- Entry consumers (10/11/12) call `generateCards` with context and render their own accept surfaces or open the studio; accepted cards carry `source_ref` + provenance guaranteed by this change.

## Testing & acceptance

### Tests
- Form generators: golden fixtures per form incl. failure modes (leakage, ambiguity) caught by heuristics; source-quote validation rejects fabricated quotes.
- Duplicate detection: seeded deck + near-dup/new/dup candidates → correct blocks; merge flow; similarity threshold calibration fixtures.
- Preference learning: parameter drift bounded; reset works; no cross-user leakage (single-user store).
- Bulk preview: large batches paginate; accept/reject/edit reflected per card; summary counts accurate.
- Provenance: every accepted card has source_ref + provenance row (test-enforced invariant).
- Quotas: hosted-tier card counting; BYO unaffected; exclusion flags honored by cloud route.

### Acceptance criteria
- Generating from a chapter yields a reviewable, deduplicated, form-varied candidate set with quality annotations and source links; acceptance always explicit; preferences visibly adjust suggestions; local-only mode fully functional.

### Must remain unchanged
- Manual card creation flows; existing studio chat behaviors; review scheduling; existing benches (studio isn't benched; keep it that way or add baselines if hot paths measured).

## Open questions
1. Card-indexing default (7's open question 3) — this proposal defaults cards to indexed-for-dedup-only, not RAG-searchable.
2. Batch size ceilings per source (default 30 candidates/chapter, configurable).
3. Whether preference learning ever syncs (default: device-local, never synced).
