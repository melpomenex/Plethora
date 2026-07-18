## Context

Incrementum imports audiobooks as `FileType::Audio` documents and stores a cover the same way it does for PDFs and EPUBs: a `cover_image_url` (a `data:image/...;base64,...` URL) plus a `cover_image_source` discriminator (`"embedded"`, `"rendered"`, `"online"`, `"fallback"`). A single backend function, `resolve_cover_for_document` (`src-tauri/src/commands/document.rs:86`), is responsible for resolving a cover at import time (`import_from_path`, line 279) and lazily from the Documents grid (`resolve_document_cover`, line 705).

Today that function has arms for `Pdf`, `Epub`, and `Youtube`, plus an Anna-Archive online fallback gated by `matches!(doc.file_type, FileType::Pdf | FileType::Epub | FileType::Markdown | FileType::Html | FileType::Other)`. Audio falls through to `_ => {}` and returns `(None, None)`. Worse, `resolve_document_cover` then writes `cover_image_source = "fallback"`, and `DocumentsView.tsx:388` treats `"fallback"` as terminal — so once an audiobook has been imported, the grid never tries to recover a cover for it again.

The only audio cover extractor that exists today, `commands::audiobook::extract_audio_cover_art` (`audiobook.rs:415`), works by shelling out to a system `ffmpeg` (`-vcodec copy -f image2`). ffmpeg is not bundled on any platform (`tauri.conf.json` `externalBin` has no ffmpeg entry), and on Android `resolve_ffmpeg_path()` only checks Homebrew paths (`utils/ffmpeg.rs:33`) — so it is unreachable on mobile. The frontend knows this and hard-codes `onMobile ? Promise.resolve(null) : extractAudioCoverArt(...)` in four places in `AudiobookImportDialog.tsx`. Net effect: on Android, no audiobook ever gets an embedded cover at import, and on desktop it only works if the user happens to have ffmpeg installed via Homebrew.

Constraints:
- Audio files are already staged into app-private storage (`app_data_dir/imports/`) before `import_from_path` runs, so the backend reads them via a normal absolute path on every platform. No new Android permission is needed for cover extraction.
- The cover pipeline and DB schema already exist; only the audio arm is missing.
- `prepare_audiobook_playback` / `parse_audiobook_metadata` / `generate_audiobook_transcript` still depend on ffmpeg on desktop. Those are out of scope here — this change only fixes covers.

## Goals / Non-Goals

**Goals:**
- Audiobooks get an embedded cover at import time on **every** platform (macOS, Windows, Linux, Android), with no external binary requirement.
- Covers persist through the existing `cover_image_url` / `cover_image_source` pipeline, so the grid and the `AudiobookViewer` read them like any other doc type.
- Audiobooks without embedded art fall back to the same online lookup path used by PDF/EPUB.
- Already-imported audiobooks (`cover_image_source = "fallback"`) recover a cover on their next grid appearance without re-import.

**Non-Goals:**
- Removing the ffmpeg dependency from `prepare_audiobook_playback`, `parse_audiobook_metadata`, chapter parsing, or transcript generation. Those remain ffmpeg-on-desktop only and are tracked separately.
- Bundling an ffmpeg sidecar for Android. Not needed for covers.
- Changing the cover DB schema, the cover URL format, or the CSP (`img-src` already permits `data:` and `https:`).
- Extracting non-cover metadata (title/author/duration) via the new crate; that continues to flow through ffmetadata on desktop and the frontend's `createBasicMetadata` on mobile.

## Decisions

### Decision 1: Use a pure-Rust audio metadata crate (`lofty`) for cover extraction

**Choice:** Add `lofty` to `src-tauri/Cargo.toml` and implement `extract_audio_cover_data_url(path) -> Option<(String /* data url */, String /* mime */)>` in a new `src-tauri/src/processor/audio.rs`, mirroring the shape of `extract_epub_cover_data_url` (`processor/epub.rs:141`) and `extract_pdf_cover_data_url` (`processor/pdf.rs:176`).

**Why lofty over alternatives:**
- `lofty` covers MP4/M4A/M4B (`covr` atom), MP3 (ID3v2 `APIC`), FLAC (`METADATA_BLOCK_PICTURE`), and OGG/Opus in a single crate with one API (`Probe::open(path).read().cover_art()`). That maps directly onto the `AUDIOBOOK_FORMATS` list in `src/api/audiobooks.ts:73` (`mp3, m4b, m4a, aac, ogg, flac, opus, wav, wma`).
- Pure Rust, no native deps, builds cleanly for the `aarch64-linux-android` and Android targets — unlike the current ffmpeg-shell approach.
- Actively maintained, widely used in the Rust audio ecosystem.
- Alternatives considered:
  - `id3` + `mp4ameta` + `flac` — three crates to cover the same formats lofty covers alone; more glue code and more places for format-detection bugs.
  - `audiotags` — thinner wrapper, less control over raw cover bytes / MIME.
  - `symphonia` — overkill (full demuxer/decoder) when we only need the cover atom.
  - Keep shelling out to ffmpeg — rejected because it is the root cause of the Android failure.

