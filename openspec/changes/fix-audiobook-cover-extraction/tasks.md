## 1. Backend: in-process audio cover extractor

- [x] 1.1 Add the `lofty` crate to `src-tauri/Cargo.toml` (enable only the format features needed: `id3`, `mp4`, `flac`, `ogg`, `opus`/`vorbis`), and run `cargo update -p lofty` so the lockfile resolves.
- [x] 1.2 Create `src-tauri/src/processor/audio.rs` with `pub fn extract_audio_cover_data_url(path: &Path) -> Option<(String, String)>` returning `(data_url, mime)`. Use `lofty::probe::Probe::open(path).read()` and pull the first `ItemKey::CoverArt` / `Picture` entry; base64-encode the bytes via the existing `base64` dependency (or `STANDARD.encode`).
- [x] 1.3 If the embedded cover's longer edge exceeds the existing cap used by PDF/EPUB covers, downscale it with the already-vendored `image` crate before encoding; otherwise pass the bytes through unchanged. Match whatever dimension cap is currently in use so audio covers are consistent with PDF/EPUB.
- [x] 1.4 Register the new module in `src-tauri/src/processor/mod.rs` (and `lib.rs` / `main.rs` if processor is re-exported there).
- [x] 1.5 Ensure any per-file parse failure is logged at `warn` and returns `None` — never panics. Verify with a malformed/truncated audio fixture.

## 2. Backend: wire audio into the shared cover resolver

- [x] 2.1 In `src-tauri/src/commands/document.rs::resolve_cover_for_document`, add a `FileType::Audio` arm that calls `processor::audio::extract_audio_cover_data_url(&doc.file_path)` and, on success, returns `(Some(data_url), Some("embedded".to_string()))`.
- [x] 2.2 Add `FileType::Audio` to the online-fallback `matches!` list (~line 120 of `document.rs`) so audio docs without embedded art participate in the Anna Archive / Google-Books lookup, returning `cover_image_source = "online"` on success.
- [x] 2.3 Re-point the existing `extract_audio_cover_art` Tauri command (`commands/audiobook.rs:415`) to call the new in-process extractor (or wrap it) so existing frontend callers keep working without ffmpeg. Keep the ffmpeg-only transcode/chapter logic untouched.
- [x] 2.4 Confirm `import_from_path` (document.rs:279) and `resolve_document_cover` (document.rs:705) now produce non-`None` covers for audio via the shared resolver — no changes needed at those call sites beyond the arm added in 2.1.

## 3. Frontend: drop mobile short-circuits and rely on persisted cover

- [x] 3.1 In `src/components/import/AudiobookImportDialog.tsx`, remove the `onMobile ? Promise.resolve(null) : ...` guards at the four `extractAudioCoverArt` call sites (lines ~214, 317, 393, 462) so mobile invokes the extractor identically to desktop.
- [x] 3.2 In `src/components/viewer/AudiobookViewer.tsx`, keep the `extractAudioCoverArt` fallback (line ~400) but ensure it is no longer gated on platform; the persisted `coverImageUrl` from import remains the primary source.
- [x] 3.3 Confirm `getDocumentCoverUrl` in `src/components/documents/DocumentsView.tsx` (line ~115) already returns `doc.coverImageUrl` for audio docs — no change needed, just verify.

## 4. Frontend: re-resolve `"fallback"` audiobooks on grid load

- [x] 4.1 In `src/components/documents/DocumentsView.tsx`, relax the `if (doc.coverImageSource === "fallback") return false;` guard (line ~388) so that audio docs with `"fallback"` source are retried once per grid load.
- [x] 4.2 Ensure the retry is bounded: once the backend persists a non-`fallback` source for a given audio doc, the existing guard short-circuits future loads (no change needed beyond 4.1, just verify the persisted value flows back through `applyCoverUpdate`).

## 5. Verification

- [x] 5.1 `cargo check` the `src-tauri` crate on the default (desktop) target; fix any compilation errors from the lofty integration.
- [x] 5.2 Build the Android APK via the `android-build` skill to confirm `lofty` compiles for `aarch64-linux-android` and the APK size delta is acceptable.
- [ ] 5.3 Manual test (desktop): import an `.m4b` and an `.mp3` with embedded cover art; confirm the cover appears in the grid and in `AudiobookViewer` without ffmpeg installed.
- [ ] 5.4 Manual test (Android): import the same `.m4b`/`.mp3` via the mobile import flow; confirm the cover appears in the grid immediately and persists across app restarts.
- [ ] 5.5 Manual test (Android): open an already-imported audiobook that previously showed no cover (`coverImageSource = "fallback"`); confirm the grid re-resolves and the cover appears on next load.
- [ ] 5.6 Manual test (regression): import an audiobook with no embedded cover; confirm the online fallback is attempted and the doc is marked `"fallback"` (no crash, import completes).
