## 1. Backend & API Foundation (Resumable Sessions & Safe Artifact Lifecycle)

- [x] 1.1 Add `find_session_by_scope`, `restore_artifact`, and `delete_artifact` to `StudyModeRepository` (`src-tauri/src/database/study_mode_repository.rs`) and expose Tauri commands `find_study_mode_session_by_scope`, `restore_study_mode_artifact`, and `delete_study_mode_artifact` in `src-tauri/src/commands/study_mode.rs` and `src-tauri/src/lib.rs`.
- [x] 1.2 Update `src/types/studyMode.ts` and `src/api/study-mode.ts` with the 4-tab `StudyModeViewTab` union (`learn | practice | explore | progress`), `StudySourceAnchor`, `StudyModeSessionSnapshot`, `normalizeStudyModeTab`, and wrappers for `findStudyModeSessionByScope`, `restoreStudyModeArtifact`, and `deleteStudyModeArtifact` (with resilient non-Tauri local storage support).

## 2. Core Study Mode Grounding, Scope, Session & Task Modules

- [x] 2.1 Implement precision scope keys in `src/lib/study-plans/studyMode/scopeKey.ts` supporting document, selection, media timestamp/segment, plan topic/segment, and `sourceRevision`.
- [x] 2.2 Implement Reading Trails-compatible source anchoring in `src/lib/study-plans/studyMode/anchoring.ts` to extract and resolve `StudySourceAnchor[]` from generated payloads and active `ExactSearchHitLocation`.
- [x] 2.3 Implement resumable session persistence in `src/lib/study-plans/studyMode/sessionPersistence.ts` restoring active tab, objective/step, active question, session duration (`5 | 15 | 30`), focus mode, pane widths, and last locator without resetting to `learn`.
- [x] 2.4 Implement independent, cancellable per-task execution hook `useStudyTaskController` in `src/lib/study-plans/studyMode/taskController.ts` with `AbortController` and `onChunk` streaming progress.

## 3. Unified 4-Tab, 3-Pane Source-Centric Workspace UI

- [x] 3.1 Build `OriginalSourcePane` (`src/components/viewer/study-mode/OriginalSourcePane.tsx`) with always-accessible source passage, active anchor highlight/jump, selection-based "Study this" action, and "Focus in Reader" link.
- [x] 3.2 Build `LearningPathPane` (`src/components/viewer/study-mode/LearningPathPane.tsx`) with collapsible section/objective navigation, session duration selector (`5 / 15 / 30 min`), and quick scope reset.
- [x] 3.3 Build `ArtifactHistoryPanel` and safe confirmation controls (`src/components/viewer/study-mode/ArtifactHistoryPanel.tsx`) for granular delete, soft dismiss, confirmed scope clear, and one-click restore.
- [x] 3.4 Redesign `StudyModeWorkspace.tsx` around the 4 primary tabs (`Learn`, `Practice`, `Explore`, `Progress`), desktop 3-pane resizable/collapsible layout, Focus Mode toggle, keyboard shortcuts (`Alt+1..4`, `Alt+F`, `Alt+E`, `Escape`), contextual per-panel errors (offline vs. persistence distinction), and responsive mobile bottom-sheet study tools.
- [x] 3.5 Wire `DocumentViewer.tsx` to pass optional current locator and active text selection to `StudyModeWorkspace` when `studyModeOpen` is true, keeping ordinary Read Mode 100% untouched.

## 4. Verification & Tests

- [x] 4.1 Write unit and integration tests in `src/lib/study-plans/studyMode/__tests__/` covering scope key precision, source anchor persistence & navigation, session restoration, independent cancellation, offline vs. persistence error handling, artifact history/recovery, 3-pane/4-tab workspace, mobile bottom sheet, and Read Mode non-regression.
- [x] 4.2 Run `openspec validate`, TypeScript check (`npx tsc --noEmit`), ESLint (`npm run lint`), Vitest unit/integration tests, and `cargo check` (if Rust modified) / `npm run build`.
