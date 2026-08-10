## Why

Imported audiobooks do not play on desktop: the user presses play, the position never advances, and no error is shown. The desktop playback source is built with `convertFileSrc()` (`src/components/viewer/AudiobookViewer.tsx:565`), which produces an `asset://localhost/...` URL — but `src-tauri/tauri.conf.json` declares **no** `app.security.assetProtocol` block, so the asset protocol is disabled (Tauri 2 defaults `enable` to `false`) and its scope is empty. Every desktop request for that URL is refused, the `<audio>` element never reaches a playable state, and `play()` silently does nothing.

The existing fallbacks do not rescue it: `resolveLocalMediaSource()` retries the same dead `asset:` strategy, then reads the entire file over IPC (`read_document_file`) into a blob and probes it with an 8s timeout — for a multi-hundred-megabyte `.m4b` this stalls or fails, which is exactly the "nothing happens" symptom.

Meanwhile the app already ships a correct, Range-capable local streaming server (`src-tauri/src/media_server.rs`, `get_media_stream_url`) that is used on Android only. Reusing it on desktop fixes the bug and removes the asset-protocol dependency entirely.

## What Changes

- Desktop local audio/video playback resolves through the existing loopback media server (`get_media_stream_url`) instead of `convertFileSrc()`. One playback path for desktop and mobile; the `tauri-asset` strategy is removed from the media resolution ladder.
- The media server authorizes files imported **in place**. Desktop import (`import_document`) stores the user's original path (e.g. `~/Downloads/book.m4b`) without copying, but `allowed_media_roots()` only permits `app_data_dir` and `app_cache_dir`, so those files would be rejected with 403. `get_media_stream_url` gains an authorization path for files registered as documents in the repository, and grants the stream handler access to exactly those canonical paths.
- Playback failures become visible instead of silent. A source that cannot be resolved surfaces the existing `playbackError` UI with the reason, rather than leaving the player in an indefinite idle state.
- The whole-file `backend-blob` fallback stays as a last resort but is no longer on the normal desktop path.
- `media-src`/CSP needs no change: both the production and dev CSP already allow `http://127.0.0.1:*`.

## Capabilities

### New Capabilities
- `local-media-playback`: How locally stored audio and video files are resolved into a playable browser source across desktop, mobile, and web, including authorization of the file paths that may be streamed and how resolution failures are reported to the user.

### Modified Capabilities

(none — no existing spec covers local media source resolution)

## Impact

- `src/components/viewer/AudiobookViewer.tsx` — `resolvePlaybackUrl()` and the source-preparation effect.
- `src/components/viewer/localMediaSource.ts` — resolution ladder; `tauri-asset` strategy removed for local paths, remote/`data:` URLs and the browser `File` path unchanged.
- `src-tauri/src/media_server.rs` — `get_media_stream_url` authorization, `MediaServerState` grant set consulted by `stream_handler`.
- `src-tauri/tauri.conf.json` — no asset-protocol block is added; the config stays as-is deliberately, and the CSP `asset:` entries become dead but harmless.
- Tests: `src/components/viewer/__tests__/localMediaSource.test.ts`, `src/components/viewer/__tests__/AudiobookViewer.test.tsx`, and the `media_server.rs` unit tests.
- Behavioural side effect: large audiobooks stream by HTTP Range instead of being buffered whole, so first-play latency and memory use drop on desktop as well as mobile.
