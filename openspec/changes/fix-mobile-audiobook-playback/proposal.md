## Why

Imported `.m4b` files are successfully staged and added to the library on Android, but opening one can remain on a loading state and playback never starts. The mobile path recently moved large media away from the Tauri asset protocol, yet the current local HTTP server can return only a capped prefix while advertising the full file length, and source-resolution failures are not surfaced with enough context to diagnose them. This makes the failure indistinguishable from a hang and leaves no reliable way to tell whether staging, URL generation, range serving, or Android media decoding failed.

## What Changes

- Make the Android audiobook path end-to-end reliable for staged `.m4b` files: resolve a valid local source, serve it with correct HTTP body/range semantics, and hand it to the native WebView audio element without reading the whole book into JavaScript memory.
- Correct the local media server’s non-range and invalid-range responses so response status, `Content-Length`, `Content-Range`, and actual bytes agree for large files.
- Validate the requested file before returning a playback URL and preserve useful failure context when staging, source resolution, or playback preparation fails.
- Ensure the viewer transitions out of loading on every failure and presents a retryable, actionable error instead of leaving an indefinite spinner.
- Add structured Rust and frontend diagnostics for audiobook import, source resolution, media-server requests, and `<audio>` errors, with document id/path/size and request range details but without logging audio contents.
- Add automated coverage for server response semantics and frontend source/error state, plus a repeatable debug-APK/device verification flow using `adb logcat` and WebView inspection when a physical device is available.

## Capabilities

### New Capabilities

- `mobile-audiobook-playback`: Import, resolve, stream, play, and diagnose locally staged audiobooks on Android, including bounded-memory handling for large `.m4b` files and explicit failure states.

### Modified Capabilities

<!-- No existing source-level capability spec covers this end-to-end mobile playback contract. -->

## Impact

- Frontend: `AudiobookViewer`, `DocumentViewer`, `localMediaSource`, audiobook import/source-resolution error handling, and diagnostic logging.
- Rust: `media_server`, audiobook playback commands, Tauri command registration, and mobile logging.
- Android: debug APK build/install and `adb`/WebView verification; no new user-facing storage permission should be required because imports are already staged into app-private storage.
- Tests and tooling: media-server response tests, frontend regression tests, and documented on-device reproduction/log collection.
- Existing desktop FFmpeg preparation remains supported; the change should not require desktop audiobooks to be transcoded differently.
