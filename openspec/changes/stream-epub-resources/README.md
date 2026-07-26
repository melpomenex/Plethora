# stream-epub-resources

Implementation notes for the change that lets the viewer open EPUBs of arbitrary
size by streaming them from a backend loopback HTTP server instead of
materializing the whole file in webview memory.

See `proposal.md`, `design.md`, `specs/epub-resource-streaming/spec.md`, and
`tasks.md` for the planning artifacts.

## What shipped

- **New Rust module `src-tauri/src/epub_server.rs`** — `GET /epub?path=…` route
  merged onto the shared media-server loopback listener, with full HTTP Range
  (`206 Partial Content`) support. Mirrors `media_server::stream_handler`
  line-for-line; reuses the shared helpers (`canonical_path_within_roots`,
  `parse_range`, `response_with_body`, etc.).
- **New Tauri command `get_epub_stream_url`** — returns
  `http://127.0.0.1:<port>/epub?path=<encoded>`. Registered in
  `src-tauri/src/lib.rs` next to `get_media_stream_url`.
- **Frontend API wrapper `getEpubStreamUrl`** in `src/api/documents.ts`.
- **`DocumentViewer.tsx`** now routes EPUBs to `setEpubUrl(url)` and bypasses
  `readDocumentFile` + the `Uint8Array` / `.slice().buffer` copies entirely
  on the EPUB path. `EPUBViewer.tsx:793` already preferred `fileUrl`.
- **Desktop backstop** in `read_document_file`
  (`MAX_DESKTOP_INLINED_BYTES = 256 MiB`,
  `#[cfg(not(any(target_os = "android", target_os = "ios")))]`) so any future
  caller that ignores the streaming path fails loudly instead of hanging the
  webview.

## Decisions resolved during implementation

- **Task 1.1 / design D2** — sibling `epub_server.rs` module, route merged onto
  the same `MEDIA_SERVER_PORT` listener inside `media_server::start`. No second
  listener, no second port. Helpers shared by making them `pub(crate)`.
- **Task 2.3** — `EPUBViewer.tsx:793` already preferred `fileUrl`
  (`ePub(fileUrl ? fileUrl : …)`); no change needed beyond populating the slot
  upstream.
- **Task 4.1 (CSP)** — production `connect-src` and `media-src` already allow
  `http://127.0.0.1:*` (added previously for `media_server`). No CSP change
  required.
- **Task 4.2 (capabilities)** — `src-tauri/capabilities/default.json` only
  grants permissions for plugin commands. App-defined commands exposed via
  `tauri::generate_handler!` (like `get_media_stream_url`) don't need an entry.
  `get_epub_stream_url` follows the same pattern; no capability grant needed.

## Automated tests passing

- `cargo test --lib epub_server` — 6 tests: 200 (full stream),
  206 (range), 403 (path outside allowed roots), 404 (missing file),
  416 (invalid range), and large-file lazy-streaming (no eager read).
- `cargo test --lib media_server` — 6 tests, unchanged (no regression from
  making helpers `pub(crate)` and merging the epub route).
- `cargo check` — clean.
- `npx tsc --noEmit` — clean.
- `npm run build` — clean.

## Manual validation still required

These need the running app and the 26 MB / 84 MB repro files. Checklist:

- [ ] **5.1** 26 MB EPUB opens on macOS, Windows, Linux (WebKitGTK explicitly).
- [ ] **5.1** 84 MB EPUB opens on macOS, Windows, Linux.
- [ ] **5.2** Peak webview memory during 84 MB open is materially lower than
      before (record numbers here).
- [ ] **5.3** In devtools Network tab, observe whether epubjs issues HTTP
      `Range` requests or fetches the whole file over HTTP. Either way we win
      (no IPC, no double JS copy). If it fetches whole-file over HTTP, open a
      follow-up to patch epubjs's loader.
- [ ] **5.4** Navigation, TOC, selection/highlighting, audiobook–EPUB sync
      behave identically on a normal-sized EPUB.
- [ ] **5.5** Archive export/import, app-state export, file-sync registration
      round-trip an EPUB successfully (these still use `read_document_file`;
      verify the new desktop 256 MiB guard doesn't reject legitimately large
      books).
- [ ] **5.6** PDF and audiobook paths unaffected.

## Out-of-scope follow-ups (tracked here, not in this change)

- **`AudiobookEpubSyncView.tsx:82`** still reads the whole EPUB via
  `readDocumentFile` for the audiobook–EPUB sync view. Same size risk applies
  but it's a separate viewer; left for a follow-up. The new desktop 256 MiB
  backstop will at least make any failure here loud rather than silent.
- **Latent base64-vs-bytes bug** in `src/utils/collectionArchive.ts:107` and
  `src/utils/appStateExport.ts:274`: both still treat `read_document_file` as
  returning a base64 **string**, but the command was changed to return raw
  bytes. This corrupts archive export/import of EPUBs. Separate from the size
  issue but related (same command); track as its own change.
