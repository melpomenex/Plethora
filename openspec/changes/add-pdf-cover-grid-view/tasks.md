## 1. PDF cover render utility (frontend)

- [ ] 1.1 Create a new helper module (e.g. `src/lib/pdfCoverRender.ts`) that, given a document id/file path, opens the PDF with the already-installed `pdfjs-dist`, reusing the worker config and `nativePdfRangeTransport.ts` pattern used by `PDFViewer`/`PdfPageView`.
- [ ] 1.2 Render page 1 to an offscreen `<canvas>` at a scale targeting ~400px-wide output (2x the cover tile), capped to the page's native width if smaller.
- [ ] 1.3 Encode the canvas to a JPEG data URL at ~0.7 quality and return it; return `null` on any error.
- [ ] 1.4 Add a time-budget guard (abort + return `null` if rendering exceeds the budget) so slow/pathological PDFs cannot jank the Grid View.
- [ ] 1.5 Unit-test the helper (scale/width clamping, error path returns null, timeout path) with a small fixture PDF.

## 2. Persist rendered covers

- [ ] 2.1 Add a thin Tauri command (or reuse the existing document update command) to persist a cover data URL with `cover_image_source = "rendered"` for a given document id, writing through `update_document_cover` in `document_repository.rs`.
- [ ] 2.2 Register the new command in `src-tauri/src/lib.rs` handler list and add a typed wrapper in `src/api/documents.ts`.
- [ ] 2.3 Confirm the existing `resolve_document_cover` fast-path still returns immediately when `cover_image_url` is already set (rendered covers must not be re-rendered on later loads).

## 3. Wire render path into the Grid View

- [ ] 3.1 In `DocumentsView.tsx`, update the lazy-resolution `useEffect` (~lines 369–397) so that for PDF documents lacking a `coverImageUrl`, it calls the new render helper and persists the result.
- [ ] 3.2 Process rendered covers sequentially (not in parallel) and continue to de-dupe via `processedDocIdsRef` so each document renders at most once per mount.
- [ ] 3.3 On render failure or timeout, leave the document on the existing icon placeholder (do not throw or block the rest of the grid).

## 4. Re-resolve previously-fallback PDFs

- [ ] 4.1 Adjust the lazy-resolution skip guard so PDF documents with `fileType === "pdf"`, `coverImageSource === "fallback"`, and no `coverImageUrl` are re-resolved once via the render path.
- [ ] 4.2 Ensure the re-resolution persists the rendered cover (so it only happens once per document, then hits the fast path on subsequent loads).

## 5. Validation

- [ ] 5.1 Desktop: import a text/vector PDF (no embedded cover), confirm the Grid View shows the rendered first page; confirm EPUB/YouTube/existing-embedded-PDF covers are unchanged.
- [ ] 5.2 Desktop: confirm reloading the Grid View shows cached rendered covers without re-rendering.
- [ ] 5.3 Desktop: confirm an encrypted/corrupted PDF falls back to the icon placeholder and does not break the rest of the grid.
- [ ] 5.4 Android: confirm the `pdfjs-dist` worker initializes correctly in the Grid View context and a PDF cover renders on-device (reuse the exact worker setup the viewer uses).
- [ ] 5.5 Update or add relevant tests (Grid View cover resolution effect + the render helper) and run the test suite.
