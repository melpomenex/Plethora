## Why

In the Documents Grid View, PDF files almost always render as an icon-on-gradient placeholder instead of showing their first page. The existing cover pipeline only extracts **embedded** raster images (JPEG/JPEG2000) that happen to live on the PDF's first page — it never *renders* the page. Most PDFs (academic papers, scanned documents, text/vector content) have no such embedded cover, so they fall through to the fallback and the library looks generic and hard to browse.

## What Changes

- Render the **first page** of a PDF to a bitmap (JPEG/PNG) when no embedded cover image is found, and use it as the document cover.
- Rendered covers flow through the **existing** cover pipeline unchanged: stored as a data URL in `cover_image_url`, tagged with a new `cover_image_source = "rendered"`, and displayed by the current `LibraryCard` / `CompactDocumentTile` components.
- Re-resolve PDFs that were previously marked `"fallback"` so existing libraries pick up rendered covers without manual intervention.
- No DB schema or UI component changes — the display layer, persistence, and lazy-resolution trigger already consume any non-null `coverImageUrl`.

## Capabilities

### New Capabilities
- `pdf-cover-rendering`: Extracting a PDF cover image by **rendering** the first page to a bitmap when no embedded cover image is present, producing a data URL consumable by the document cover pipeline.

### Modified Capabilities
<!-- None. No existing spec capability covers document covers/thumbnails. -->

## Impact

- **Code:**
  - `src-tauri/src/processor/pdf.rs` — `extract_pdf_cover_data_url` gains a render-first-page fallback path.
  - `src-tauri/src/commands/document.rs` — `resolve_cover_for_document` tags rendered PDFs with source `"rendered"` (currently uses `"embedded"`).
  - `src/components/documents/DocumentsView.tsx` — lazy-resolution `useEffect` guard so previously-`"fallback"` PDFs are re-resolved once.
- **Dependencies:** A Rust PDF **rendering** crate must be added to `src-tauri/Cargo.toml` (no renderer exists today; only `lopdf` for structural parsing and `pdf-extract` for text). Candidate: `pdfium-render` (bundles native pdfium). *Alternative under consideration:* no new Rust dep, render client-side via the already-installed `pdfjs-dist` (see design.md).
- **Platforms:** pdfium native binaries affect desktop (macOS/Windows/Linux) and Android packaging; this must be validated during implementation.
- **Storage:** No schema change; rendered covers persist as base64 data URLs in the existing `cover_image_url` column, same as EPUB/YouTube covers.
