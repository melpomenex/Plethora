## Why

Opening `.epub` books (and other large documents) can take seconds of noticeable delay before the first page renders. Even after `stream-epub-resources` moved EPUB loading off IPC `readDocumentFile` onto the loopback HTTP server, `epubjs` with `openAs: "epub"` still fetches the entire `.epub` archive over HTTP into a single `ArrayBuffer` and parses the full ZIP in JavaScript via `JSZip`, while the backend synchronously copies out-of-root EPUBs into an `epub-mirror` cache on first open and `EPUBViewer` blocks or saturates the main thread with serial IPCs, eager TOC waits, and uncached `locations.generate()` across every spine item.

## What Changes

- **On-demand EPUB ZIP entry streaming (`epub_server.rs`)**: Add an unpacked-style entry-serving route (e.g. `GET /epub-entries/<token>/*entry_path`) backed by a bounded cache of parsed ZIP central directories in Rust, returning a directory base URL from `get_epub_stream_url` instead of mirroring and serving the whole `.epub` blob.
- **Directory-mode `epubjs` loading (`EPUBViewer.tsx`)**: Open `/epub-entries/` URLs with `openAs: "directory"` so `epubjs` fetches only `META-INF/container.xml`, the `.opf` package, navigation, and the active spine section + its assets on demand instead of downloading and unzipping the entire book in JS.
- **Non-blocking document & EPUB startup (`DocumentViewer.tsx`, `EPUBViewer.tsx`)**:
  - Start source resolution (`getEpubStreamUrl`, PDF range/stream setup, media resolution) immediately from the already-hydrated store document when `filePath` is present, rather than serializing behind `hydrateDocument`.
  - Pass known reading position (`currentCfi`) and `localStorage` fallback directly to `EPUBViewer` so `rendition.display()` does not block on a redundant `getDocumentAuto` IPC round-trip.
  - Stop awaiting `epubBook.loaded.navigation` before creating the rendition and calling `rendition.display()`.
  - Persist/restore `epubBook.locations` JSON (keyed by document ID and file signature) and defer uncached `locations.generate()` until idle after first paint so it does not fetch and parse every chapter during startup.
- **Remove remaining whole-file EPUB read (`AudiobookEpubSyncView.tsx`)**: Switch `AudiobookEpubSyncView` from `readDocumentFile` to `getEpubStreamUrl`.

## Capabilities

### New Capabilities
- `epub-entry-streaming`: Backend loopback HTTP serving of individual ZIP entries from `.epub` archives with MIME-type resolution, path-traversal protection, token-scoped access (eliminating whole-file `epub-mirror` copies), and cached central-directory lookup.
- `instant-document-loading`: Non-blocking document viewer startup pipeline covering store-first source resolution, parallel TOC/position loading, and cached/idle-deferred EPUB location indexing.

### Modified Capabilities
<!-- None: no existing openspec/specs/ requirements are changing. -->

## Impact

- **Backend (`src-tauri/src/epub_server.rs`, `src-tauri/src/media_server.rs`)**: New `/epub-entries/{token}/{*path}` route, in-memory token-to-path registry + cached `ZipArchive` / central-directory reader using the existing `zip` crate, MIME inference for XHTML/CSS/fonts/images/SVG/NCX/OPF, and removal of eager `std::fs::copy` mirroring on the primary path.
- **Frontend (`src/components/viewer/EPUBViewer.tsx`, `src/components/viewer/DocumentViewer.tsx`, `src/components/viewer/AudiobookEpubSyncView.tsx`, `src/api/documents.ts`)**: `openAs: "directory"` for entry-streamed URLs, non-blocking position/TOC/locations initialization, and store-first source resolution.
- **Compatibility**: Keep `/epub` and `/epub/book.epub` routes intact for any direct callers or fallback paths; web/PWA fallback (`fileData`) remains unchanged.
