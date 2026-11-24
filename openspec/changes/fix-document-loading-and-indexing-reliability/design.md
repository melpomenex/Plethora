# Technical Design: Document Loading and Indexing Reliability

## 1. EPUB Storage & Stream URL Resolution (`BUG-04`)
- `src-tauri/src/commands/document.rs`:
  - `sweep_stale_staging_files`: query `SELECT file_path FROM documents` (canonicalized/normalized) and NEVER delete any file in `imports/` that is still referenced by a `documents` row.
  - For staged imports (`imports/`), copy EPUB/PDF files into permanent `<app_data_dir>/incrementum/documents/` (parallel to `incrementum/audio`) so they are never treated as ephemeral staging files.
- `src-tauri/src/epub_server.rs::get_epub_stream_url`:
  - If `file_path` is relative, resolve against `app_data_dir`. If `file_path` is an `http(s)://` URL, return a clear structured error or handle appropriately before `fs::canonicalize`.
- `src/components/viewer/DocumentViewer.tsx`:
  - Surface clear error stage, document title, and recovery actions (e.g. Relocate file / Re-import) when `get_epub_stream_url` fails.

## 2. Truthful Indexing State & Resilient Embedding (`BUG-08`)
- `src-tauri/src/ai_learning/indexer.rs`:
  - Preserve `reason` in `EmbedOutcome.error` instead of discarding it into a generic string.
  - When `embed.error.is_some()` and `embed.embedded < total`: do NOT mark `state = "indexed"`; record `state = "partial"` (when `embedded > 0`, keeping lexical search active) or `"failed"` (when `embedded == 0`) with the actionable `last_error`.
  - Allow `Worker::run` and `ensure_documents_chunks_indexed` to resume `"partial"` documents by embedding only chunks missing from `chunk_embeddings` (no duplicate chunks or embeddings).
- `src-tauri/src/ai/embeddings.rs::OllamaEmbeddingProvider`:
  - Add `options: { num_ctx: ... }` / `truncate: true` (or `/api/embed` with `truncate: true` + fallback) and a per-request timeout.
  - In `generate_embeddings_batch`, if a batch fails, fall back to individual chunk embedding (or isolate the failing chunk) rather than aborting all 25 chunks on one bad chunk.
- `src-tauri/src/ai_learning/chunker.rs`:
  - Bound `chunk_transcript` by formatted character/token budget (including `[M:SS] ` prefixes) so chunks stay safely under 512 tokens (~1200 chars / ~350 words max).
- `src/components/settings/AiIndexPanel.tsx`:
  - Render `"partial"` / `"failed"` status badges accurately and provide a per-document Retry button.