### Decision 2: Wire the extractor into the shared cover resolver, not the import dialog

**Choice:** Add a `FileType::Audio` arm to `resolve_cover_for_document` that calls `processor::audio::extract_audio_cover_data_url`, returning `(Some(data_url), Some("embedded".to_string()))` on success. Add `FileType::Audio` to the online-fallback `matches!` list (line 120) so audio participates in the Anna Archive / Google-Books lookup when no embedded art exists.

**Why:** `resolve_cover_for_document` is the single chokepoint used by both `import_from_path` (import) and `resolve_document_cover` (lazy grid resolution). Putting the logic there means the import dialog, the grid, and the viewer all get correct behavior for free — no per-call-site changes. It also makes the lazy re-resolve of `"fallback"` audio docs (Decision 4) work without frontend changes.

**Alternative considered:** Call `extract_audio_cover_data_url` directly from `import_from_path`. Rejected — it would bypass the lazy resolver and leave already-imported audiobooks broken.

### Decision 3: Drop the `onMobile ? null : ...` guards in the frontend

**Choice:** In `AudiobookImportDialog.tsx` (lines 214, 317, 393, 462) and `AudiobookViewer.tsx` (line 400), remove the `onMobile` short-circuits so mobile uses the same `extractAudioCoverArt` invocation as desktop. Because the extractor is now ffmpeg-free, it succeeds on Android.

**Why:** The guards were a workaround for ffmpeg's absence on mobile; with the underlying problem fixed, the guard is just dead code that prevents mobile from extracting covers. The Tauri command `extract_audio_cover_art` will be re-pointed at the new `extract_audio_cover_data_url` (or kept as a thin wrapper around it) so existing callers keep working.

### Decision 4: Re-resolve `"fallback"` audiobooks on grid load

**Choice:** Rely on the existing re-resolve hook in `DocumentsView.tsx:376-451`. Today it bails on `coverImageSource === "fallback"` (line 388). We change that guard so that `"fallback"` audio docs are retried once, matching the behavior PDF/EPUB gained in the `pdf-cover-rendering` change. On success the backend writes a real `cover_image_url` + a non-`fallback` source, so subsequent loads short-circuit and the retry happens at most once per doc.

**Why:** Users with existing audiobook libraries should not have to re-import to see covers. The retry is bounded (one extra backend call per `"fallback"` audio doc per grid load until it succeeds), and the persisted result makes it amortize to zero.

**Alternative considered:** A one-shot migration that scans all audio docs and backfills covers. Rejected — it would block startup for large libraries and duplicate work the lazy resolver already does.

## Risks / Trade-offs

- **[Binary size / build time on Android]** Adding `lofty` grows the `aarch64-linux-android` `.so` slightly. → Mitigation: lofty is already lightweight (no decoder backends enabled); enable only the `mp4`, `id3`, `flac`, `ogg` features via cargo features to avoid pulling in parsers we don't need. Verify the Android APK still builds with the `android-build` skill before merging.
- **[Some audiobooks genuinely have no embedded cover]** e.g. MP3s ripped without `APIC`, or WAV (WAV has no standard cover frame). → Mitigation: the online fallback (Anna Archive / Google Books) handles these, and if both fail the doc is marked `"fallback"` as before — no regression versus today.
- **[lofty fails to parse a malformed file]** → Mitigation: `extract_audio_cover_data_url` returns `Option` and logs at warn level; the resolver falls through to the online path. A parse failure on one doc must not abort the import batch (wrap in per-doc error handling, same as PDF/EPUB).
- **[Large cover art inflates the DB]** M4B audiobooks sometimes embed 1000×1000+ JPEGs. → Mitigation: downscale covers above a threshold (e.g. max 512px on the long edge) before base64-encoding, reusing the existing `image` crate already in `Cargo.toml`. Keep this consistent with how PDF/EPUB covers are size-capped today.
- **[Behavior change for desktop users who relied on the ffmpeg path]** The ffmpeg-based `extract_audio_cover_art` command stays available, but the primary path is now in-process. → Mitigation: no observable difference for end users (same data URL output); the ffmpeg command simply becomes unused on the import path.

## Migration Plan

1. Ship the backend changes (lofty dep + `extract_audio_cover_data_url` + `resolve_cover_for_document` audio arm). No DB migration.
2. Ship the frontend changes (drop `onMobile` guards, relax the `"fallback"` retry guard for audio).
3. On next app launch, existing audiobooks with `cover_image_source = "fallback"` are retried lazily as the user scrolls the grid; each is resolved at most once and then persisted.
4. Rollback: revert both commits. Already-resolved covers remain in the DB (harmless); unresolved ones return to the icon placeholder. No data is lost.

## Open Questions

- Do we want to cap cover dimensions for audio specifically, or reuse whatever cap (if any) PDF/EPUB use today? (Leaning: reuse — keep one code path for resizing.)
- Should the online fallback for audio prefer Google Books (as the viewer does today via `searchAudiobookCover`) or Anna Archive (as the backend resolver uses for PDF/EPUB)? Initial lean: prefer Google Books for audio, Anna Archive for text — but this can be finalized during implementation.
