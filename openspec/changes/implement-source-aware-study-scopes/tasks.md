## 1. Backend Schema & Evidence Persistence Fixes
- [x] 1.1 Add SQLite migration `166_study_mode_session_scope_key` in `src-tauri/src/database/migrations.rs` adding `scope_key` column and index to `study_mode_sessions`.
- [x] 1.2 Update `src-tauri/src/models/study_mode.rs`, `src-tauri/src/database/study_mode_repository.rs`, and `src-tauri/src/commands/study_mode.rs` to persist and look up sessions by `scope_key` (with backward-compatible fallback for legacy rows).
- [x] 1.3 Fix `submit_formative_answer` in `src-tauri/src/database/study_mode_repository.rs` to insert valid `practice-check` records matching migration 143's `learning_evidence` schema, and add Rust unit tests asserting `evidence_recorded == true` and FSRS non-mutation.

## 2. Frontend Source Scope Resolution & Bounded Context
- [x] 2.1 Implement `src/lib/study-plans/studyMode/sourceScopeResolver.ts` to derive available scopes, default scope, bounded evidence text (within token/char budget), and canonical `ExactSearchHitLocation` for EPUB, PDF, HTML, Markdown, Plain Text, YouTube, Video, Audio, and Study Plan assignments.
- [x] 2.2 Make `buildStudyScopeKey` in `src/lib/study-plans/studyMode/scopeKey.ts` revision-independent (keeping `sourceRevision` as its own column/field) and trigger staleness marking when `sourceRevision` changes.
- [x] 2.3 Add an unobtrusive scope selector to the Study Mode header showing active scope label, coverage indicator, and only valid options for the current source.

## 3. Canonical Citation Navigation & Live Reader Bridge
- [x] 3.1 Pass live reader context (PDF text window/OCR, EPUB chapter/CFI, HTML/Markdown text, video/audio transcript + timestamp, `useDocumentOutlineStore` sections, and active `studyRequest`) from `DocumentViewerWrapper` / `DocumentViewer` into Study Mode.
- [x] 3.2 Wire `onJumpToSource(quote, locator)` to reveal `"with-source"` and dispatch canonical navigation into `DocumentViewer` across all supported formats, with explicit honest fallback if an anchor cannot be resolved.
- [x] 3.3 Wire `onPromoteFlashcard` from `DocumentViewer` into `StudyModeWorkspace` so explicit flashcard promotion opens Plethora's existing `FlashcardStudioModal`.
