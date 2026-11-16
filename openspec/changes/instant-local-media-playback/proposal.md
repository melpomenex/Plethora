## Why

Loading local media files such as full-length movies (e.g., 4K MKV Blu-ray rips with bitmap subtitles or DTS/AC3 audio) currently triggers an upfront whole-file `ffmpeg` remux or transcode into `app_cache_dir/media_compat` before a single frame can play. For large movies, this blocks playback for minutes, duplicates tens of gigabytes of disk space, hits the 25 GB compatibility cache limit (`cache_limit_too_small`) or triggers LRU eviction, and forces users to sit through the same conversion again whenever a file is evicted or a new movie is opened.

## What Changes

- **On-the-fly streaming playback instead of upfront full-file conversion**: Replace blocking whole-file disk remux/transcode jobs with an on-demand local streaming pipeline in `media_server` that remuxes or transcodes only the active playback/seek window on the fly (via HLS segments / fragmented MP4) so playback begins immediately without waiting for or storing a full-file copy on disk.
- **Instant seek and segment-windowed FFmpeg execution**: Generate a virtual playlist from `ffprobe` duration/stream metadata and spawn/reuse `ffmpeg` for the requested time window when playing or seeking, cleaning up idle processes and ephemeral segment buffers automatically.
- **Non-blocking compatibility planning & removal of artificial cache-size blocks**: Update `media_compat::decision` and `useMediaCompatibility` so `Remux`, `AudioTranscode`, and `VideoTranscode` strategies route to the live streaming endpoint immediately rather than blocking on `MediaCompatibilityPanel` progress or failing with `cache_limit_too_small` for large movies.
- **Keep native direct playback when supported**: Preserve zero-overhead native `<video>` playback for already-compatible files, and attempt direct playback before falling back to live streaming when compatibility is only indeterminate.

## Capabilities

### New Capabilities
- `local-media-streaming-playback`: On-demand, seekable local media streaming (remux, audio transcode, and video transcode) served over the loopback `media_server` without upfront whole-file conversion or persistent full-file disk duplication.

### Modified Capabilities
<!-- None in openspec/specs/ — media-compatibility/local-media-playback specs are in an unarchived change. -->

## Impact

- **Backend (`src-tauri/src/media_server.rs`, `src-tauri/src/media_compat/`)**: Add live HLS/fMP4 streaming routes and on-demand `ffmpeg` segment/process management; update `decision.rs`, `commands.rs`, and `jobs.rs` to return streaming playback plans without requiring full-file cache materialization or enforcing `cache_limit_gb` against streamed media.
- **Frontend (`src/hooks/useMediaCompatibility.ts`, `src/components/viewer/LocalVideoPlayer.tsx`, `src/components/viewer/MediaCompatibilityPanel.tsx`)**: Connect `LocalVideoPlayer` to the live streaming URL (using `hls.js` where native HLS is unavailable, e.g., WebKitGTK/WebView2, and native `<video>` HLS on WKWebView) and remove the blocking full-file preparation screen for streamable media.
- **Dependencies**: Potential addition of `hls.js` in `package.json` for cross-platform MSE HLS playback in WebKitGTK/WebView2.
