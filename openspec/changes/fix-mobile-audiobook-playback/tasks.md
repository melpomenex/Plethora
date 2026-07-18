## 1. Establish regression fixtures and observability contract

- [x] 1.1 Define shared audiobook diagnostic event names and redacted fields for import/staging, source resolution, media-server requests, and `<audio>` playback outcomes.
- [x] 1.2 Add deterministic local media fixtures/tests covering a small valid audio file, a large sparse or generated file, valid ranges, invalid ranges, and a missing path without storing copyrighted audiobook content.

## 2. Correct the Rust mobile media server

- [x] 2.1 Refactor `src-tauri/src/media_server.rs` so no-range requests stream the complete file with an accurate `Content-Length` instead of returning a capped prefix with a full-file length.
- [x] 2.2 Make range parsing and responses protocol-correct: return exact `206` bodies for valid ranges and `416` with `Content-Range: bytes */total` for malformed or unsatisfiable ranges.
- [x] 2.3 Validate requested files before URL generation/serving, preserve the existing `.m4b` → `audio/mp4` MIME mapping, keep the server loopback-only, and constrain access to app-managed media paths as appropriate for existing storage locations.
- [x] 2.4 Emit structured media-server diagnostics with redacted basename/document correlation, file size, range, status, and elapsed time; never log media bytes.
- [x] 2.5 Add Rust unit tests for status codes, headers, exact response lengths, MIME types, missing files, invalid ranges, and large-file bounded-memory behavior.

## 3. Make mobile source resolution and viewer state deterministic

- [x] 3.1 Update `resolveLocalMediaSource` and `DocumentViewer` to use the validated mobile stream source as the canonical local-audio source and avoid whole-file `readDocumentFile` fallback on native mobile.
- [x] 3.2 Update `AudiobookViewer` so mobile standard `.m4b` playback uses the resolved original stream source, skips desktop-only FFmpeg preparation on mobile, and only attempts a fallback after an actual media failure.
- [x] 3.3 Add bounded timeouts and explicit error propagation for mobile source resolution so a rejected or non-settling Tauri command cannot leave the parent viewer in an indefinite loading state.
- [x] 3.4 Track `<audio>` `loadedmetadata`, `canplay`, `stalled`, and `error` outcomes; distinguish missing/unreadable source from unsupported codec; expose a retryable error UI and prevent repeated retries of the same failed source.
- [x] 3.5 Preserve existing playback position, chapter, transcript, multi-part, podcast, and desktop playback behavior while replacing only the mobile local-source path.

## 4. Add frontend regression coverage

- [x] 4.1 Add unit tests for mobile source resolution success, Tauri command rejection/timeout, missing-file errors, and the no-whole-file-buffering path.
- [x] 4.2 Add component tests for loading-to-player, loading-to-retryable-error, decoder-error, and successful-retry transitions in the audiobook viewer.
- [x] 4.3 Verify existing audiobook and podcast position/playback tests still pass; document any unrelated baseline `tsc` failures separately from this change.

## 5. Build and verify on Android

- [x] 5.1 Build a fresh ARM64-capable debug APK with the repository’s mobile custom-protocol command and confirm the APK contains the current frontend/Rust changes rather than the older installed debug package.
- [x] 5.2 Install the debug APK on the connected Android device, identify the active package/PID, and capture PID-filtered `adb logcat` before and during an audiobook reproduction.
- [ ] 5.3 Reproduce with a known-good standard AAC `.m4b`, a large `.m4b`, a non-M4B audio file, and the user’s failing file if available; record whether failure occurs during staging, URL generation, HTTP request, metadata load, or decoder startup.
- [x] 5.4 Confirm the correlated frontend/Rust events in PID-filtered logcat, including the resolved source URL strategy, media request status, and `<audio>` readiness events.
- [ ] 5.5 Run the final targeted Rust/frontend tests and repeat the Android playback matrix, confirming that standard M4B playback starts, large files do not trigger whole-file buffering, and unsupported files exit loading with an actionable error.
