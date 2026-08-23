## Why

Plethora’s knowledge source of truth is SQLite (`ai_learning` chunks + FTS5 + vectors). Android AppSearch can add a **derived**, app-private keyword (± vector) index for hybrid retrieval — not a second library. Used well, “that article about virtual memory” can hit paging/TLB chunks via embeddings **and** still exact-match titles via keywords. Used poorly, private notes leak to system UI or drift after deletes.

## Existing behavior

- `src-tauri/src/ai_learning/` indexes document chunks, cosine top-k, FTS5 prefilter, cascade deletes.
- No AppSearch usage in the repo.
- Intelligence-wave OpenSpec adds `rag_query` / `source_kind`; this change must implement behind that, not fork it.

## Repository evidence

- `ai_learning/{chunker,indexer,retrieval,embeddings_backend}.rs`
- EmbeddingGemma via `plethora-android-genai` (`embed_texts`)
- `libraryTask.ts` / `LibraryAnswer`

## What Changes

- New **optional** plugin `plethora-android-search` using **AppSearch LocalStorage only**.
- `setSchemaTypeDisplayedBySystem(type, false)` on every type (and equivalent document-class API). Default: **never** system surfaces.
- Index a **thin projection**: documents, chunks, extracts, notes — not every image blob. IDs: `plethora/{kind}/{id}` and `plethora/document/{id}/chunk/{chunkId}` matching canonical UUIDs.
- AppSearch stores optional embedding vectors **produced by existing embedding backends**. AppSearch does **not** generate embeddings.
- Hybrid: FTS5/AppSearch keyword ∪ vector candidates → existing ranking/RRF if present.
- Lifecycle: insert/update/delete/rebuild/schema migration/stale recovery/account reset. **No orphan hits after canonical delete.**
- Feature flag default off until size/quality gates pass.

## Capabilities

### New Capabilities
- `android-appsearch-index`: private derived index, hybrid candidate source, privacy flags, lifecycle.

### Modified Capabilities
- `ai-semantic-index` / `ai-library-rag`: optional candidate source; SQLite remains SoT.

## Impact

- New plugin; retrieval trait in `retrieval.rs`; indexer hooks.
- APK size: LocalStorage is heavier than PlayServicesStorage — flag + measure; if too large, keep flag off.

## Non-goals

- Replacing SQLite.
- System-wide search exposure.
- Embedding model training.
- Indexing full page images.

## Dependencies

- A (retriever interface). Embeddings already exist.
- D consumes this as an optional retriever.

## Expected ownership

- **Agent C.** Does not own Gemini prompts or document schema refactors.
