# Change: Improve Document Reader Reliability, Semantic Indexing, and Section Grounding

Covers **Requirement #1** (persistent PDF zoom), **Requirement #3** (arXiv table overflow), **Requirement #8** (automatic semantic indexing on import), and **Requirement #10** (PDF `#` section context resolution in the Assistant).

## Why

1. **PDF zoom persistence (#1):** `DocumentViewer.tsx` and `PDFViewer.tsx` have several competing state paths: `pdfFingerprintRef` is populated asynchronously after `isLoading` becomes `false`; `PDFViewer.handleScroll` reports `pageScaleRefs.current[pageIndex]` (which can be a computed fit scale or stale pre-zoom scale) back to `DocumentViewer.handleScrollPositionChange`; zoom-only changes without scroll fail to update `lastViewStateRef.current` when `captureScrollState()` is null or restoration flags are active; and unmount cleanup writes using `getPreferredViewStateKey({ documentId })` without `contentHash`/`pdfFingerprint`.
2. **arXiv table overflow (#3):** In `articleReaderStyles.ts`, line 203 applies `max-inline-size: 100%` to `table` after line 177 sets `inline-size: max-content; min-inline-size: 100%`, and `compatibilityReaderStyles.ts` (for legacy arXiv docs) applies `body * { max-width: 100% !important }` and `table { inline-size: 100% !important; max-inline-size: 100% !important }`, preventing wide tables from scrolling cleanly within `.inc-table-wrap` / `.ltx_tabular` or clipping columns.
3. **Automatic semantic indexing (#8):** Only YouTube, transcription completions, and study-source promotions call `try_enqueue_document`. Standard document imports (PDF, EPUB, HTML, arXiv, Markdown, clipboard, browser extension, mobile share, RSS, audiobooks, OCR, sync) never enter `IndexerQueue`, and `Worker::run` does not reconcile unindexed/stale documents on startup.
4. **PDF `#` section targeting (#10):** `convertPdfOutlineToSectionNodes` initializes PDF outline nodes with `content: ""`. Because extracted PDF text lacks Markdown `#` headings and PDF outline titles often differ from raw extracted text lines (page numbers, wraps, ligatures, TOC entries), `mergeOutlineWithHeuristics` and `recoverOutlineRangeFromText` either leave `content === ""` (0 tokens) or match heading-only/TOC lines (~8 tokens).

## What Changes

- **PDF zoom persistence:** Make `DocumentViewer` the single authoritative owner of `zoomMode` and `scale`, prevent `PDFViewer.handleScroll` from overwriting `zoomMode` or custom `scale` with transient `pageScaleRefs`, persist zoom-only changes immediately to `lastViewStateRef` and `setViewState`, unify unmount key resolution with `resolvePreferredViewStateKey`, and re-check fingerprint-keyed `ViewState` when `handlePdfInfo` arrives if no user interaction occurred yet.
- **arXiv table overflow:** Fix `articleReaderStyles.ts` and `compatibilityReaderStyles.ts` so `.inc-table-wrap` / `.ltx_table` / `.ltx_tabular` containers scroll horizontally (`overflow-x: auto; max-inline-size: 100%`) while inner `<table>` elements keep `inline-size: max-content; min-inline-size: 100%; max-inline-size: none` without widening the article root, and add a subtle scroll-overflow affordance.
- **Automatic semantic indexing:** Add a durable, consent-respecting post-import/post-commit enqueue hook in `Repository` / import commands and startup reconciliation in `ai_learning::indexer::Worker` so newly imported, updated, OCR'd, and synced documents enter `IndexerQueue` automatically (respecting `paidEmbeddingsEnabled`, `is_ai_excluded`, `is_local_only`, and lexical-only fallback when no embedding model is available), and surface accurate per-document index states.
- **PDF `#` section resolution:** Resolve PDF outline `pageNumber` destinations, map page-bounded extracted text (with fuzzy/normalized heading matching and page-span slicing when outline page numbers are available, avoiding TOC false positives and empty-body matches), and enforce non-empty body resolution before sending section context to the Assistant.

## Impact

- **Affected specs:** `pdf-zoom-persistence`, `arxiv-table-overflow`, `automatic-semantic-indexing`, `document-section-mention-resolution`
- **Non-goals:** Changing PDF page geometry in canvas mode, altering cloud billing consent defaults, or rebuilding the existing `ai_learning` chunking/FTS5/vector tables.
