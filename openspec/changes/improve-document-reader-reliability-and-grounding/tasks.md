# Tasks: Improve Document Reader Reliability, Semantic Indexing, and Section Grounding

## 1. Persistent PDF Zoom (#1)
- [x] 1.1 Prevent `PDFViewer.handleScroll` / `DocumentViewer.handleScrollPositionChange` from overwriting `zoomMode` or `scaleRef.current` with transient `pageScaleRefs`.
- [x] 1.2 Ensure zoom-only changes persist immediately (even without scrolling) and unmount cleanup uses `resolvePreferredViewStateKey` with current `scaleRef`/`zoomModeRef`.
- [x] 1.3 Reconcile `pdfFingerprintRef` arrival in `handlePdfInfo` so fingerprint-keyed zoom/position restores cleanly if no user interaction occurred.
- [x] 1.4 Reset `scale`/`zoomMode` on document switch and verify `readerPosition` persistence tests pass.

## 2. arXiv Table Overflow (#3)
- [x] 2.1 Fix `articleReaderStyles.ts` and `compatibilityReaderStyles.ts` so wide tables inside `.inc-table-wrap` / `.ltx_tabular` / `.ltx_table` scroll horizontally without widening `.inc-article` or clipping columns.
- [ ] 2.2 Run Playwright scholarly-reader geometry tests with system Chromium (note: Playwright config requires matching headless shell or `launchOptions.executablePath` override).

## 3. Automatic Semantic Indexing (#8)
- [x] 3.1 Wire `try_enqueue_document` / post-commit indexing across Rust document import, update, Kindle multi-import, browser sync, and OCR pathways.
- [x] 3.2 Add startup reconciliation in `ai_learning::indexer::Worker` for unindexed/stale/queued documents, respecting `paidEmbeddingsEnabled`, `is_ai_excluded`, `is_local_only`, and lexical fallback.
- [x] 3.3 Verify `ai_learning` Rust retrieval and indexing test suite passes.

## 4. PDF `#` Section Grounding (#10)
- [x] 4.1 Resolve PDF outline `pageNumber`s into `useDocumentOutlineStore` / `convertPdfOutlineToSectionNodes` and harden `sectionIndex.ts` against heading-only (~8-token) and TOC-line false matches.
- [x] 4.2 Add page-span + normalized heading body resolution for PDF outline nodes and enforce non-empty body verification before sending `#` section context to the Assistant.
- [x] 4.3 Add unit tests covering ligature/whitespace PDF headings, TOC-prefixed chapters, and page-span fallback (`pdfSectionResolution.test.ts`).
