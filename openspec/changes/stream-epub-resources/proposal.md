## Why

EPUB files above roughly 20–30 MB (confirmed: 26 MB and 84 MB both fail) cannot be opened in the viewer. The entire file is read into Rust memory, shipped across Tauri IPC as one binary payload, copied again in JS, then handed to epubjs/JSZip which decompresses the whole zip eagerly in the webview. There is no streaming, no range reads, and no desktop size cap — so peak webview memory crosses the ceiling and the document fails to render. PDFs and audiobooks already have streaming paths; EPUB is the last whole-file holdout, and the failure is user-facing (the book just won't open).

## What Changes

- Add a Rust-side EPUB resource server that serves individual spine/manifest entries from a `.epub` zip on demand, mirroring the existing `media_server` HTTP Range pattern used for audio (`src-tauri/src/lib.rs:1204`).
- Expose a custom URI scheme (e.g. `epub://` or an `http://asset.localhost`-style endpoint) so the webview can fetch EPUB resources via HTTP, letting epubjs load from a URL instead of a whole-file ArrayBuffer.
- Populate `epubUrl` in `DocumentViewer.tsx` (currently always `null` at line 1849) for EPUB documents, and load epubjs via `ePub(fileUrl)` instead of `ePub(fileData.slice().buffer)`.
- Resolve the previously documented blocker for the URL path (WebKitGTK XMLHttpRequest blocked on `asset://`, `DocumentViewer.tsx:1883`) by serving through the new endpoint rather than `convertFileSrc`.
- Remove the double full-copy of EPUB bytes in JS (`new Uint8Array(rawBytes)` + `.slice().buffer`) on the streaming path.
- Add a desktop size guard in `read_document_file` (`document.rs:1173`) as a defensive backstop, matching the Android-only 16 MiB guard at line 1192, so oversized files produce a clear error instead of a silent hang/OOM.
- Preserve the existing whole-file fallback path for callers that legitimately need full bytes (collection archive, app-state export, file-sync registration) — those are addressed separately as a latent base64 bug, not part of this change.

## Capabilities

### New Capabilities
- `epub-resource-streaming`: A backend service that serves individual entries from an EPUB zip over HTTP to the webview, enabling on-demand (streaming/range) loading of EPUB content instead of whole-file transfer.

### Modified Capabilities
<!-- No existing spec-level behavior changes; this change introduces the streaming capability.
     The viewer behavior (DocumentViewer/EPUBViewer) shifts from whole-file to URL loading,
     but that is an implementation detail of the new epub-resource-streaming capability. -->

## Impact

- **Backend (Rust)**: new module alongside `media_server` (likely `src-tauri/src/processor/epub_server.rs` or `src-tauri/src/epub_resource_server.rs`); reuses the `epub` / `zip` crates already in `Cargo.toml`. New Tauri command(s) to start/resolve an EPUB resource URL.
- **Frontend (TS/React)**: `src/components/viewer/DocumentViewer.tsx` EPUB load path (lines 1838–1902) switches to URL loading; `src/components/viewer/EPUBViewer.tsx:793` switches from `ePub(fileData.slice().buffer)` to `ePub(fileUrl)`. `src/api/documents.ts` gains an `getEpubResourceUrl` wrapper.
- **Tauri config**: possible `tauri.conf.json` CSP / protocol registration update for the new endpoint; capabilities file (`src-tauri/capabilities/default.json`) may need a permission grant for the new command.
- **Cross-platform**: must work on macOS (WebKit), Windows (WebView2), and Linux (WebKitGTK). The Linux XHR-on-`asset://` blocker that originally forced the whole-file path must be verified fixed by the new endpoint.
- **Mobile (Android/iOS)**: secondary beneficiary — same streaming path replaces the current whole-file load on mobile, removing the residual OOM risk that the 16 MiB backstop only partially mitigates.
- **Dependencies**: no new crates expected; `epub`, `zip`, and the existing HTTP server machinery used by `media_server` cover the needs.
- **Out of scope**: the latent base64-vs-bytes bug in `collectionArchive.ts:107` and `appStateExport.ts:274` is related but separate; it will be noted but not fixed by this change.
