## Context

The PDF viewer renders pages with PDF.js canvas output and overlays a PDF.js text layer for text-backed documents. Existing code also has a disabled custom geometric selection engine, PDF selection context types, `SelectionPopup`, and `DocumentViewer` extract integration. The repair should focus on making the current native text-layer path work reliably across the user-facing actions: select, copy, highlight, extract, and learning-item creation.

There is already related work in `improve-pdf-text-selection-extraction`; this change narrows the remaining problem to end-to-end behavior and verification in the current viewer.

## Goals / Non-Goals

**Goals:**
- Make normal drag selection work on text-backed PDF pages in the in-app PDF viewer.
- Preserve platform copy behavior from the PDF text layer.
- Emit PDF selection context only for selections anchored in PDF text-layer DOM.
- Allow the PDF selection popup and existing extract actions to create highlights/extracts from valid selected PDF text.
- Carry selected text plus document/page context into learning-item and flashcard creation paths.
- Add automated and manual regression coverage for the full selection-to-action flow.

**Non-Goals:**
- Add OCR for scanned or image-only PDFs.
- Replace PDF.js or switch to the disabled custom selection engine by default.
- Redesign the extract, highlight, or learning-item data model.
- Implement durable PDF annotations beyond the app's existing extract/highlight persistence.

## Decisions

1. Use the PDF.js text layer as the primary selection surface.
- Rationale: The browser already provides expected drag selection and copy semantics when the text layer is correctly mounted and styled.
- Alternative considered: Enable the custom geometric selection engine globally; rejected because it would bypass standard copy behavior and increase maintenance risk.

2. Treat selection validity as an integration boundary.
- Rationale: `PDFViewer` should only emit selected text and `PdfSelectionContext` when both selection anchors originate from PDF text-layer roots and the selected range intersects PDF text-layer content. This prevents toolbar, footer, side panel, or search UI text from entering PDF extract flows.
- Alternative considered: Let `DocumentViewer` inspect the DOM selection; rejected because PDF-specific DOM knowledge belongs inside the PDF viewer.

3. Reuse the existing instant extract/highlight pipeline.
- Rationale: The app already has `SelectionPopup`, `createInstantExtract`, toast feedback, persisted highlights, and extract editing flows. The fix should correct guards and payloads rather than create a PDF-only parallel path.
- Alternative considered: Add a dedicated PDF extract service call; rejected because the backend contract already accepts selected text and selection context.

4. Keep image-only pages explicit but non-blocking.
- Rationale: A page without a text layer should not pretend selection is available. Users can still use OCR flows where available, but no false selected text or empty extract action should be surfaced.
- Alternative considered: Automatically trigger OCR on failed selection; rejected as a separate product decision with extra latency and provider concerns.

5. Verify behavior with both automated tests and manual PDF fixtures.
- Rationale: Text selection is sensitive to WebView/browser behavior, CSS layering, pointer events, and PDF.js internals, so unit tests alone are not enough.
- Alternative considered: Manual-only validation; rejected because regressions in selection guards and action gating are easy to reintroduce.

## Risks / Trade-offs

- [Risk] Some PDFs expose malformed or partial text layers, leading to imperfect selected text. -> Mitigation: keep behavior scoped to text-backed pages and gate actions on non-empty validated selections.
- [Risk] Selection popup pointer handling could clear the native selection before the user clicks an action. -> Mitigation: preserve selected text/context in component state before action clicks and only clear after the action completes or is dismissed.
- [Risk] CSS or z-index changes could affect search highlights, TTS highlights, persisted highlights, or OCR overlays. -> Mitigation: test all overlay layers on at least one text-backed PDF and one image-only/no-text-layer PDF.
- [Risk] Tauri WebView selection behavior may differ from desktop browsers. -> Mitigation: include manual verification in the Tauri app in addition to browser tests where possible.

## Migration Plan

1. Repair text-layer mounting, CSS, and pointer-event handling in `PDFViewer`.
2. Tighten PDF selection validation and preserve selected text/context for popup actions.
3. Wire highlight/extract/learning-item actions to the validated PDF selection payload.
4. Add regression tests for selection validity, action gating, and extract payloads.
5. Manually verify select/copy/highlight/extract/learning-item behavior with text-backed and no-text-layer PDFs.
6. Roll back by restoring previous selection guards and disabling the popup actions for invalid PDF selections if a runtime-specific regression appears.

## Open Questions

- Should the UI show a page-level "text selection unavailable" hint for scanned pages, or rely on disabled actions for this fix?
- Should the dormant custom selection engine remain in the codebase after native text-layer selection is fully verified?
