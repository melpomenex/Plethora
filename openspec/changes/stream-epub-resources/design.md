## Context

EPUBs currently load as a single whole-file blob: `read_document_file` (`src-tauri/src/commands/document.rs:1173`) does `tokio::fs::read` on the entire file and returns it as one `tauri::ipc::Response`. The frontend (`DocumentViewer.tsx:1885`) wraps that in a `Uint8Array`, then `EPUBViewer.tsx:793` calls `ePub(fileData.slice().buffer)` — a second full copy — and epubjs/JSZip eagerly decompress the whole zip in the webview. For a 26 MB or 84 MB EPUB (which decompresses to 5–10× its size in HTML/CSS/images) the webview crosses its memory ceiling and the document fails to render.

This is the last whole-file holdout. PDFs already stream via `read_pdf_document_range` (bounded byte ranges) and audiobooks stream via the `media_server` HTTP Range server (`src-tauri/src/media_server.rs`). The `media_server` is the closest precedent and the architectural template for this change:

- axum `Router` bound to `127.0.0.1:0` (loopback, OS-assigned port)
- port stored in a `tokio::sync::OnceCell` (one server per process)
- path canonicalized and verified to live under `app_data_dir` / `app_cache_dir`
- full-response and `Range:` / `206 Partial Content` semantics
- a `#[tauri::command] get_media_stream_url(file_path) -> String` returning `http://127.0.0.1:<port>/stream?path=<encoded>`

The reason EPUB was left on the whole-file path is documented at `DocumentViewer.tsx:1867-1884`: epubjs uses `XMLHttpRequest` internally, which is blocked on the `asset://` protocol under WebKitGTK (Linux), and epubjs resolves zipped spine resources more reliably from an `ArrayBuffer` than from `convertFileSrc` URLs. Serving EPUB entries from our own `http://127.0.0.1` endpoint — not `asset://` — sidesteps the WebKitGTK XHR blocker while still giving epubjs a URL to load.

EPUBs are ZIP archives. epubjs/JSZip expect to fetch the ZIP itself (or its central-directory entries) by URL; they do not generally fetch individual spine entries by URL. The design therefore has to choose between two sub-approaches (decided below in **Decisions**): serve the whole ZIP via HTTP Range (letting JSZip fetch only the central directory + the entries it needs), or serve individual decompressed entries by name. The first mirrors exactly what `media_server` does for audio and is what epubjs's URL loader is built for.

## Goals / Non-Goals

**Goals:**
- Open EPUBs ≥ 26 MB and ≥ 84 MB reliably on desktop (macOS/Windows/Linux) without webview OOM or hang.
- Eliminate the double full-copy of EPUB bytes in JS on the streaming path.
- Reuse the proven `media_server` loopback-HTTP pattern rather than inventing a new transport.
- Preserve epubjs's existing rendering, navigation, selection, and audiobook-sync behavior — no API change to the reader.
- Verify the WebKitGTK (Linux) XHR blocker is gone under the new endpoint.
- Provide a clear, attributed error (not a silent hang) when an EPUB genuinely cannot be served.

**Non-Goals:**
- Replacing epubjs/JSZip with a different reader.
- Re-architecting `read_document_file` itself — it remains as the fallback for callers that legitimately need whole bytes (archive, app-state export, file sync). The viewer simply stops using it for EPUBs.
- Fixing the latent base64-vs-bytes bug in `collectionArchive.ts:107` / `appStateExport.ts:274`. That is related (same command) but tracked separately.
- OCR, search-indexing, or any other pipeline that consumes EPUB bytes — unaffected.
- Mobile-only shortcuts. The same HTTP path is used on all platforms; mobile benefits incidentally.

## Decisions

### D1 — Serve the EPUB ZIP via HTTP Range, do not pre-decompress entries

**Choice:** The new server streams the raw `.epub` file bytes with HTTP Range semantics, exactly like `media_server` streams audio. epubjs loads via `ePub("http://127.0.0.1:<port>/epub?path=<encoded>")`.

**Rationale:**
- epubjs's built-in URL loader uses `XMLHttpRequest` and is designed to fetch a whole ZIP by URL; JSZip reads the central directory at the end of the file via Range requests and only pulls the spine entries it actually needs. This is precisely the streaming behavior we want, for free.
- Mirrors `media_server` line-for-line (axum + `Range:` + `206 Partial Content` + `ReaderStream`), so the implementation surface is small and known-good.
- A "decompress-and-serve-individual-entries" alternative would require us to re-implement epubjs's loader contract (it expects a ZIP, not individual files) — significantly more work and fragile against future epubjs releases.

**Alternatives considered:**
- *Serve individual decompressed entries by name* — rejected: doesn't match epubjs's loader contract; would require monkey-patching epubjs.
- *Custom Tauri URI scheme (`epub://`)* — rejected: `tauri::asset::AssetResolver` and custom protocol registration bring their own permission/CSP surface on each platform; loopback HTTP is already proven in this codebase and works identically across macOS/Windows/Linux/Android.
- *Range-read primitive mirroring `read_pdf_document_range`* — rejected: would require a custom epubjs loader that knows how to ask for byte ranges of a ZIP; epubjs doesn't expose that seam cleanly. HTTP Range lets JSZip do it itself.

### D2 — Single shared server, route per resource kind

**Choice:** Extend the existing `media_server` axum app (or a sibling server module) with one new route: `GET /epub?path=<encoded>`. Reuse the same loopback listener, port, and OnceCell.

