## 1. PDF text-layer selection surface

- [x] 1.1 Audit `PDFViewer` text-layer mounting, sizing, z-index, pointer events, and cleanup against the current PDF.js 5 text-layer API.
- [x] 1.2 Fix any CSS or DOM layering issues that prevent normal drag selection on text-backed PDF pages.
- [x] 1.3 Verify selection remains aligned after zoom, fit mode, page virtualization, and page re-render events.
- [x] 1.4 Ensure image-only or no-text-layer pages do not surface false selectable text state.

## 2. Selection validation and state handoff

- [x] 2.1 Tighten PDF selection validation so emitted selections must originate from PDF text-layer roots and contain non-empty text.
- [x] 2.2 Preserve selected text and `PdfSelectionContext` long enough for popup actions after pointer release.
- [x] 2.3 Clear PDF selection context when selection becomes empty, collapsed, whitespace-only, outside the PDF layer, or invalidated by page teardown.
- [x] 2.4 Ensure non-PDF UI text cannot enter PDF extract/highlight payloads.

## 3. Copy, highlight, extract, and learning-item actions

- [x] 3.1 Verify normal keyboard/context-menu copy returns the selected PDF text.
- [x] 3.2 Fix `SelectionPopup` copy behavior if it does not preserve the selected PDF text.
- [x] 3.3 Ensure PDF popup highlight creates an instant extract/highlight only for valid PDF selections and shows existing toast feedback.
- [x] 3.4 Ensure the extract creation flow is prefilled with selected PDF text and receives PDF document/page selection context.
- [ ] 3.5 Ensure learning-item and flashcard creation flows receive selected PDF text and source context without manual re-entry.
- [x] 3.6 Ensure invalid PDF selections do not create extracts, highlights, learning items, or success toasts.

## 4. Automated regression coverage

- [x] 4.1 Add or update tests for PDF text-layer availability and alignment-related selection helpers.
- [x] 4.2 Add or update tests for valid versus invalid PDF selection context emission.
- [x] 4.3 Add or update tests for PDF highlight/extract action gating and payload content.
- [ ] 4.4 Add or update tests for `DocumentViewer` handoff of PDF selected text into extract and learning-item flows.
- [x] 4.5 Run targeted Vitest coverage for the changed PDF viewer, selection, and extract tests.
- [x] 4.6 Run `npm run build:check`.

## 5. Manual verification

- [ ] 5.1 Verify in the desktop app that a text-backed PDF supports selecting words, lines, and paragraphs.
- [ ] 5.2 Verify copied text from a PDF selection matches the selected visible text.
- [ ] 5.3 Verify PDF selection popup highlight creates a visible/persisted highlight or extract and shows success feedback.
- [ ] 5.4 Verify creating an extract from PDF selection prepopulates selected text and source context.
- [ ] 5.5 Verify creating a learning item or flashcard from PDF selection carries selected text and source context.
- [ ] 5.6 Verify an image-only or no-text-layer PDF does not enable false selection-based actions.

## 6. Reconciliation with fix-pdf-selection-persistence (2026-08)

The `fix-pdf-selection-persistence` change was implemented against the same
handlers (mouseup commit, mousedown clear, selectionchange). Outcome:

- **2.2 / 2.3 superseded in part.** 2.2 ("preserve text + context after pointer
  release") is now stronger: the committed `PdfSelectionContext` is persisted
  through `reducePdfSelectionPersistence` and painted as a per-page overlay
  that survives focus moves. 2.3's "clear when the selection becomes empty,
  collapsed, or whitespace-only" was the headline bug — a dropped *native*
  selection is no longer a clear signal. Clear semantics are now explicit
  (new in-page drag, click outside a page, `Escape`, document change, action
  completion, OCR region selection); a `selectionchange`-driven clear must not
  be reintroduced.
- **Remaining tasks still valid:** 3.5 (learning-item/flashcard flows), 4.4
  (DocumentViewer handoff tests), and the 5.x manual checks are independent of
  the persistence layer and remain open as originally scoped. The committed
  selection's text/context is available via `onSelectionChange` exactly as
  before, so downstream consumers need no changes.
- **No code reverts needed** — the two changes do not conflict; this change
  fixed the selection itself, the other fixed the actions on a selection.
