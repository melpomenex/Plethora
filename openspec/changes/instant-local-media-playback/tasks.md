## 1. Backend Streaming Session & HLS Server

- [x] 1.1 Add `StreamingSessionManager` in `src-tauri/src/media_compat/streaming.rs` to manage on-demand HLS sessions, virtual VOD playlist generation from `ffprobe` duration, and bounded rolling segment buffers; verify with unit tests for playlist generation and segment index-to-timestamp mapping.
- [x] 1.2 Implement windowed `ffmpeg` worker spawning (copying video/audio for `Remux`, transcoding audio for `AudioTranscode`, or transcoding video+audio for `VideoTranscode` into MPEG-TS or fMP4 segments) with fast keyframe seeking on out-of-window seeks and process cleanup on session close or app exit; verify with an integration test remuxing a fixture MKV into playable HLS segments.
- [x] 1.3 Expose loopback HTTP routes in `src-tauri/src/media_server.rs` (`GET /media-stream/:session_id/playlist.m3u8`, `GET /media-stream/:session_id/init.mp4`, `GET /media-stream/:session_id/seg/:index`) and Tauri commands (`start_media_stream_session`, `stop_media_stream_session`) in `src-tauri/src/media_compat/commands.rs`; verify `cargo check --manifest-path src-tauri/Cargo.toml` passes.

## 2. Compatibility Planning & Policy Updates

- [x] 2.1 Update `src-tauri/src/media_compat/types.rs` and `decision.rs` to mark `Remux`, `AudioTranscode`, and `VideoTranscode` plans as streamable (`deliveryMode: "stream"`) and bypass the `cache_limit_too_small` (`floor > cache_limit`) block for streamed plans; verify existing and new `decision.rs` unit tests pass with `cargo test --manifest-path src-tauri/Cargo.toml media_compat::decision`.
- [x] 2.2 Ensure `policy.mode == CompatibilityMode::Never` continues to return `can_convert = false` (direct native playback only) and `VideoTranscode` still respects `consent_reasons` when `Ask` or expensive 4K/HDR under `AutomaticInexpensive`; verify with `decision.rs` policy tests.

## 3. Frontend HLS Playback & Non-Blocking UX

- [x] 3.1 Add `hls.js` to `package.json` and create a small playback attachment helper in `src/lib/media/hlsPlayback.ts` that uses native HLS where supported (`canPlayType('application/vnd.apple.mpegurl')`) and `hls.js` MSE elsewhere, with clean teardown on unmount/source change; verify TypeScript compilation (`npx tsc --noEmit`).
- [x] 3.2 Update `src/api/mediaCompatibility.ts` and `src/hooks/useMediaCompatibility.ts` so streamable `Remux` and `AudioTranscode` (and consented `VideoTranscode`) plans call `start_media_stream_session` immediately and transition straight to `ready` with the `.m3u8` URL instead of starting a blocking full-file disk job; verify with `useMediaCompatibility` unit tests.
- [x] 3.3 Wire `LocalVideoPlayer.tsx` to attach HLS streams via `hlsPlayback.ts` and terminate the backend streaming session on unmount/document switch, while preserving playback error recovery fallback (`Remux` → `AudioTranscode` → `VideoTranscode`); verify `npm run test` media/viewer tests pass.

## 4. End-to-End Verification

- [ ] 4.1 Test opening a multi-gigabyte MKV movie with PGS bitmap subtitles and non-AAC audio in Plethora, confirming playback starts immediately without the "Preparing this video for playback" full-file progress overlay, seeking to arbitrary timestamps works, and `media_compat` disk cache does not duplicate the movie file.
