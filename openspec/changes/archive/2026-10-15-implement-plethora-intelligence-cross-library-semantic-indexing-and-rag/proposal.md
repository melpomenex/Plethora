# Change: Implement Plethora Intelligence — Cross-Library Semantic Indexing and RAG

> Wave 2 — Intelligence Core (foundation of the intelligence wave). Capability: `library_intelligence`. Local indexing/retrieval works for everyone (extending existing systems); Plethora-hosted embedding/compute requires the capability grant. Hard-depends on rebrand + proposal 2 (entitlement gating); otherwise builds on **existing local subsystems**.

## Why

The flagship Pro question set — *"What have I read about working memory?"*, *"Where does Kahneman disagree with Gigerenzer?"*, *"What have I previously read that relates to this paragraph?"*, *"Summarize my understanding of virtual memory from my own materials"* — requires whole-library semantic retrieval with **first-class citations** that jump back into the exact document location. This is the substrate for proposals 8 (connections), 9 (graph), 10 (gaps), 11 (paths), 12 (tutoring).

## What exists today (substantial — this change extends, not rebuilds)
- **On-device semantic memory system** (`add-ondevice-ai-learning-system`, migration 085): `src-tauri/src/ai_learning/` — heading-aware chunker, embedding backends (`OnDevice` EmbeddingGemma-300M via the android-genai plugin, `Ollama`, cloud providers, mock), tokio indexer with per-document state machine (`ai_index_state`: queued/indexing/indexed/error), content-hash diffing, battery gate for bulk, pause/resume/cancel/reset, cascade deletes; commands `ai_learning_*`; retrieval = FTS5 bm25 prefilter (top ~200 docs) ∪ explicit ids → bounded min-heap cosine top-k (MAX_K=50), chunk-neighborhood dedup, lexical fallback flag.
- **Tables**: `semantic_chunks`, `semantic_chunk_embeddings` (model + embedding_version, stale-on-backend-change), `ai_provenance`, `passage_scores`, `queue_item_embeddings`, `concepts`/`concept_links` (unpopulated by UI yet).
- **Frontend**: `ask-library` task (`src/lib/ai/tasks/definitions/libraryTask.ts`) + `useAskLibrary` + whole-library toggle in `AssistantPanel.tsx` with `ragConfig.ts`; `AiIndexPanel.tsx`, `EmbeddingSettings.tsx` settings; `runTask` engine with model-class routing, structured-output repair, streaming, coalescing.
- **Embedding providers** (Rust): OpenAI, Cohere, OpenRouter, Ollama (`ai/embeddings.rs` + shared `embedding_config.rs`).
- **Locators for citations**: `position_json` per-format positions, PDF reflow word anchors (`pdf_reflow_resolve_selection`), EPUB CFI, `youtube_transcripts` word timings, transcript segments.

## Gaps this change closes
1. **Index coverage** is document-content only → extend to extracts, notes/highlights, annotations, and (optionally) flashcard QA text via a `source_kind` dimension on `semantic_chunks`.
2. **No reranking or hybrid fusion** → add optional rerank stage + reciprocal-rank fusion of lexical+vector candidate sets (pluggable, off by default for perf).
3. **Citations are chunk-snippets** → structured `RagCitation { documentId, chunkId, quote, locator, score }` with jump-to-source into PDF (page/word anchor), EPUB (CFI), video (timestamp), and extract view.
4. **Indexing triggers are manual/idle-only** → change-driven incremental reindex (extract created, note edited, document reprocessed), throttled; document deletion cascades exist and are preserved.
5. **No cloud embedding tier** → `library_intelligence` capability adds Plethora-hosted embedding + optional hosted rerank via proposal 5's job system (`embed_batch` kind), with explicit privacy disclosure; local backends remain available to all users with their own keys/Ollama/Nano.
6. **Provenance/permissions**: per-document "exclude from AI/cloud" flag honored by indexing (local-only index allowed for excluded docs — cloud embeddings never touch them).

## What Changes

### 1. Index layer extensions (`ai_learning/`)
- `semantic_chunks` gains `source_kind` (document|extract|note|annotation|card) + `source_id` + optional `locator_json` (nullable; documents derive locators at retrieval time via existing segmentation mapping). Backfill migration (next free number; additive columns + index `(source_kind, source_id)`).
- Enrichment pipeline: extract/note/annotation creation and edit hooks enqueue reindex of the affected source (single-chunk granularity, reusing per-chunk content-hash staleness).
- Indexer scheduling: keep battery gate; add change-driven throttle (debounced queue, bounded).

### 2. Retrieval upgrades
- New command `rag_query { query, filters?, scope?, top_k, mode }` → `{ hits: RagHit[], fused_from: {lexical: n, vector: n}, reranked: bool, elapsed_ms }` implementing RRF fusion of FTS5 + vector candidates + optional reranker (provider abstraction: hosted cross-encoder via cloud capability, local reranker hook for future).
- `ai_learning_retrieve` stays for internal uses (tutor, connections); `rag_query` is the user-facing contract.
- Filters: collection, document type, tag, date range, `source_kind`, exclude-AI-flagged.

