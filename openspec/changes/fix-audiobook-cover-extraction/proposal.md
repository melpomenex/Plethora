## Why

When a user imports an Audiobook, the cover image is never extracted at import time, and tapping the document in the Documents view never recovers a cover on mobile (and only sometimes on desktop via ffmpeg). The root cause is twofold: the unified cover-resolution path (`resolve_cover_for_document`) has no `FileType::Audio` branch, so audiobooks are silently left with `cover_image_url = None` and marked `cover_image_source = "fallback"` — which also permanently disables any retry; and the one extractor that does exist (`extract_audio_cover_art`) shells out to a system `ffmpeg` that is not present on Android and optional on desktop. Audiobook covers must be readable natively in-process on every platform, especially mobile.

## What Changes

- Add a pure-Rust, ffmpeg-free audiobook cover extractor that reads embedded cover art from the common audiobook container formats (MP4/M4A/M4B APIC-style `covr` atoms, MP3 ID3 `APIC` frames, FLAC `METADATA_BLOCK_PICTURE`, OGG/Opus) and returns a `data:image/...;base64,...` URL.
- Wire a `FileType::Audio` arm into `resolve_cover_for_document` so audiobooks get their embedded cover extracted at import time on every platform, persisted via the existing `cover_image_url` / `cover_image_source` pipeline.
- Allow `FileType::Audio` to participate in the online fallback path (Anna Archive / Google Books) when no embedded art is found, matching how PDF/EPUB behave, instead of being stuck as `"fallback"` forever.
- Drop the `onMobile ? null : extractAudioCoverArt(...)` short-circuits in `AudiobookImportDialog` and `AudiobookViewer` so mobile uses the same in-process extraction path as desktop.
- Re-resolve existing audiobooks whose `cover_image_source` is `"fallback"` so already-imported libraries gain covers without re-importing.

## Capabilities

### New Capabilities
- `audiobook-cover-extraction`: Extract embedded cover art from audiobook files (MP4/M4B, MP3, FLAC, OGG/Opus) natively in Rust at import time, persist it through the document cover pipeline, and fall back to online lookup when no embedded art exists — working identically on desktop and Android without an external `ffmpeg` dependency.

### Modified Capabilities
None. (The related `pdf-cover-rendering` capability is unchanged; the cover pipeline it depends on gains an audio branch, but no spec-level requirement of `pdf-cover-rendering` changes.)

## Impact

- **Backend (Rust)**
  - `src-tauri/Cargo.toml`: add a pure-Rust audio metadata crate (e.g. `lofty`) for reading embedded cover art across MP4/ID3/FLAC/OGG.
  - `src-tauri/src/commands/document.rs`: extend `resolve_cover_for_document` with a `FileType::Audio` arm and include `FileType::Audio` in the online-fallback `matches!` list.
  - New helper (e.g. `src-tauri/src/processor/audio.rs` or `commands/audiobook.rs`): `extract_audio_cover_data_url(path) -> Option<(String, String)>` returning a data URL + MIME, mirroring `extract_epub_cover_data_url` / `extract_pdf_cover_data_url`.
  - The existing ffmpeg-based `extract_audio_cover_art` command stays available for desktop-only flows but is no longer the primary path; `prepare_audiobook_playback` / `parse_audiobook_metadata` are out of scope here (they still depend on ffmpeg on desktop and are tracked separately).
- **Frontend (TypeScript/React)**
  - `src/components/import/AudiobookImportDialog.tsx`: remove the `onMobile ? Promise.resolve(null)` guards around `extractAudioCoverArt`.
  - `src/components/viewer/AudiobookViewer.tsx`: rely on the persisted `coverImageUrl` from import; keep the online lookup as a secondary fallback only when no embedded art was stored.
  - `src/components/documents/DocumentsView.tsx`: no change required — the existing fallback-retry logic already re-resolves `"fallback"` docs once the backend returns a real cover; the audio arm in `resolve_cover_for_document` makes that path succeed.
- **Android**
  - No new permissions required. Audio files are already staged into app-private storage by the folder-import plugin before `import_from_path` runs, so the new extractor reads them via the same absolute path used today.
  - No ffmpeg sidecar needed for covers.
- **Existing data**
  - Users who already imported audiobooks will see covers appear lazily as the grid re-resolves `"fallback"` entries; no migration is required because the re-resolve path already exists for PDF/EPUB.
