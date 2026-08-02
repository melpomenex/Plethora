## 1. Primary HTML document viewer

- [x] 1.1 In `DocumentViewer.tsx`, in the `onLoad` handler of the primary `docType === "html"` iframe (around the `injectHtmlViewerStyles()` call), attach a `contextmenu` listener to `iframeRef.current.contentDocument` that reads the current selection, calls `e.preventDefault()` only when text is selected, and otherwise lets the native/no menu behavior stand.
- [x] 1.2 Translate the listener's coordinates using `iframe.getBoundingClientRect()` plus the inner event's `clientX`/`clientY`, matching the pattern in `EPUBViewer.tsx`'s `contents.document.addEventListener("contextmenu", ...)`.
- [x] 1.3 Call `setContextMenuState({ visible: true, x, y, selectedText, selectionContext })` with the same `selectionContext` shape/derivation already used by `updateSelection` for HTML documents.
- [x] 1.4 Verify the listener is not duplicated across reloads — confirm the existing `key={`${currentDocument.id}:${htmlFrameRevision}`}` remount fully replaces `contentDocument` per load (no manual cleanup needed), and remove/guard if testing shows otherwise.

## 2. OCR HTML view iframe

- [x] 2.1 Apply the same `contextmenu` listener wiring (from Task 1) to the OCR HTML iframe rendered when `pdfViewMode === "ocr-html" && ocrResult.format === "html"`.
- [x] 2.2 Confirm `selectionContext` derivation for this branch is reasonable (reuse whatever the existing `onOcrExtractText`/selection flow already produces for this view; do not invent new page-number logic).

## 3. Verification

- [ ] 3.1 Manually test: import a web page via the Browser Extension, select text in the resulting HTML document, right-click, and confirm the context menu appears with all six actions and creates an extract correctly.
- [ ] 3.2 Manually test the same flow on the OCR HTML view for a PDF.
- [ ] 3.3 Confirm right-click without a selection does not show the custom menu.
- [ ] 3.4 Confirm menu position is correct after scrolling the iframe content.
- [ ] 3.5 Confirm PDF documents are unaffected (still use `SelectionPopup`, not this context menu).
- [ ] 3.6 Spot-check the mobile lightbulb extract button already appears for HTML documents (per design.md Open Questions); file a follow-up only if it does not.
