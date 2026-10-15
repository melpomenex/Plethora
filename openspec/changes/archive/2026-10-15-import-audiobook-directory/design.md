## Context

Audiobooks frequently come as a collection of individual audio files (`.mp3`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.wav`) rather than a single monolithic container. Plethora has foundational multi-part audio support via Tauri's `import_multipart_audiobook` command and the `AudioEdition` / `AudioEditionSection` database schema. However, importing a folder or multi-file audio set through the UI presents significant UX and functional gaps:
1. `AudiobookImportDialog` relies on rigid regexes in `detectMultiPartAudiobook`; if filenames do not match these narrow patterns, it defaults to batch importing each track as a separate document.
2. There is no user-facing toggle or choice to explicitly combine files or directories into a single audiobook.
3. Users cannot review, edit chapter titles, reorder tracks, or exclude unwanted tracks before final import.
4. The backend `MultipartPartInput` does not accept user-specified chapter titles, meaning user edits would be ignored.
5. Cached localStorage records omit chapter definitions (`chapters: []`), forcing the viewer to rely solely on later async database queries.

## Goals / Non-Goals

**Goals:**
- Provide a first-class directory and multi-file import workflow in `AudiobookImportDialog` that combines tracks into a single unified audiobook document.
- Present an interactive chapter review interface showing track sequence, chapter titles, durations, and ordering, with support for renaming chapter titles, reordering, and excluding tracks.
- Parse tags (album, artist, track, disc, title) and folder names to infer book title, author, and chapter titles automatically.
- Extend the Rust backend command `import_multipart_audiobook` and TypeScript API to accept per-part title overrides.
- Ensure the audiobook viewer immediately reflects full chapter navigation, chapter timeline offsets, and seamless sequential playback across parts.
- Align folder drag-and-drop and document store directory imports to recognize single-audiobook directory structures.

**Non-Goals:**
- Re-encoding or physically concatenating audio files via ffmpeg into a single audio container file (the native Audio Edition section playlist architecture already provides gapless sequential playback without destructive re-encoding or battery drain).
- Manual waveform trimming or splitting a single monolithic audio file into multiple chapters.

## Decisions

### 1. Audio Edition Section Playlist Architecture
- **Decision**: Represent the combined audiobook as one `Document` backed by an `AudioEdition` with `AudioEditionSection` entries representing each physical file.
- **Rationale**: Re-encoding multi-hour audio files into a single `.m4b` using ffmpeg takes minutes, uses high CPU/memory, degrades lossy audio, and fails on mobile where ffmpeg is not bundled. The `AudioEdition` architecture is native, fast (atomic hardlink/symlink/copy staging), supports instant playback, and maps directly to chapter boundaries.
- **Alternatives Considered**: ffmpeg concatenation into one `.m4b` file. Rejected due to latency, resource overhead, and platform incompatibility.

### 2. Explicit Mode Switch & Smarter Discovery
- **Decision**: In `AudiobookImportDialog`, when a directory or multiple files are chosen, display an explicit segmented control: `[Combine as single book | Import as separate audiobooks]`. In the Audiobooks shelf context, defaulting to "Combine" when multiple files or a directory are selected.
- **Rationale**: Automated heuristics cannot guess every user's intent. While smart heuristics (album tag matches, folder structure, track number patterns) provide sensible defaults, giving the user explicit control guarantees they never accidentally flood their library with 50 loose tracks.

### 3. Interactive Chapter Review & Customization in Dialog
- **Decision**: Add a "Chapters" review step/section in `AudiobookImportDialog`. The UI lists all parts with:
  - Track / Chapter index
  - Editable chapter title (prefilled from embedded tag title or cleaned filename)
  - Track duration & running start time
  - Reorder handles / controls
  - Exclusion button (remove intro / promo track)
- **Rationale**: Audiobook tracks often have messy or missing metadata (e.g. "track01.mp3" vs "01 - Prologue"). Allowing quick inline editing produces a clean, high-quality library item without needing post-import metadata edits.

### 4. Backend Title Overrides in `MultipartPartInput`
- **Decision**: Extend `MultipartPartInput` in `src-tauri/src/commands/multipart_audiobook.rs` with an optional `title: Option<String>`. In `build_sections`, prioritize:
  1. User-supplied `part.input.title`
  2. Embedded probe tag `part.probe.title`
  3. Derived chapter title from filename (`chapter_title_from_file_name`)
  4. Fallback `"Chapter N"`
- **Rationale**: Ensures the backend persists the user's reviewed chapter titles directly to the SQLite `audio_edition_sections` table.

### 5. Unified Chapter Metadata Persistence
- **Decision**: Persist the full `AudiobookChapter[]` array (with `id`, `title`, `startTime`, `endTime`, `duration`) in `localStorage` under `audiobook-${doc.id}` upon import, in addition to the `AudioEditionSection` rows in SQLite.
- **Rationale**: Guarantees zero latency on initial viewer launch and backward compatibility for all components that read audiobook chapter metadata.

## Risks / Trade-offs

- **[Risk] Large directory scan latency with many files**
  → *Mitigation*: Run metadata probing asynchronously; display an interactive progress bar showing probe progress; allow the user to see chapters populate progressively.
- **[Risk] Inconsistent audio formats within a single audiobook (e.g. MP3 chapters mixed with M4A)**
  → *Mitigation*: The `AudioEditionSection` schema stores `audio_mime_type` per section; the player switches media sources cleanly between tracks.
- **[Risk] Out-of-order track filenames (e.g., `1.mp3`, `10.mp3`, `2.mp3`)**
  → *Mitigation*: Natural alphanumeric sorting (`naturalCompare`) combined with disc and track number tag extraction ensures proper numerical sequence (`1`, `2`, `10`).

## Migration Plan

- Non-breaking change: existing single-file imports and existing multi-part audiobooks remain untouched.
- `MultipartPartInput.title` is optional (`#[serde(default)]`), preserving compatibility with existing invocations.
