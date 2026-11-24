# Change: Fix EPUB Loading Path Persistence and Document/Video Indexing Reliability

Covers **BUG-04** (certain EPUB documents fail to load with `Cannot stat epub file: No such file or directory`) and **BUG-08** (document and video indexing failures marked as `25/77 · indexed` with `Embedding backend could not complete the request`).

## Why

1. **BUG-04 (EPUB loading fails):** `sweep_stale_staging_files` (`src-tauri/src/commands/document.rs:2520`) runs on every startup and deletes files in `<app_data_dir>/imports/` older than 24 hours without checking whether any `documents.file_path` row still references them — and unlike Audio, EPUB/PDF imports are never copied out of `imports/` into permanent app storage. `get_epub_stream_url` (`src-tauri/src/epub_server.rs:447`) also lacks relative-path resolution against `app_data_dir` and `DocumentViewer.tsx` passes remote `http(s)://` URLs directly to `get_epub_stream_url`.
2. **BUG-08 (Document/video indexing failures):** In `src-tauri/src/ai_learning/indexer.rs`, `embed_chunks` aborts on the first failed batch (`EMBED_BATCH_SIZE=25`), discards the underlying error reason, and `index_document_once` unconditionally marks the document `"indexed"` (`25/77 · indexed`), preventing automatic or manual retry. Meanwhile, `OllamaEmbeddingProvider` calls `/api/embeddings` without `truncate: true` or timeouts, and `chunk_transcript` / `single_chunk` can exceed 512 tokens.

## What Changes

- **Protect & relocate imported EPUB/PDF files:** Copy staged EPUB/PDF imports into permanent `<app_data_dir>/documents/` (or skip referenced paths in `sweep_stale_staging_files`), resolve relative paths in `get_epub_stream_url`, and handle remote/missing EPUB paths gracefully in `DocumentViewer.tsx` with clear recovery UI.
- **Truthful partial indexing & resilient chunking:** Introduce/use a truthful partial/failed state (e.g. `IndexState::Partial` or `Failed` when `embedded < total && embed.error.is_some()`, preserving lexical searchability while surfacing the exact reason and enabling retry/resume without duplicating existing chunks/embeddings); add `truncate: true` + timeout + per-item fallback on batch failure in `OllamaEmbeddingProvider`; enforce strict token-safe chunk bounds in `chunk_transcript` and `chunker.rs`; and expose a Retry action in `AiIndexPanel.tsx`.
