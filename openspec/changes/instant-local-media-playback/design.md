## Context

Currently, `src-tauri/src/media_compat/` inspects local video files via `ffprobe` and, whenever `decision::plan` chooses `Remux`, `AudioTranscode`, or `VideoTranscode` (which happens for nearly every MKV with PGS bitmap subtitles on Linux or any DTS/TrueHD/HEVC-incompatible file), `jobs.rs` spawns `ffmpeg` to write a complete copy of the entire file into `app_cache_dir/media_compat/<hash>/output.{mkv,mp4}` before `LocalVideoPlayer.tsx` can start playback. See `proposal.md` for the resulting user-facing latency, disk bloat, and cache-eviction re-conversion issues.

## Goals / Non-Goals

**Goals:**
- Start local video playback in `< 2s` for `Remux` and `AudioTranscode` (and as soon as the first segment is ready for `VideoTranscode`) without writing a full-file copy to disk.
- Support random-access seeking across multi-hour 4K movies using windowed/segmented FFmpeg execution.
- Eliminate `cache_limit_too_small` failures and repeated re-conversions caused by LRU cache eviction on large movies.
- Preserve all existing `LocalVideoPlayer.tsx` web overlays (transcript sync, extracts, SponsorBlock, A-B loop, playback speed).

**Non-Goals:**
- Replacing the HTML5 `<video>` element with an embedded native `libmpv` window surface (which would require native window-compositing workarounds for React overlays, transcript panels, and cross-platform Android/macOS/Windows support).
- Supporting offline background pre-transcoding for mobile sync (existing `media_compat` offline jobs can remain available if explicitly invoked, or be deprecated).

## Decisions

### 1. On-Demand HLS (fMP4 / MPEG-TS) Streaming over `media_server`
- **Choice**: Serve a virtual VOD HLS playlist (`GET /media-stream/:sessionId/master.m3u8` and `GET /media-stream/:sessionId/seg/:index.ts` or `.m4s`) from the existing loopback Axum `media_server.rs`, backed by a small `StreamingSessionManager` that spawns `ffmpeg -ss <window_start> -i <source> ...` on demand.
- **Rationale**:
  - HTML5 `<video>` cannot seek natively into a single unbounded chunked HTTP response without range requests, and range requests cannot be satisfied on a live remux/transcode without knowing exact byte offsets up front.
  - HLS with fixed-duration virtual segments (e.g., 4–6 seconds per segment computed from `ffprobe` duration) gives `<video>` + `hls.js` an exact timeline and instant seeking to any segment index (`index * segmentDuration`).
  - When sequential segments are requested (`seg/0`, `seg/1`, `seg/2`, ...), a single persistent `ffmpeg` process for that playback cursor writes consecutive segments into a bounded in-memory / temp ring buffer (e.g., keeping only ±5 segments), so there is no per-segment `ffmpeg` startup overhead during normal playback. When the user seeks far ahead/back, the old `ffmpeg` process is killed and a new one starts at `-ss <seek_time> -noaccurate_seek` (fast keyframe seek) for the new window.
- **Alternatives considered**:
  - *Embedded `libmpv`*: Plays everything natively, but breaks HTML/React overlays, transcript karaoke/extracts, and introduces heavy native C/ABI packaging across Linux/macOS/Windows/Android.
  - *Single progressive fragmented MP4 stream*: Cannot seek to arbitrary future timestamps before FFmpeg reaches them.

### 2. Cross-Platform HLS Playback in `LocalVideoPlayer.tsx`
- **Choice**: Use `hls.js` (via MediaSource Extensions) when `video.canPlayType('application/vnd.apple.mpegurl')` is empty (Linux WebKitGTK, Windows WebView2), and native `<video src="...m3u8">` on platforms with native HLS (macOS WKWebView, iOS/Android).
- **Rationale**: `hls.js` is lightweight, battle-tested, and gives `LocalVideoPlayer.tsx` standard `HTMLVideoElement` events (`timeupdate`, `seeking`, `loadedmetadata`, `durationchange`, `ratechange`) with zero changes to transcript sync or extract capture.
- **Container format for segments**: MPEG-TS (`.ts`) for `H.264` + `AAC`, or fragmented MP4 (`.m4s` + `init.mp4`) when copying `HEVC` (`-c:v copy -tag:v hvc1`) since `hls.js` + MSE supports fMP4 HEVC where hardware/system decoders exist.

### 3. Decision & Policy Integration (`decision.rs`, `useMediaCompatibility.ts`)
- **Choice**:
  - Keep `PlaybackStrategy::Native` as the fast path whenever `video_ok && audio_ok && container_ok && subtitle_ok`.
  - When `Remux`, `AudioTranscode`, or `VideoTranscode` is selected, `planMediaPlayback` marks the plan as streamable (`deliveryMode: "stream"`) instead of requiring full-file cache materialization.
  - Bypass `floor > cache_limit` (`cache_limit_too_small`) for streamed plans.
  - In `useMediaCompatibility.ts`, for streamable `Remux` and `AudioTranscode` (and approved `VideoTranscode`), mint/start the `media_server` stream session immediately and transition straight to `ready` with the `.m3u8` URL—never showing the blocking `MediaCompatibilityPanel` progress modal.
  - Retain `consent` prompt only for `VideoTranscode` when `policy.mode === "ask"` or `automatic-inexpensive` + expensive 4K/HDR video transcode.

## Risks / Trade-offs

- **Keyframes & Seek Alignment**: `ffmpeg -ss <time>` before `-i` seeks to the nearest keyframe, which may differ slightly from `index * segmentDuration`. → Mitigation: Use `-copyts` / `-muxdelay 0` or align segment timestamps with `hls_time` + `-force_key_frames` (when transcoding) and `hls.js` PTS-based continuity so audio/video stay in sync across seeks.
- **Dolby Vision / DTS-HD MA in Webviews**: On Linux WebKitGTK, if the system GStreamer lacks an HEVC decoder or fails on Dolby Vision metadata, `Remux` alone will fail in MSE. → Mitigation: Keep `useMediaCompatibility` playback error recovery (`PlaybackRecoveryContext`) so if the streamed `Remux` triggers a decoder error on `<video>`, it seamlessly falls back to `VideoTranscode` (streamed H.264 + AAC) without losing the user's place.
- **Orphaned FFmpeg Processes**: If a tab closes abruptly, an `ffmpeg` worker could linger. → Mitigation: Tie each streaming session to a TTL/heartbeat + document/player unmount cleanup (`stop_media_stream_session`) and drop/kill all active workers on Tauri app exit.
