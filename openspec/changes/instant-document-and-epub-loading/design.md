## Context

See `proposal.md` for motivation. Currently:
1. `src-tauri/src/epub_server.rs` exposes `GET /epub?path=…` and `GET /epub/book.epub?path=…`, and `mirror_epub_into_app_storage` synchronously copies any `.epub` outside `allowed_media_roots` into `app_cache_dir/incrementum/epub-mirror`.
2. `EPUBViewer.tsx` passes `ePub(fileUrl, { openAs: "epub" })`, which causes `epubjs`'s `Archive.openUrl` to download the entire `.epub` via `XMLHttpRequest` (`binary`) and pass it to `JSZip.loadAsync(data)` on the main JS thread.
3. `EPUBViewer.tsx` awaits `epubBook.loaded.navigation` and `loadReadingPosition()` (which unconditionally awaits `getDocumentAuto(documentId)`) before `rendition.display()`, and runs `epubBook.locations.generate()` uncached on every open (fetching and parsing every spine item).
4. `DocumentViewer.tsx` waits for `hydrateDocument(documentId)` before calling `loadDocumentData(fetched)`.
5. `AudiobookEpubSyncView.tsx` still calls `documentsApi.readDocumentFile` for EPUBs.

## Goals / Non-Goals

**Goals:**
- Reduce time-to-first-rendered-page for `.epub` documents (especially 10–100 MB+ books with images/fonts) from seconds to tens of milliseconds.
- Eliminate whole-file `.epub` copies (`mirror_epub_into_app_storage`), whole-file HTTP downloads, and JSZip full-archive parsing on the Tauri path.
- Eliminate redundant serial IPCs and uncached full-book location generation during document open.

**Non-Goals:**
- Replacing `epubjs` as the EPUB rendering engine.
- Changing web/PWA fallback behavior when Tauri backend commands are unavailable.
- Modifying how `.epub` files are exported/imported in collection archives (`collectionArchive.ts`).

## Decisions

### D1: Serve unpacked ZIP entries via `/epub-entries/{token}/{*entry_path}`
- **Decision**: Add `GET /epub-entries/{token}/{*entry_path}` to `epub_server::router()`, returning `http://127.0.0.1:{port}/epub-entries/{token}/` from `get_epub_stream_url`.
- **Rationale**: When `epubjs` is given a directory URL with `{ openAs: "directory" }`, `this.archived` is `false` and `epubjs` fetches only `META-INF/container.xml`, the `.opf` manifest, navigation, and the current spine item + its referenced assets via relative URL resolution. All relative paths (`../Styles/style.css`, `Images/cover.jpg`) resolve naturally against the `/epub-entries/{token}/` base URL by the browser/webview.
- **Alternative considered**: Patching `JSZip` / `epubjs` to issue HTTP `Range` requests against `/epub/book.epub`. Rejected because `JSZip` does not natively support lazy range-backed ZIP reading, and maintaining a custom `JSZip` fork/patch is fragile compared to Rust's `zip` crate serving individual entries directly.

### D2: Token-scoped in-memory registry instead of `epub-mirror` file copy
- **Decision**: `get_epub_stream_url` validates the file's ZIP signature, registers its canonical `PathBuf` in a `Mutex<HashMap<String, PathBuf>>` (or `RwLock`) keyed by a deterministic or random token (e.g., SHA/hash or UUID), and returns `/epub-entries/{token}/`.
- **Rationale**: `mirror_epub_into_app_storage` existed only because `?path=...` needed `canonical_path_within_roots` to prevent arbitrary local file reads by other local processes. An in-memory token registry only exposes files explicitly opened via the Tauri command `get_epub_stream_url`, avoiding synchronous `std::fs::copy` of 50–100 MB files on first open and saving disk space.
- **Keep legacy routes**: Retain `/epub` and `/epub/book.epub` routes for backward compatibility.

