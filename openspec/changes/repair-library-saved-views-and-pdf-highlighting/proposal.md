# Change: Repair Library Saved Views and PDF Highlighting Alignment

Covers **BUG-11** (inaccurate PDF highlighting) and **BUG-13** (Library Saved Views do nothing).

## Why

1. **BUG-11 (PDF highlighting inaccurate):** `PdfPageViewWrapper` (`src/components/viewer/PdfPageView.tsx`) places `.pdf-highlight-overlay` inside `slotRef` (`[data-pdf-page]`) while PDF.js `.page` has `--page-margin: 1px auto -8px` and `--page-border: 9px solid transparent` under Tailwind `box-sizing: border-box`, creating a coordinate-origin offset; `PDFViewer.tsx` measures `slotRef` instead of `.page`'s content box; `HighlightLayer` / `SelectionOverlay` receive mutable `pageViewRef.current?.viewport` under `React.memo`, leaving them stale on mount and zoom; and `rotation` is omitted from `PdfPageViewWrapper` props.
2. **BUG-13 (Library Saved Views do nothing):** `SavedView` in `src/components/documents/DocumentsView.tsx` omits `selectedCategory`, `compactFilter`, and `captureSource`, so saving or applying a view like `"Finance"` never filters by category or resets stale filters, and manual filter changes leave `activeViewId` stale.

## What Changes

- **Exact PDF highlight & selection coordinate alignment (`BUG-11`):** Anchor `.pdf-highlight-overlay` to `.page`'s actual content box (or measure `.page` / `.textLayer` bounds consistently in `PDFViewer.tsx`), store `viewport` in reactive state inside `PdfPageViewWrapper` so `HighlightLayer` and `SelectionOverlay` re-render synchronously on mount, zoom, and rotation, and pass `rotation` to `PdfPageViewWrapper`.
- **Complete Library Saved Views (`BUG-13`):** Include `selectedCategory`, `compactFilter`, and `captureSource` in `SavedView`, `handleSaveView`, and `handleApplyView` (plus default-view reset); support renaming/updating/deleting Saved Views cleanly; and clear `activeViewId` when filters are manually modified.
