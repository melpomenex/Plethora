## 1. Backend: EPUB streaming server

- [x] 1.1 Decide module placement per design D2 (sibling `epub_server.rs` mounted on the same loopback listener, vs. new route inside `media_server.rs`). Document the choice in the module header comment.
- [x] 1.2 Create the EPUB server module: axum `Router` with `GET /epub?path=<encoded>`, sharing the existing `MEDIA_SERVER_PORT` `OnceCell`/listener lifecycle from `media_server.rs` (do not spawn a second listener).
- [x] 1.3 Implement the `/epub` handler mirroring `media_server::stream_handler` (`media_server.rs:221`): canonicalize path, enforce containment in `app_data_dir` / `app_cache_dir`, parse `Range:` header, respond with `200` (full stream) or `206 Partial Content` (`Content-Range`, `ReaderStream` of the byte range).
- [x] 1.4 Reuse the existing helpers `canonical_path_within_roots`, `parse_range`, `response_with_body`, and `set_common_headers` — extract or `pub(crate)` them as needed so both servers share one implementation. Set EPUB `Content-Type` to `application/epub+zip`.
- [x] 1.5 Add structured tracing logs matching the `[audiobook.media_request]` pattern (e.g. `[epub.resource_request]`) covering 200/206/403/404/416/500 with file label, range, and elapsed_ms.
- [x] 1.6 Add `#[tauri::command] pub async fn get_epub_stream_url(app_handle, file_path) -> Result<String, String>` mirroring `get_media_stream_url` (`media_server.rs:344`); returns `http://127.0.0.1:<port>/epub?path=<encoded>` and starts the server on first call.
- [x] 1.7 Register `get_epub_stream_url` in the `tauri::generate_handler!` list (likely `src-tauri/src/lib.rs`) next to `get_media_stream_url`.

## 2. Frontend: switch EPUB load path to URL

- [x] 2.1 Add `getEpubStreamUrl(filePath: string): Promise<string>` wrapper in `src/api/documents.ts` next to `readDocumentFile`, invoking `get_epub_stream_url`.
- [x] 2.2 In `DocumentViewer.tsx` load path (lines 1838–1902): for `inferredType === "epub"`, call `getEpubStreamUrl(doc.filePath)` and `setEpubUrl(url)` instead of `readDocumentFile` + `setFileData`. Leave `fileData` null on this path; stop allocating `new Uint8Array(rawBytes)` for EPUBs.
- [x] 2.3 Confirm `EPUBViewer.tsx:793` already prefers `fileUrl` when set (`ePub(fileUrl ? fileUrl : …)`); adjust only if needed so `fileUrl` takes precedence over any leftover `fileData`.
- [x] 2.4 Audit other whole-file EPUB callers and confirm they do NOT need to switch (per design, the viewer is the only target): `AudiobookEpubSyncView.tsx:82`, `documentImport.ts:202/232/351/444`, `fileSyncRegistration.ts:115/253/381/511`. Document the audit conclusion in the change README or a code comment.
- [x] 2.5 Add explicit error handling in the viewer: if `getEpubStreamUrl` rejects or `EPUBViewer` fails to load, show a named error state (not an indefinite spinner).

## 3. Backend: defensive size guard on `read_document_file`

- [x] 3.1 Add a desktop size cap to `read_document_file` (`document.rs:1173`), structurally identical to the Android guard at line 1192, gated to non-mobile (`#[cfg(not(target_os = "android"))]` unless iOS also needs it — verify).
- [x] 3.2 Choose the desktop threshold (default proposal: 256 MiB) per design D4; add a named const `MAX_DESKTOP_INLINED_BYTES` with a comment explaining the backstop purpose.
- [x] 3.3 Return a descriptive `IncrementumError::Internal` naming the size and pointing to the streaming path, mirroring the Android error text.

## 4. Config: CSP and capabilities

- [x] 4.1 Verify `tauri.conf.json` CSP `connect-src` / `media-src` allows `http://127.0.0.1:*` (already required by `media_server`); broaden if needed and document why.
- [x] 4.2 Add `get_epub_stream_url` to `src-tauri/capabilities/default.json` permission grants.

## 5. Validation

- [ ] 5.1 Repro test: confirm the 26 MB and 84 MB EPUBs that previously failed now open on macOS, Windows, and Linux (WebKitGTK explicitly — this is the platform that originally forced the whole-file path).
- [ ] 5.2 Memory measurement: capture peak webview memory during EPUB open before/after on the 84 MB repro file; confirm the previous ceiling is no longer crossed. Record numbers in the change README.
- [ ] 5.3 epubjs fetch trace: in devtools, confirm whether epubjs issues HTTP `Range` requests or fetches the whole file; record findings. If it fetches whole-file over HTTP, note that we still win (no IPC, no double JS copy) and open the follow-up to patch epubjs's loader per design Open Questions.
- [ ] 5.4 Regression: navigation, TOC, selection/highlighting, and audiobook–EPUB sync behave identically on a normal-sized EPUB.
- [ ] 5.5 Regression: archive export/import (`collectionArchive.ts`), app-state export (`appStateExport.ts`), and file-sync registration round-trip an EPUB successfully (these still use `read_document_file`; verify the new desktop guard doesn't reject legitimately large books).
- [ ] 5.6 Regression: PDF and audiobook paths are unaffected (same listener, additional route).

## 6. Wrap-up

- [x] 6.1 Update or add code comments referencing the now-populated `epubUrl` slot and the design's WebKitGTK-XHR rationale (`DocumentViewer.tsx:1867-1884` is now partly historical — refresh it).
- [x] 6.2 Note (do not fix) the latent base64-vs-bytes bug in `collectionArchive.ts:107` / `appStateExport.ts:274` in the change README so it can be tracked separately.
- [x] 6.3 Run the full existing test suite; add a unit test for the `/epub` route covering 200, 206, 403, 404, and 416, mirroring the `media_server` test shape at the bottom of `media_server.rs`.
