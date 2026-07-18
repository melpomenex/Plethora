## Context

Android imports use the in-repo folder-import plugin to copy selected files into app-private storage, so Rust can access a normal filesystem path without moving a large audiobook through JSON IPC. The viewer then resolves local audio through `get_media_stream_url`, which starts `src-tauri/src/media_server.rs` and serves the file over loopback with range support.

The current server is not a valid large-file response for every WebView request pattern: its no-range branch buffers only the first 4 MiB but advertises the complete file length. The current frontend also treats URL generation as success without probing the returned resource, and audio/source failures can be reported too late or leave the user with a generic loading surface. Desktop `.m4b` preparation still uses FFmpeg and is an independent compatibility path.

The workspace has a connected Pixel 9 Pro XL available through ADB, and PID-filtered logcat is readable. The installed release app has no captured audiobook reproduction in its recent logs; an older debuggable package is also installed. The implementation therefore needs a deterministic debug/reproduction procedure rather than relying on ad hoc blank logcat output.

## Goals / Non-Goals

**Goals:**

- Stream staged Android audiobooks with bounded memory and HTTP responses whose status, headers, and body agree.
- Make standard AAC-in-MP4/M4B files playable directly in the Android WebView without FFmpeg or whole-file base64 transfer.
- Fail fast and visibly when the file is missing, the stream cannot be opened, or the device cannot decode the audio format.
- Emit enough structured Rust and frontend diagnostics to distinguish import/staging, URL generation, HTTP serving, and media-decoder failures in `adb logcat`.
- Preserve the existing desktop FFmpeg preparation path and existing playback-position/transcript behavior.

**Non-Goals:**

- Replacing the audiobook player UI or redesigning chapters, transcripts, bookmarks, or system media controls.
- Adding a new audio codec implementation or bundling FFmpeg/Media3 in this change. Unsupported codecs must produce a clear error and telemetry; codec expansion can be a follow-up.
- Changing the document database schema or requiring users to re-import existing files.
- Solving audiobook cover extraction; that work is already represented by the separate `fix-audiobook-cover-extraction` change.

## Decisions

### 1. Keep app-private staging and use one canonical mobile stream URL

The Android picker/staging path remains the source of truth for local files. On native mobile, `resolveLocalMediaSource` and the audiobook viewer’s fallback use the loopback stream URL rather than `convertFileSrc` or `readDocumentFile`, avoiding Android WebView/Java-heap copies of large files. The viewer should prefer the already-resolved source passed by `DocumentViewer` and only invoke the fallback resolver after a real media failure, preventing competing source-resolution requests.

**Alternative considered:** Continue resolving M4B through `prepare_audiobook_playback`. Rejected for mobile because that command requires an FFmpeg sidecar that is not bundled on Android and can leave the player with no usable source.

### 2. Make the media server protocol-correct and bounded-memory

Refactor the handler so each response has matching body and headers:

- For a valid single range, return `206 Partial Content`, the exact returned byte count, `Content-Range`, `Accept-Ranges`, and the M4B MIME type.
- For a request without `Range`, stream the complete file from disk (or otherwise return the complete body) with `200` and the exact total length; never return a capped prefix with a full-file length.
- Return `416 Range Not Satisfiable` with `Content-Range: bytes */<total>` for malformed/out-of-bounds ranges instead of silently falling into the no-range path.
- Validate the file exists and is a regular readable file before generating a URL and log request status/range/size. Keep the endpoint loopback-only and restrict path access to app-managed media locations where the existing storage model permits it.

**Alternative considered:** Always return a 4 MiB `206` prefix for the first request. Rejected because a media client may request the full resource and expect a complete non-range response; a streaming body is simpler and interoperates with both request patterns without loading the file into memory.

### 3. Separate source resolution failure from codec failure

The frontend will track source-resolution and media-element states independently. Resolution failures (Tauri command rejection, missing path, invalid stream URL, timeout) will leave the loading state and render a retryable error with a concise cause. `<audio>` `error`, `loadedmetadata`, `canplay`, and `stalled` events will record the source strategy and native error code; a decoder failure will render an unsupported/unreadable format message instead of retrying indefinitely.

**Alternative considered:** Treat every error as a generic playback fallback. Rejected because fallback retries can repeat the same broken URL and hide whether the problem is path access, HTTP semantics, or codec support.

### 4. Use structured, privacy-conscious diagnostics

Add consistent event names/fields for `audiobook.import`, `audiobook.source_resolution`, `audiobook.media_request`, and `audiobook.playback`. Include document id, extension, basename or redacted path, file size, source strategy, HTTP status/range, media error code, and elapsed time. Do not log audio bytes, transcript content, or full user paths unnecessarily. Rust events use the existing Tauri log plugin; frontend events use the existing console-to-logcat bridge.

**Alternative considered:** Rely only on `eprintln!` and browser console output. Rejected because release APK diagnostics were previously reported as blank and those streams do not consistently identify the failing layer.

### 5. Verify in layers, then on the connected device

Add Rust tests for response status/body/header invariants and frontend tests for source-resolution/error transitions. Build the Android debug APK with the repository’s custom-protocol mobile command, install it on the connected device, reproduce with a known `.m4b`, and collect PID-filtered logcat plus WebView CDP output if needed. Also test a small M4B, a large M4B, a non-M4B audio file, missing-file behavior, and at least one unsupported/invalid media sample.

## Risks / Trade-offs

- **[Android WebView requests vary between devices]** → Implement both full-response and single-range semantics, test on the connected Pixel, and log every media request status/range.
- **[Some M4B files use codecs Android WebView cannot decode]** → Detect/report decoder failure explicitly and retain a follow-up path for native transcoding; do not present it as an import or loading hang.
- **[Loopback URL exposes an app-local file endpoint]** → Bind only to loopback, validate paths against app-managed storage, avoid arbitrary external network binding, and keep diagnostics redacted.
- **[A duplicate fallback could create object/source races]** → Make the resolved mobile stream source canonical and revoke/replace only owned blob URLs.
- **[Existing dirty audiobook cover changes overlap these files]** → Implement only the playback/source/logging portions and preserve unrelated working-tree edits.

## Migration Plan

No data migration is required. Existing document rows continue to point at their staged app-private paths. On upgrade, the first open uses the corrected stream endpoint; failed/partial playback cache files are not required on mobile because M4B playback uses the original staged file. Rollback is a code rollback; no database or file cleanup is needed.

## Open Questions

- Does the user’s failing `.m4b` contain AAC-LC in an MP4 container, or a codec such as ALAC that Android WebView cannot decode? The debug reproduction and media diagnostics should answer this before choosing any codec-expansion follow-up.
- Should the stream command return a typed descriptor (URL, MIME, byte size) instead of a string, or is server-side validation plus frontend diagnostics sufficient for this fix?
