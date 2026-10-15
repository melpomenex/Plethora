# Design

## Context

There are three related failures in the audiobook workflow:

1. `isNativeMobile()` checks the webview user agent before the Tauri OS plugin. A desktop `.app` can contain an iPhone/Android token in that user agent, causing transcription resolution to show mobile-only guidance.
2. `AudiobookEpubSyncView` resolves an audio URL and passes it to `AudiobookViewer` as `fileContent`. That bypasses the viewer's desktop `.m4b` preparation and makes the media element's duration/current-time contract unreliable in the paired view.
3. Groq has a per-request upload limit. The app has both a desktop FFmpeg chunker and a Rust audiobook command with a byte splitter. Container formats such as M4B must not be uploaded as arbitrary byte fragments, and no path may send a long source as one request.

The existing EPUB alignment system already has the important pieces: transcript-backed segments, cached alignment maps, a worker for alignment, word lookup, DOM highlighting, click-to-seek, and a segment-level fallback. The change should repair the media/transcription inputs and add coverage around the complete contract rather than replace that system.

## Goals

- Route native transcription from the authoritative native OS value; desktop cannot be classified as mobile by user-agent text.
- Give the audiobook viewer one owner for local media preparation, serving, duration, current time, seeking, and cleanup.
- Ensure Groq audiobook uploads are safely chunked, independently decodable, timestamp-adjusted, resumable where the existing Rust path supports checkpoints, and cleaned up after success or failure.
- Preserve word-level EPUB highlighting when alignment confidence and transcript timing support it, with the existing segment fallback when they do not.
- Add regression tests for the reported desktop warning, M4B playback lifecycle, Groq chunk boundaries/timestamps, and actual DOM word highlighting.

## Non-goals

- Adding another transcription provider or changing the Groq account limits.
- Replacing the EPUB renderer, alignment algorithm, or persisted transcript schema.
- Promising exact word timings when the selected provider returns only segment timings; synthesized word timing remains an explicitly approximate fallback.
- Migrating existing alignment cache records.

## Decisions

### 1. The native OS plugin is authoritative for native mobile

`nativePlatform()` is the source of truth for whether a Tauri runtime is Android or iOS. A user-agent string remains useful for browser/form-factor presentation, but it cannot grant native-mobile capability. Missing or unknown native OS metadata is treated as not-native-mobile, which keeps desktop and browser routing safe.

The alternative—checking the user agent first and then attempting to special-case desktop—cannot distinguish a desktop webview that intentionally uses a mobile user agent and is the direct cause of the reported warning.

### 2. The audiobook viewer owns the playback source lifecycle

The paired view loads EPUB bytes and alignment state, then mounts `AudiobookViewer` without overriding its audio source. `AudiobookViewer` remains responsible for:

- desktop M4B preparation to a range-capable playable file;
- local media-server URL resolution;
- mobile/browser source selection;
- media event handling and duration/current-time publication.

This avoids a source swap where a prepared MP3 is created after an already-playing M4B was selected, and avoids source precedence making the prepared source unreachable.

### 3. Groq uses safe, decodable chunks for long audiobooks

All local audiobook Groq paths use the existing server-side command on Tauri. Chunks are kept below a conservative limit, and containerized inputs are decoded/re-encoded into independently playable audio chunks when FFmpeg is available. The non-FFmpeg byte splitter remains suitable only for formats where byte boundaries are independently decodable (MP3 frame boundaries); it must not claim arbitrary M4B byte ranges are valid audio uploads. Each response is offset by its chunk start time before persistence, and temporary files are removed on both success and failure.

The browser path continues to reject oversized in-memory files with actionable guidance because it cannot safely access the local file for server-side chunking.

### 4. Duration publication accepts media metadata fallback

The viewer publishes a finite positive media duration from the HTML media element. If the webview reports zero/NaN/Infinity for an M4B while the backend has already parsed a valid duration, that parsed duration is used as a fallback for controls, seek bounds, parent sync callbacks, and persistence. A later finite media duration remains authoritative.

### 5. Follow-along remains confidence-aware

When a cached or newly computed alignment map meets the existing confidence threshold, the active aligned word drives EPUB highlighting and text-to-audio click navigation. When alignment is unavailable or below the threshold, the split view keeps segment-level synchronization and does not pretend that word precision is exact. Existing approximate timings synthesized from segment-only transcripts remain usable but are treated as approximate by the data path and tests.

## Risks and mitigations

- Re-encoding chunks costs CPU and temporary disk space. Use the existing app cache, emit progress, and remove the chunk directory in all exit paths.
- A missing FFmpeg runtime may prevent safe chunking of M4B for Groq. Return a clear actionable error rather than uploading arbitrary container slices.
- Metadata duration and media duration can differ slightly. Prefer a finite media duration once available and clamp seeking/progress to the resolved duration.
- Alignment quality depends on transcript quality and EPUB extraction. Retain cached maps, confidence gating, chapter fallback, and unit/integration coverage.
- Changing source ownership can affect tests that supplied `fileContent`. Update those tests to assert preparation and source resolution rather than preserving the bypass.

## Migration

No database or cache migration is required. Existing transcript rows, word timings, and alignment maps remain compatible. Temporary Groq chunk directories are disposable and are recreated per transcription attempt.

## Open questions

- Exact provider-generated word timestamps can be adopted later without changing the follow-along surface; this change only ensures the existing segment and synthesized-word paths are reliable.
