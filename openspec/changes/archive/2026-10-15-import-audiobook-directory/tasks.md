## 1. Backend & Types Parity

- [x] 1.1 Add optional `title: Option<String>` to `MultipartPartInput` in `src-tauri/src/commands/multipart_audiobook.rs` and update `build_sections` to prioritize user-specified chapter titles.
- [x] 1.2 Update TypeScript interfaces `MultipartPartInput` and `MultipartImportOptions` in `src/api/audiobooks.ts` to support chapter titles.
- [x] 1.3 Add Rust unit tests in `src-tauri/src/commands/multipart_audiobook.rs` verifying title priority (user title > tag title > filename > default).

## 2. Discovery & Semantic Import Planning

- [x] 2.1 Extend `src/utils/audiobookMultipart.ts` and `src/utils/audiobookImportPlanner.ts` to recognize common directory naming conventions (track-numbered files, chapter prefixes, disc subdirectories) as candidate multi-part audiobooks.
- [x] 2.2 Implement chapter title derivation utility that extracts clean chapter titles from metadata or filenames while preserving numbering context.
- [x] 2.3 Add unit tests in `src/utils/__tests__/audiobookImportPlanner.test.ts` and `src/utils/__tests__/audiobookMultipart.test.ts` covering directory import planning and chapter title extraction.

## 3. Audiobook Import Dialog & Chapter Management UI

- [x] 3.1 Update `src/components/import/AudiobookImportDialog.tsx` directory picker to treat picked folders as unified audiobooks with full chapter lists by default.
- [x] 3.2 Add an explicit segmented mode toggle (`Combine as Single Audiobook` vs `Import as Separate Files`) when multiple audio files or directories are selected.
- [x] 3.3 Implement an interactive Chapter Review section in `AudiobookImportDialog.tsx` displaying track index, editable chapter title input, individual/cumulative duration, reordering, and track removal.
- [x] 3.4 Wire the reviewed and edited chapters to `importMultipartAudiobook`, passing custom titles and active file selections to the backend.
- [x] 3.5 Populate `AudiobookChapter[]` with calculated start times, end times, and durations in the persisted `localStorage` entry upon import completion.

## 4. Playback Integration & Verification

- [x] 4.1 Verify seamless playback, chapter jumping, and progress persistence across combined tracks in `AudiobookViewer.tsx`.
- [x] 4.2 Add unit and component tests for `AudiobookImportDialog.tsx` verifying multi-file directory combine flow, chapter editing, and mode switching.
- [x] 4.3 Run benchmark and test suite (`npm run test:scripts`, `npm test`) to ensure regressions and bundle budgets remain intact.