**Rationale:**
- One loopback port per process is already the established invariant (`media_server.rs:30` `MEDIA_SERVER_PORT`).
- Two servers means two ports, two lifecycles, two CSP entries. One server with two routes is simpler.
- The `allowed_media_roots` check (canonicalize + `starts_with` app_data/cache) applies unchanged to EPUB files — they live in the same directories.

**Open sub-decision:** add the route inside `media_server.rs` (rename conceptually to "local resource server") vs. new module `epub_server.rs` with its own router mounted on the same listener. Leaning toward **new module, same listener** to keep `media_server.rs` focused; resolve in tasks.

### D3 — Frontend switches EPUB load path to URL

**Choice:** In `DocumentViewer.tsx` load path (lines 1838–1902), for `inferredType === "epub"`:
- Call a new `getEpubResourceUrl(doc.filePath)` wrapper (mirroring `getMediaStreamUrl`).
- `setEpubUrl(url)` instead of `setFileData(bytes)`.
- `EPUBViewer` already accepts `fileUrl` and calls `ePub(fileUrl)` at line 793 — no change needed there beyond ensuring `fileUrl` is preferred when present.

**Rationale:**
- `epubUrl` state already exists and is wired through to `EPUBViewer` as `fileUrl`. The slot was reserved for exactly this; we're finally populating it.
- Removes both JS full-copies (`new Uint8Array(rawBytes)` and `.slice().buffer`) from the EPUB path.

### D4 — Defensive desktop size guard on `read_document_file`

**Choice:** Add a desktop-side size cap on `read_document_file` (`document.rs:1173`), structurally identical to the Android guard at line 1192, with a higher threshold appropriate for desktop webviews (e.g. 256 MiB). Above the cap, return a clear `IncrementumError` so any future caller that ignores the streaming path fails loudly instead of hanging the webview.

**Rationale:**
- This change moves the viewer off `read_document_file` for EPUBs, but the command is still called by `collectionArchive.ts`, `appStateExport.ts`, `documentImport.ts`, and `fileSyncRegistration.ts`. A desktop guard future-proofs against any of those accidentally receiving a multi-hundred-MB file.
- The threshold must be high enough not to regress existing archive/export flows for legitimately large books — TBD empirically, but ≥ 256 MiB.

**Note:** this is a backstop, not the primary fix. The primary fix is the streaming server.

### D5 — CSP and capabilities

**Choice:** Update `tauri.conf.json` CSP `connect-src` (and `media-src` if needed) to allow `http://127.0.0.1:*` so the webview may fetch from the loopback server. Add the new `get_epub_stream_url` command to `src-tauri/capabilities/default.json`.

**Rationale:**
- `media_server` already required the same allowance; verify it covers the new route (it should, since same origin/port), but confirm during implementation.

## Risks / Trade-offs

- **[epubjs may fetch more than the central directory]** Some epubjs versions/paths decompress eagerly despite the URL loader. → *Mitigation:* measure peak webview memory on the 26 MB and 84 MB repro files before/after; if the ceiling barely drops, fall back to D1-alternative (per-entry serving) which we've already designed.
- **[WebKitGTK regression]** The original reason EPUB was forced onto the whole-file path was WebKitGTK blocking XHR on `asset://`. Loopback HTTP should be unaffected, but Linux must be explicitly tested. → *Mitigation:* add an explicit Linux QA task; if it regresses, scope this change to non-Linux and keep the ArrayBuffer fallback behind a platform check.
- **[Loopback port / firewall prompts]** Some desktop firewalls prompt on first loopback bind by a new app. `media_server` already binds loopback for audio without reported issues; the same behavior applies. → *Mitigation:* no action expected; monitor user reports.
- **[Concurrent document tabs]** Multiple EPUB tabs all hit the same server. The server is stateless per-request (each request opens its own `File`), so this is safe; `media_server` already handles concurrency the same way.
- **[D4 threshold too low]** If the desktop guard at `read_document_file` is set too low, it could regress archive/export of legitimately large books. → *Mitigation:* set ≥ 256 MiB and add a task to verify archive/export round-trips on the repro files.
- **[Mobile incidental benefit may surface new bugs]** Mobile currently OOMs above 16 MiB and falls back; switching it to the same HTTP path may expose issues the backstop was masking. → *Mitigation:* keep the Android 16 MiB backstop in place as a tripwire during rollout; lift it in a follow-up once mobile streaming is verified.

## Migration Plan

1. Implement server + frontend switch behind no flag (the change is internal; behavior is "EPUB opens" where before it "didn't open").
2. Validate on the 26 MB and 84 MB repro files across macOS, Windows, Linux.
3. Validate archive export/import, app-state export, and file sync still work for EPUBs (they don't use the new path, but they use the command we're touching).
4. No data migration, no schema change, no user-visible config. Rollback = revert the PR; the `read_document_file` path still exists and the frontend can fall back to it.

## Open Questions

- **D2 sub-decision:** add the `/epub` route inside `media_server.rs` or as a sibling `epub_server.rs` mounted on the same listener? (Lean sibling module.)
- **D4 desktop threshold:** what's the right cap? Need to check the largest EPUB in any existing user library / test corpus; default proposal is 256 MiB.
- **Does epubjs's URL loader actually issue Range requests, or does it fetch the whole file over HTTP?** If the latter, we still win (no IPC copy, no double JS copy, and the server streams rather than materializes), but the win is smaller than hoped. Verify with a network/devtools trace during implementation; if needed, patch epubjs's loader to issue Range requests.
