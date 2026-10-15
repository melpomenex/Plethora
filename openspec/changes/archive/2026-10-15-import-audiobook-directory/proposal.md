## Why

Audiobooks are frequently distributed as a collection of audio files (such as `.mp3`, `.m4a`, `.aac`, `.flac`, or `.ogg`) organized in a folder or multi-disc subfolders, rather than a single monolithic `.m4b` container with embedded chapter markers. Currently in Plethora, importing a folder or multi-part audio files either fragments the book into dozens of separate library documents (one per file) or relies on fragile filename regexes that fail on common conventions (e.g., track numbers without book titles, disc folders like `CD 1/`, `01 - Chapter 1.mp3`). Users need a dedicated, reliable way to import an entire audio directory and combine all constituent tracks into a single audiobook document with accurate chapter titles, durations, and ordering.

## What Changes

- **Directory & Multi-File Combine Flow in Audiobook Dialog**:
  - Add explicit support for importing an entire directory or multiple audio files as a single combined audiobook in `AudiobookImportDialog`.
  - Provide a clear choice/toggle when multiple audio files or folders are picked: "Combine into Single Audiobook" (default for audiobooks) vs "Import as Separate Audiobooks".
- **Enhanced Chapter Discovery & Metadata Parsing**:
  - Automatically parse embedded audio metadata (ID3/MP4 tags: album as book title, artist/album artist as author, title as chapter name, track and disc numbers) and folder names.
  - Automatically compute chapter timeline offsets (`startTime`, `endTime`, `duration`) for all parts.
- **Interactive Chapter Review & Ordering**:
  - Add an interactive chapter review UI within the import dialog allowing users to inspect detected chapter titles, reorder tracks (by track/disc tags, natural sort, or manual reordering), edit chapter titles, and remove non-content files (e.g. preview tracks or audio promos).
- **Backend & Pipeline Chapter Preservation**:
  - Update `import_multipart_audiobook` and `MultipartPartInput` in the Tauri Rust backend to accept user-customized chapter titles and track sequences.
  - Store chapter metadata consistently in the `AudioEdition` sections and document storage so that `AudiobookViewer` immediately exposes full chapter navigation and sequential playback.
- **Automatic Fallback for Single-Book Directories**:
  - When importing a directory from the general documents view or drag-and-drop, recognize single-book directory structures (all audio files in a folder sharing an album or sequence) and plan them as a single combined audiobook rather than flooding the library with individual files.

## Capabilities

### New Capabilities
- `audiobook-directory-import`: Import directories and multi-file audio collections combined into a single unified audiobook document with chapter information, tag inspection, and interactive chapter review.

### Modified Capabilities
<!-- None -->

## Impact

- **UI Components**: `src/components/import/AudiobookImportDialog.tsx`, `src/components/tabs/AudiobooksTab.tsx`, and `src/components/viewer/AudiobookViewer.tsx`.
- **API & Store Logic**: `src/api/audiobooks.ts`, `src/utils/audiobookImportPlanner.ts`, `src/utils/audiobookMultipart.ts`, and `src/stores/documentStore.ts`.
- **Backend Rust Commands**: `src-tauri/src/commands/multipart_audiobook.rs` (`MultipartPartInput`, `import_multipart_audiobook`, and section creation).
- **Data Models**: `AudioEditionSection` titles and `AudiobookChapter` metadata persistence.