### D3: Bounded LRU cache of ZIP entry indexes / `ZipArchive` handles in `epub_server.rs`
- **Decision**: Cache an open `ZipArchive<BufReader<File>>` (or central-directory index + `File`) per token in a small bounded cache (e.g., 4–8 most recently used EPUBs) using `tokio::task::spawn_blocking` for file I/O and deflate decompression.
- **Rationale**: A chapter render issues 5–30 concurrent HTTP requests (XHTML, CSS, fonts, images). Re-parsing the ZIP central directory on every request would add unnecessary disk seeks, while keeping a small bounded cache makes entry lookups sub-millisecond without leaking file descriptors.
- **MIME types**: Infer `Content-Type` from entry extension (`xhtml`/`html` → `application/xhtml+xml` or `text/html; charset=utf-8`, `opf` → `application/oebps-package+xml`, `ncx` → `application/x-dtbncx+xml`, `xml` → `application/xml`, `css` → `text/css; charset=utf-8`, `js` → `application/javascript`, `svg` → `image/svg+xml`, `png`/`jpg`/`jpeg`/`webp`/`gif`, `woff`/`woff2`/`ttf`/`otf`).

### D4: Non-blocking `EPUBViewer` startup & cached `locations`
- **Decision**:
  1. Detect `/epub-entries/` URLs in `EPUBViewer.tsx` and pass `{ openAs: "directory" }` to `ePub(...)`.
  2. Do not `await epubBook.loaded.navigation` before `initializeRendition()`; attach a `.then(...)` handler to populate `toc` concurrently.
  3. Pass `savedCfi` / `currentCfi` from `DocumentViewer` (and check `localStorage` synchronously) so `rendition.display(displayTarget)` does not block on `getDocumentAuto(documentId)`.
  4. Cache `epubBook.locations.save()` in `localStorage` (keyed by `epub-locations:${documentId}:${locationChunkSize}`) and restore via `epubBook.locations.load(cached)` if present. When uncached, schedule `epubBook.locations.generate(locationChunkSize)` after initial display via `requestIdleCallback` / `setTimeout(..., 1500)`.
- **Alternative considered**: Generating locations on the Rust backend. Deferred because `epubjs` CFI generation depends on `epubjs`'s exact DOM/XML character-counting algorithm (`epubcfi.js`); caching `epubBook.locations.save()` preserves 100% CFI compatibility with zero risk of mismatch.

### D5: Store-first source resolution in `DocumentViewer.tsx` & `AudiobookEpubSyncView.tsx`
- **Decision**:
  1. In `DocumentViewer.tsx`, if `useDocumentStore.getState().documents` already has the target document with `filePath` (or `content`), kick off `loadDocumentData` immediately instead of waiting for `hydrateDocument(documentId)` to round-trip first, while still running `hydrateDocument` in parallel to refresh metadata.
  2. In `AudiobookEpubSyncView.tsx`, use `documentsApi.getEpubStreamUrl(epubDoc.filePath)` and pass `fileUrl` to `EPUBViewer` instead of `readDocumentFile`.

## Risks / Trade-offs

- **[Risk] `epubjs` URL resolution quirks in `directory` mode** → Mitigation: Ensure the base URL ends with a trailing slash (`http://127.0.0.1:{port}/epub-entries/{token}/`) and test with EPUBs that have nested `OEBPS/` / `OPS/` directories, relative `../` CSS/image links, and URL-encoded filenames (spaces, `#`, `?`). Strip leading `/` and normalize `.` segments in the Rust handler while rejecting `..` traversal.
- **[Risk] `localStorage` quota if `locations.save()` is large** → Mitigation: Wrap `localStorage.setItem` in `try/catch` (and cap or evict oldest `epub-locations:*` keys on `QuotaExceededError`).
- **[Risk] Concurrent `ZipArchive` access for the same token** → Mitigation: Either guard each cached archive with its own `Arc<tokio::sync::Mutex<...>>` (so different books don't block each other) or cache the immutable central-directory `(name -> (data_start, compressed_size, uncompressed_size, compression_method))` map and open/seek a `File` per request. Caching the central-directory metadata or a per-token `Mutex<ZipArchive<File>>` is simple and fast.