### 3. Citations + jump-to-source
- `RagCitation` with `locator` normalized per format (pdf: page + word-anchor via `pdf_reflow_resolve_selection`-compatible anchors; epub: CFI; video: timestamp; extract: extract id; note: anchor).
- Frontend `CitationChips` component (shared): click → open document at locator (deep-link through existing tab/reader navigation, `tabsStore` integration); hover → snippet preview.

### 4. Grounded answer layer
- `ask-library` task upgraded: retrieval via `rag_query`, context assembly with `[n]` markers (existing pattern from the earlier RAG iteration), strict citation validation (every `[n]` maps to a returned hit; answers citing nothing above threshold get "not in your library" handling), provenance recorded to `ai_provenance`.

### 5. Cloud tier (`library_intelligence` capability)
- Cloud embedding job kind `embed_batch` on proposal-5 framework: batched chunks, quota = tokens/month, results stored **client-side only** (server returns vectors; retention: none beyond job TTL; documented).
- Privacy surface: settings disclosure of what leaves the device (chunk text, metadata), per-document/cloud exclusion flag respected end-to-end.

### 6. UX
- Assistant whole-library mode becomes default-capable with index-status awareness (indexing progress, partial results with coverage note).
- "Ask my library" entry points: command palette, assistant, reader context ("related to this paragraph" — consumed by proposal 8).
- Settings: embedding backend picker (local vs cloud vs BYO), index management (status, pause, reset, exclusions).

## Impact

### Affected Specs
- `library-intelligence-rag` — New (coverage, fusion/rerank, citations, cloud tier, exclusions).

### Affected Code Areas
- `src-tauri/src/ai_learning/{chunker,indexer,retrieval}.rs`, new `rag_query` in `commands/ai_learning.rs` or `commands/rag.rs`; migrations (additive); `src/lib/ai/tasks/definitions/libraryTask.ts`; `AssistantPanel.tsx` citations; new `CitationChips`; `AiIndexPanel`/`EmbeddingSettings` evolution; `server/` job kind `embed_batch`; i18n.

### Non-goals
- No knowledge-graph construction (9), no ambient connections (8), no gap analysis (10), no ANN/vector-db server (bounded brute-force remains the local strategy at library scales; documented), no multimodal image embeddings.

## Dependencies

### Hard dependencies
- Rebrand, proposal 2 (capability gate for cloud tier).

### Soft dependencies
- Proposal 5 (cloud embedding jobs; local tier works without).

### May run concurrently
- 8, 9, 13 after the `rag_query` + citation contracts land (first milestone); 12 (tutor) extends existing retrieve calls.

### Must not start yet
- 10, 11 (need graph/coverage signals from 8/9).

## Shared interfaces (owned here)
- `rag_query` command + `RagHit`/`RagCitation` types; `source_kind` dimension; `CitationChips` component; cloud `embed_batch` job kind; "exclude from AI/cloud" document flag semantics.

## Ownership boundaries
- **May modify**: `ai_learning/` internals, its commands/UI panels, library task, migrations for chunk schema.
- **Must treat as external**: task engine (`runTask`), provider plumbing (`ai/embeddings.rs`, `commands/llm.rs`), proposal-5 job framework, assistant panel structure (additive only), readers' locator resolution APIs (consume, don't change).

## Collision risks
- `AssistantPanel.tsx` (also touched by 12 for tutor entry points — additive sections); `settingsStore` embedding section (17 TTS also adds settings — different subtrees); migration numbering re-anchor rule.

## Integration contract
- Downstream proposals (8–12) consume `rag_query`/`RagCitation` and the `source_kind` coverage; they must not re-implement retrieval or build parallel indexes.

## Testing & acceptance

### Tests
- Coverage: extracts/notes/annotations become searchable after creation (event-driven reindex within throttle window); deletion cascades; exclusion flag blocks cloud path but not local.
- Retrieval quality: golden-set retrieval tests (fixture library, seeded PRNG per bench rules) measuring recall@k for lexical-only/vector/fused modes with thresholds; rerank determinism.
- Citations: locator round-trips per format (pdf word anchor, CFI, timestamp); `[n]` marker ↔ hit mapping validation.
- Cloud tier: quota pre-flight, vectors-not-stored assertion, privacy flag enforcement.
- Performance: retrieval p95 under budget at 100k-chunk synthetic library (bench file `src/lib/ai/__tests__/ragQuery.bench.ts` candidate — add with baselines per AGENTS.md); indexing throughput bench with battery-gate simulation.

### Acceptance criteria
- "What have I read about X?" returns grounded, cited, jumpable answers across all document formats + extracts/notes; index updates incrementally on new highlights; excluded documents never leave the device; local-only mode (Ollama/Nano/BYO) remains fully functional for Free users.

### Must remain unchanged
- Existing `ai_learning_*` command behaviors other callers rely on (tutor, recall prompts); perf baselines for existing benches.

## Open questions
1. Default embedding backend ranking when multiple available (Nano vs Ollama vs BYO cloud vs Plethora cloud) — preference order configurable.
2. Re-embedding policy on model upgrades (`embedding_version` exists; auto vs prompted).
3. Whether flashcard QA text indexing ships default-on (card leakage into "what I know" answers) — default off pending product call.
