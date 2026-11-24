## 1. EPUB Path Persistence & Loading (BUG-04)
- [ ] 1.1 Update `sweep_stale_staging_files` in `src-tauri/src/commands/document.rs` to never delete files referenced by `documents.file_path`, and copy staged EPUBs/PDFs to permanent app storage on import.
- [ ] 1.2 Add app-data relative path fallback and URL guard in `src-tauri/src/epub_server.rs::get_epub_stream_url`.
- [ ] 1.3 Improve `DocumentViewer.tsx` EPUB error messaging and recovery actions.

## 2. Indexing Reliability & Truthful State (BUG-08)
- [ ] 2.1 Preserve underlying embedding error reason in `indexer.rs::embed_chunks` and record `"partial"` / `"failed"` instead of `"indexed"` when `embedded < total`.
- [ ] 2.2 Support resuming `"partial"` documents in `Worker::run` without duplicating chunks or embeddings.
- [ ] 2.3 Add timeout, `truncate: true`, and single-chunk fallback to `OllamaEmbeddingProvider` in `src-tauri/src/ai/embeddings.rs`.
- [ ] 2.4 Tighten `chunk_transcript` formatted-size budget in `src-tauri/src/ai_learning/chunker.rs`.
- [ ] 2.5 Display `"partial"` / `"failed"` badges and Retry button in `src/components/settings/AiIndexPanel.tsx`.

## 3. Regression Tests
- [ ] 3.1 Add Rust test verifying `sweep_stale_staging_files` preserves referenced EPUBs and `get_epub_stream_url` resolves relative/app-data EPUBs and errors clearly on missing files.
- [ ] 3.2 Add Rust test verifying partial embedding failure records `"partial"` (not `"indexed"`), preserves lexical search, and resumes without duplicate embeddings.
