# Design: Document Reader Reliability, Indexing, and Grounding

## 1. PDF Zoom Persistence (#1)
- **Authoritative state:** `DocumentViewer` owns `zoomMode` (`"fit-width" | "fit-page" | "custom"`) and `scale` (numerical scale for `"custom"`). Semantic modes (`fit-width`, `fit-page`) are never converted to `"custom"` by resize or scroll events.
- **Scroll callback isolation:** `handleScrollPositionChange` in `DocumentViewer` preserves `zoomModeRef.current` and `scaleRef.current` rather than accepting a stale `pageScaleRefs` value from `PDFViewer.handleScroll`.
- **Zoom-only persistence:** Changing zoom via toolbar, shortcut, or pinch immediately updates `lastViewStateRef.current` and calls `setViewState` using `resolvePreferredViewStateKey(documentId)` even if `captureScrollState()` is null (e.g. page 1 at top). Unmount cleanup uses `resolvePreferredViewStateKey(documentId)` and merges `scaleRef.current` / `zoomModeRef.current` so late unmount never writes stale zoom.
- **Fingerprint arrival:** When `handlePdfInfo` supplies `pdfFingerprintRef.current`, if the user has not manually changed zoom/page yet and a fingerprint-keyed `ViewState` is newer than what was restored, apply it once cleanly.

## 2. arXiv Table Overflow (#3)
- **Canonical arXiv (`articleReaderStyles.ts`):** Keep `.inc-wide, .inc-table-wrap` at `inline-size: 100%; max-inline-size: 100%; overflow-x: auto;`, and remove `table` from the `max-inline-size: 100%` rule on line 203 (using `max-inline-size: none` inside `.inc-table-wrap table` while keeping standalone un-wrapped tables safe).
- **Legacy arXiv (`compatibilityReaderStyles.ts`):** Exclude `table` inside `.ltx_tabular, .ltx_table, .inc-table-wrap` from `max-width: 100% !important` and `inline-size: 100% !important` so wide LaTeXML tables scroll inside their wrapper instead of clipping or squishing columns.
- **Playwright geometry tests:** Test wide tables at desktop, tablet, mobile, and with open Assistant panel in light and dark themes.

## 3. Automatic Semantic Indexing (#8)
- **Post-commit durability:** Add a `try_enqueue_document` hook in `AiLearningState` / `IndexerQueue` and wire all Rust document creation/import/update/OCR/sync pathways (and a startup reconciliation pass in `Worker::run` that queries documents missing from `ai_index_state` or marked `'stale'`/`'queued'` without an active job).
- **Consent & privacy:** Background auto-indexing uses the configured local/on-device backend (or lexical-only FTS5 when no local embedder is available). Cloud embedding providers are only used if `paidEmbeddingsEnabled === true` and `ensure_document_ai_allowed(doc_id, true)` passes.
- **Deletion & updates:** Document deletion removes chunks/state; content updates mark `ai_index_state = 'stale'` and re-enqueue.

## 4. PDF `#` Section Resolution (#10)
- **Outline-to-text alignment:** In `PDFViewer` / `useDocumentOutlineStore`, resolve outline `dest` to 1-based `pageNumber` when building `SectionNode`s. In `sectionIndex.ts`, when `source === "pdf-outline"`, skip TOC front-matter matches, normalize ligatures/whitespace/page numbers, and use resolved `pageNumber` boundaries (when available) or fuzzy heading matching with a strict non-empty body guard (`body.length > 0`) so heading-only (~8-token) or 0-token slices are never silently treated as resolved.
- **Picker & send-time UX:** Show accurate token estimates for resolved sections, `"Extracting…"` / `"Unavailable"` states when unresolved, and prevent silent fallback to heading-only or full-document prompts.
