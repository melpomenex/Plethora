## 1. PDF Highlighting Alignment (BUG-11)
- [ ] 1.1 Store `viewport` in reactive state in `PdfPageViewWrapper` (`src/components/viewer/PdfPageView.tsx`) and align `.pdf-highlight-overlay` with `.page`'s content box.
- [ ] 1.2 Pass `rotation` to `PdfPageViewWrapper` and measure `.page` content rect consistently in `PDFViewer.tsx`.

## 2. Library Saved Views (BUG-13)
- [ ] 2.1 Extend `SavedView`, `handleSaveView`, and `handleApplyView` in `src/components/documents/DocumentsView.tsx` to persist and restore `selectedCategory`, `compactFilter`, and `captureSource`.
- [ ] 2.2 Reset filters when returning to the default view and clear `activeViewId` on manual filter changes.

## 3. Regression Tests
- [ ] 3.1 Add Vitest tests for `PdfPageViewWrapper` / `HighlightLayer` viewport updates across mount, zoom, and rotation, and coordinate-origin alignment.
- [ ] 3.2 Add Vitest tests for `DocumentsView` Saved Views (creating, applying category/type/tag views, switching views, resetting to default, and persistence).
