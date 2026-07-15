## Context

The document cover pipeline is fully built and working for EPUB, YouTube, and Anna's Archive fallback. For PDFs, `extract_pdf_cover_data_url` (in `src-tauri/src/processor/pdf.rs`) uses `lopdf` to scan the first page for **embedded** raster images (DCTDecode/JPXDecode filters), picks the largest, and base64-encodes it as a `data:` URL. If none is found it returns `Ok(None)`.

The problem: typical PDFs (academic papers, text/vector documents, scanned pages with no full-page JPEG) have no embedded cover image. They fall through to Anna's Archive lookup, then to `cover_image_source = "fallback"` with a null URL. In the Grid View, `LibraryCard` then renders a red gradient + `TextT` icon placeholder. The library looks generic and these documents are hard to distinguish visually.

What is missing is a **render** step: rasterizing the PDF's first page to a bitmap when no embedded image exists. The surrounding plumbing — resolver (`resolve_cover_for_document`), Tauri command (`resolve_document_cover`), DB column (`cover_image_url`), lazy-resolution `useEffect`, and the `LibraryCard`/`CompactDocumentTile` display components — already consume any `data:` URL, so the change is narrowly scoped to producing the bitmap and (optionally) re-resolving previously-fallback PDFs.

Constraints:
- Targets desktop (macOS/Windows/Linux) **and** Android (Tauri mobile build is active in this repo).
- `lopdf` cannot render; it only parses structure. `pdf-extract` only extracts text. No renderer exists in Rust.
- `pdfjs-dist@^5.4.530` is already a frontend dependency and is actively used by `PDFViewer`/`PdfPageView` (worker setup + native range transport already solved in `nativePdfRangeTransport.ts`).

## Goals / Non-Goals

**Goals:**
- Show the first page of any PDF as its cover in the Grid View when no embedded cover exists.
- Reuse the existing cover pipeline (data URL → DB column → `getDocumentCoverUrl` → `LibraryCard`) with no schema or UI-component changes.
- Backfill existing libraries: PDFs previously resolved to `"fallback"` get rendered covers without manual user action.
- Work across desktop and Android.

**Non-Goals:**
- Rendering multi-page thumbnails, spines, or 3D book mockups.
- Changing how EPUB / YouTube / Anna's Archive covers are resolved.
- Adding a user setting to toggle cover rendering on/off (can be revisited if needed).
- Building a new thumbnail-on-disk cache subsystem; covers stay as data URLs in the existing column.

## Decisions

### Decision 1: Render PDF covers **frontend-side with `pdfjs-dist`**, not via a new Rust renderer

**Choice:** Implement the render path in the React layer using the already-installed `pdfjs-dist`, following the existing viewer's PDF.js worker + native range transport pattern. Produce a JPEG data URL via an offscreen `<canvas>`, then persist through the existing `resolve_document_cover` / `update_document_cover` path by sending the rendered data URL to a thin new Tauri command (or reusing the existing `update` command with `coverImageUrl` + `coverImageSource: "rendered"`).

**Alternatives considered:**

- **Option B (rejected): Add `pdfium-render` (or `mupdf`) to the Rust backend.** Pros: keeps cover generation server-side and consistent with the EPUB path; the resolver runs once and the result is cached in the DB for all clients. Cons:
  - pdfium is a native C++ library; `pdfium-render` pulls/bundles platform binaries. On **Android** this requires shipping the correct `libpdfium.so` ABI in the APK. This repo is actively building Android APKs (see `src-tauri/gen/android/`), and adding a native dependency that needs per-ABI `.so` bundling is a meaningful packaging + CI risk with no current precedent in the codebase.
  - Adds a heavy native dependency for a single feature.
  - Slower iteration (Rust compile + mobile rebuild) vs. a pure-frontend path that reuses infra already shipped and battle-tested in `PDFViewer`.

- **Option C (rejected): Ship the bitmap render in the frontend but never persist it.** Rejected because it would re-render on every Grid View mount (CPU + memory cost on a page that already does lazy resolution), and it breaks parity with how EPUB/YouTube covers are cached in the DB.

**Rationale:** `pdfjs-dist` is already a dependency, already proven in the viewer, already solves worker + byte fetching on this platform, and avoids any native-binary packaging risk on Android. The existing resolver/DB caching pattern is preserved by persisting the rendered data URL with source `"rendered"`.

### Decision 2: Render quality and format

- Render page 1 at a scale targeting a **~400px-wide** bitmap (cover tile is ~160–180px tall; 2x for retina). Cap at the page's native dimensions if smaller.
- Encode as **JPEG, quality ~0.7** (smaller than PNG for photo-like page content; covers are decorative). This keeps the stored data URL small (the column already holds base64 EPUB/YouTube covers, so size class is comparable).
- Guard against pathological PDFs: wrap in a timeout and fall back to the icon placeholder if rendering fails or takes too long.

### Decision 3: Re-resolve previously-`"fallback"` PDFs

The existing lazy resolver in `DocumentsView.tsx` (lines ~369–397) skips documents where `coverImageSource === "fallback"`. After this change, PDFs previously marked `"fallback"` would never be re-rendered. Approach: adjust the skip guard so PDFs with `fileType === "pdf"` and no `coverImageUrl` are re-resolved once with the new render path, then persist the result (so it only happens once per document).

## Risks / Trade-offs

- **[Memory/CPU in the browser]** Rendering many PDF first pages on Grid View mount could jank the UI. → Mitigation: the existing `useEffect` already processes visible docs and dedupes via `processedDocIdsRef`; render sequentially (not in parallel), at low scale, behind a timeout guard. Rendered result is cached to DB so subsequent loads hit the `coverImageUrl` fast path.
- **[Large data URLs in DB]** JPEG data URLs for dense pages could be tens of KB. → Mitigation: JPEG @ 0.7 + ~400px width keeps covers small; EPUB/YouTube covers already live in the same column at similar sizes.
- **[pdfjs worker loading on the Grid View]** The viewer already initializes the worker; Grid View must reuse the same setup rather than double-initializing. → Mitigation: reuse `nativePdfRangeTransport.ts` and the existing worker config utilities used by `PDFViewer`.
- **[Encrypted / malformed PDFs]** Some PDFs cannot be opened by pdfjs. → Mitigation: wrap render in try/catch; on failure, leave `coverImageSource = "fallback"` and show the icon placeholder (current behavior).
- **[Android] `pdfjs-dist` worker under Tauri's WebView.** The desktop viewer already runs there, but Grid View cover rendering is a new call site. → Mitigation: validate on Android during implementation; if the worker path differs, reuse the exact same initialization the viewer uses.
