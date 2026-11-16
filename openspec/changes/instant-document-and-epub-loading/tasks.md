## 1. Backend Entry-Level EPUB Streaming

- [x] 1.1 Add an in-memory token-to-canonical-path registry and bounded `ZipArchive` cache in `src-tauri/src/epub_server.rs`, and update `get_epub_stream_url` to validate the ZIP signature, register the path without copying into `epub-mirror`, and return `http://127.0.0.1:<port>/epub-entries/<token>/`; verify with `cargo test --lib epub_server`.
- [x] 1.2 Implement `GET /epub-entries/<token>/<*entry_path>` in `src-tauri/src/epub_server.rs` with path-traversal rejection, URL decoding, extension-based `Content-Type` headers, and `Cache-Control` headers, keeping legacy `/epub` and `/epub/book.epub` routes intact; verify with unit tests covering `META-INF/container.xml`, `.opf`, `.xhtml`, CSS/image assets, 404 missing entry, 403/404 invalid token, and `..` traversal rejection.

## 2. Frontend Directory-Mode EPUB & Non-Blocking Startup

- [x] 2.1 Update `src/components/viewer/EPUBViewer.tsx` to open `/epub-entries/` URLs with `{ openAs: "directory" }` (preserving `{ openAs: "epub" }` for legacy URLs and `ArrayBuffer` fallback), and verify existing `EPUBViewer` Vitest suites pass plus a new test case for directory-mode opening.
- [x] 2.2 Remove `await epubBook.loaded.navigation` from the critical path before `initializeRendition()` in `src/components/viewer/EPUBViewer.tsx`, resolving TOC concurrently; verify TOC still populates and renders without blocking initial display.
- [x] 2.3 Pass known `currentCfi` from `DocumentViewer` (and read `localStorage` synchronously) into `EPUBViewer.tsx` so `rendition.display()` starts immediately without waiting on a redundant `getDocumentAuto` IPC round-trip; verify saved position restores on open in tests.
- [x] 2.4 Persist and restore `epubBook.locations` JSON in `localStorage` (with safe quota handling) and defer uncached `epubBook.locations.generate()` until idle after initial display in `src/components/viewer/EPUBViewer.tsx`; verify cached restore skips `generate()` and uncached generation does not block first render.

## 3. Store-First Document Loading & Sync View Migration

- [x] 3.1 Update `src/components/viewer/DocumentViewer.tsx` to start `loadDocumentData` immediately from the already-present `useDocumentStore` document when `filePath` (or `content`) is available, running `hydrateDocument` in parallel to refresh metadata; verify with Vitest and `npx tsc --noEmit`.
- [x] 3.2 Update `src/components/viewer/AudiobookEpubSyncView.tsx` to use `documentsApi.getEpubStreamUrl` instead of `documentsApi.readDocumentFile` for EPUBs; verify `npx tsc --noEmit` and `npm run build` pass.

## 4. Verification

- [x] 4.1 Run `cargo test --lib epub_server`, `npx tsc --noEmit`, and `vitest` on `EPUBViewer` and `DocumentViewer` test suites, confirming all pass with zero regressions.
