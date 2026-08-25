## 1. Stop overriding PDF.js text-layer CSS (D1)

- [x] 1.1 In `src/components/viewer/PDFViewer.css`, delete the `.textLayer`, `.textLayer span`, `.textLayer > span`, `.textLayer br`, `.textLayer span.markedContent`, and `.textLayer .endOfContent` / `.textLayer.selecting .endOfContent` blocks (currently ~L110-222); keep only the `::selection` tint rules and `cursor: text`
  - Note: the app-specific stacking rule `.textLayer { z-index: 1 }` is KEPT (design D1: "stacking/z-index rules that place the text layer above the canvas"). The app's own `[data-pdf-page] canvas { z-index: 1 }` rule pins the canvas at z-1, so upstream's `.textLayer { z-index: 0 }` alone would paint the canvas above the text layer and kill pointer events — this regression shipped once, was caught, and is now guarded by the css-guard stacking test.
- [x] 1.2 Reduce `.textLayerContainer` to stacking/pointer-events concerns only — remove any `overflow`, `user-select`, and sizing rules that duplicate or contradict `pdf_viewer.css`
- [x] 1.3 Confirm `pdfjs-dist/web/pdf_viewer.css` is imported before `./PDFViewer.css` in `PDFViewer.tsx` and that no remaining app rule uses `!important` on a text-layer selector
- [ ] 1.4 Manually verify selection accuracy at 100% zoom on: a single-column text PDF, a two-column academic PDF, and a marked-content-heavy PDF (the "Applied Evolutionary Psychology" book in the report)
- [ ] 1.5 Repeat 1.4 at 50%, 200%, and fit-width zoom; selection must stay within one character of the dragged glyphs

## 2. Restore PDF.js's whitespace-drag handling (D2)

- [x] 2.1 In `PDFViewer.tsx`, delete the `clickedTextLayerWhitespace` branch in `handleMouseDown` (~L2485-2503) including its `e.preventDefault()` and `removeAllRanges()`
- [ ] 2.2 Verify PDF.js applies `.selecting` to the text layer on drag start (inspect the DOM mid-drag) and that `.endOfContent` moves to `top: 0`
- [ ] 2.3 Manually verify: a drag started in the gap between two lines selects from the nearest text position and extends normally
- [ ] 2.4 Manually verify: a drag started in the page margin outside the text layer does not select the whole page

## 3. Remove the dead custom selection engine (D4)

- [x] 3.1 Delete `src/components/viewer/selection/` (`SelectionEngine.ts`, `SpatialIndex.ts`, `TokenExtractor.ts`, `usePdfCustomSelection.ts`, `types.ts`, `index.ts`, and `SelectionRenderer.tsx` unless it is being lifted for task 4.3)
- [x] 3.2 Remove `ENABLE_CUSTOM_PDF_SELECTION` (`PDFViewer.tsx:264`), the `usePdfCustomSelection` call and its `onSelectionChange` bridge (~L717-790), the `SelectionRenderer` usage, and every `ENABLE_CUSTOM_PDF_SELECTION` branch
- [x] 3.3 Delete the custom-selection CSS block in `PDFViewer.css` (~L255-313) and the `customSelectionActive` class plumbing
- [x] 3.4 Delete any tests/mocks referencing the removed modules; run `npm run typecheck` and the test suite to confirm no dangling imports

## 4. Persist the committed selection (D3, D5)

- [x] 4.1 Extend the mouseup commit in `PDFViewer.tsx` to store the committed `PdfSelectionContext` as persisted-selection state (the context already carries per-page `viewportRects` and `pdfRects`)
- [x] 4.2 Derive overlay rects from `pdfRects` through the current page viewport, never from cached CSS pixels, so re-derivation at any scale is exact
- [x] 4.3 Render the overlay per page inside the existing `pdf-highlight-overlay` stack in `PdfPageView.tsx` (reuse `HighlightLayer`'s rect rendering, or lift `SelectionRenderer` — exactly one of the two)
- [x] 4.4 Recompute overlay rects on `onViewportChange` (zoom / relayout); skip painting for pages that are not currently rendered without discarding committed state
- [ ] 4.5 Verify the overlay stays visible when focus moves to the selection popup, to the assistant input, and to another tab-panel control
- [ ] 4.6 Verify the overlay survives an unrelated viewer re-render (toast, page-indicator update) and an idle period

## 5. Centralize clear semantics (D6)

- [x] 5.1 Add a single `clearPersistedSelection()` that resets overlay state, popup state, and downstream selection state
- [x] 5.2 Stop `handleSelectionChange`'s empty-selection branch (~L2439-2444) from clearing the overlay — a dropped native selection is no longer a clear signal
- [x] 5.3 Call the clear path from: pointer-down starting a new in-page selection, click outside any PDF page, `Escape`, document change, and completion of an action that consumes the selection
- [x] 5.4 Re-check whether `pdfTextSelectionGestureActiveRef` and `ignoreSelectionChangeRef` are still needed once the overlay is authoritative; delete whichever guard is now redundant
- [x] 5.5 Confirm the OCR flow (`ocrActive`) clears a persisted selection when region selection starts

## 6. Regression coverage

- [x] 6.1 Add a stylesheet guard test asserting no app CSS declares `display`, `height`, `top`, `line-height`, `box-sizing`, `margin`, `padding`, `border`, `overflow`, `position`, or `transform` on `.textLayer` or its span / `.markedContent` / `.endOfContent` descendants
- [x] 6.2 Add unit tests for the commit/clear state machine: commit on valid selection, no commit for collapsed / non-PDF / empty-text selections, clear on each of the five clear triggers, no clear on native-selection loss
- [x] 6.3 Add a test that overlay rects re-derive correctly across a scale change
- [x] 6.4 Run the full test suite and `npm run typecheck`; record the net line-count change from tasks 1-5
  - Full suite: 2329 passed / 1 skipped / 1 failed — the single failure is the pre-existing flaky `src/lib/__tests__/precisionScheduler.test.ts` ensemble test (passes in isolation; unrelated to this change). `tsc --noEmit` clean.
  - Net line change, tasks 1–5 (code only): PDFViewer.tsx + PDFViewer.css + PdfPageView.tsx + HighlightLayer.tsx = −204 (215+/419−); selection/ engine deleted = −2,027; new code SelectionOverlay.tsx (+63) + pdfSelectionPersistence.ts (+84). **Code net ≈ −2,084 lines** (design goal: net code reduction ✓). Task 6 tests add +374 lines.

## 7. Cross-platform and reconciliation

- [ ] 7.1 Verify the full flow on macOS/WKWebView (the reported environment): select → highlight stays → popup action → clear
- [ ] 7.2 Verify no regression on a Chromium-based webview
- [ ] 7.3 Verify touch/trackpad selection has not regressed
- [x] 7.4 Reconcile with the unarchived `fix-pdf-text-selection` change (18/26 tasks done, same handlers): confirm its remaining tasks are still valid or fold them in, and note the outcome in that change's tasks.md
  - Done: its 2.2/2.3 clearing semantics are superseded by the explicit-clear model; remaining tasks (3.5, 4.4, 5.x) still valid; outcome noted in `fix-pdf-text-selection/tasks.md` §6.
