# Technical Design: Library Saved Views & PDF Highlighting

## 1. PDF Highlighting Alignment (`BUG-11`)
- `src/components/viewer/PdfPageView.tsx`:
  - Maintain `activeViewport` in React state (updated whenever `init()` or `useEffect([pdfScale, rotation])` updates `pageView.viewport`), and pass `activeViewport` to `HighlightLayer` and `SelectionOverlay` so `React.memo` never freezes a `null` or previous-zoom `viewport`.
  - Position `.pdf-highlight-overlay` using the actual `.page` content-box dimensions/offset (or strip PDF.js's `.page` transparent 9px border/negative margin inside `slotRef` so `slotRef` and `.page` share the exact `(0, 0)` origin and width/height).
- `src/components/viewer/PDFViewer.tsx`:
  - Pass `rotation={fixedView.rotation}` to `PdfPageViewWrapper`.
  - Measure `.page` (excluding border) or `.textLayer` rect when converting client selection coordinates to PDF points so `buildPdfSelectionContext`, `hitTestClientPoint`, and `HighlightLayer` use the identical coordinate origin.

## 2. Library Saved Views (`BUG-13`)
- `src/components/documents/DocumentsView.tsx`:
  - Extend `SavedView` with `categoryFilter?: string`, `compactFilter?: CompactDocumentFilter`, `captureSource?: string`.
  - Update `handleSaveView` to persist `selectedCategory`, `compactFilter`, `captureSource`, `selectedFileType`, `debouncedSearch`/`searchInput`, `sortKey`, `sortDirection`, `mode`, `compactDocumentsView`, `showNextAction`.
  - Update `handleApplyView` to apply all saved fields (including `selectedCategory` and `compactFilter`), and when `viewId === ""` (default view), reset filters cleanly to defaults.
  - Add delete/rename support for Saved Views if missing and clear `activeViewId` when the user manually changes a filter.
