## 1. Confirm the diagnosis

- [x] 1.1 Verify from source that the desktop path uses `convertFileSrc`/`asset://` while `tauri.conf.json` declares no `app.security.assetProtocol` block and no capability enables the asset scope (diagnosis confirmed from code; devtools capture pending manual run)
- [x] 1.2 Check `localStorage["audiobook-<id>"].multiPart.partFiles` holds raw file paths (written by `AudiobookImportDialog` as `partFiles: selectedFiles`, the OS picker paths — not previously-resolved URLs)

## 2. Backend: media server authorization

- [x] 2.1 Add a grant set (`Arc<Mutex<HashSet<PathBuf>>>`) to `MediaServerState` in `src-tauri/src/media_server.rs`, with a `ponytail:` comment noting it grows per session
- [x] 2.2 Make `stream_handler` accept a canonical path that is under an allowed root **or** present in the grant set; keep the existing 403/404/416 behaviour otherwise
- [x] 2.3 Extend `get_media_stream_url` to take `State<Repository>`, and authorize a path outside the app roots when it matches the `file_path` of a registered document; insert the canonical path into the grant set on success
- [x] 2.4 Return a clear error string (not a bare HTTP code) when authorization fails, so the frontend can surface it
- [x] 2.5 Update `lib.rs` command registration if the signature change requires it (no change needed: command name and args are unchanged; `tauri::State<Repository>` is auto-injected — verified by `cargo check`)

## 3. Frontend: single resolution path

- [x] 3.1 In `src/components/viewer/localMediaSource.ts`, replace the desktop `tauri-asset` branch (including the Linux/WebKitGTK special case) with `get_media_stream_url`, so any `isTauri()` runtime uses `local-media-server`
- [x] 3.2 Keep the remote/`data:` passthrough, the `browser-file://` object-URL branch, and `backend-blob` as the last resort
- [x] 3.3 In `src/components/viewer/AudiobookViewer.tsx`, make `resolvePlaybackUrl()` call `get_media_stream_url` on all Tauri platforms and remove the now-dead `convertFileSrc` import (also replaced the two podcast `convertFileSrc` calls)
- [x] 3.4 Preserve the mobile carve-out that skips the `.m4b` ffmpeg transcode, and keep resolving the transcoded path on desktop
- [x] 3.5 Set `playbackError` (not just a cleared source) when source preparation throws, so the existing error UI + retry render instead of an idle player
- [x] 3.6 Fix the diagnostic calls that hardcode `strategy: "tauri-asset"` to report the strategy actually used

## 4. Tests

- [x] 4.1 `media_server.rs`: unit test that a granted path outside the app roots streams, and that an ungranted path outside the roots returns 403
- [x] 4.2 `media_server.rs`: unit test for a path containing spaces and non-ASCII characters, round-tripping through URL encoding
- [x] 4.3 `src/components/viewer/__tests__/localMediaSource.test.ts`: desktop resolution returns a `http://127.0.0.1:` source with strategy `local-media-server`, and never an `asset:` URL
- [x] 4.4 `src/components/viewer/__tests__/AudiobookViewer.test.tsx`: a failing source resolution surfaces `playbackError` rather than leaving the player idle
- [x] 4.5 Run `npm test` and `cargo test -p <crate> media_server` and confirm no regressions in the existing audiobook/podcast tests (`npx vitest run`: 2275 passed / 320 files; `cargo test --lib`: 535 passed incl. media_server 9 + epub_server 9)

## 5. Manual verification

- [ ] 5.1 Import an `.mp3` audiobook from a path outside the app data directory, press play, and confirm the position advances
- [ ] 5.2 Import a large `.m4b`, confirm the transcode path plays and that seeking mid-file works (Range requests visible in the network panel)
- [ ] 5.3 Confirm podcasts, multi-part audiobooks, and the EPUB sync view still play
- [ ] 5.4 Delete/move a source file and confirm a visible error with a working retry, not a silent stall
- [ ] 5.5 Re-run on mobile (or Android emulator) to confirm the shared path did not regress mobile playback
