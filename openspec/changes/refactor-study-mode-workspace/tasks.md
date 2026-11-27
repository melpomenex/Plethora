## 1. Presentation Coordinator & Workspace Host
- [x] 1.1 Define `DocumentPresentationMode` (`"read" | "study"`) and `StudyWorkspaceLayout` (`"focused" | "with-source" | "with-assistant"`) types and state helpers in `src/types/studyMode.ts` and `src/components/viewer/study-mode/studyWorkspaceState.ts`.
- [x] 1.2 Lift Study Mode hosting from `DocumentViewer.tsx` into `DocumentViewerWrapper.tsx` as a mutually exclusive presentation mode per document tab, honoring `settings.studyMode.rememberModePerSource` when explicitly enabled.
- [x] 1.3 Hide and mark `inert` the canonical `BaseDocumentViewer` during `"focused"` and `"with-assistant"` study layouts, and reveal the same single `BaseDocumentViewer` instance with a resizable divider in `"with-source"` desktop layout (and single-pane switch on narrow/mobile viewports).
- [x] 1.4 Coordinate `AssistantPanel`, `GuidedReadingPanel`, floating extract/rating overlays, and reader chrome so they do not bleed into focused Study Mode and restore cleanly on exit.
- [x] 1.5 Add Read/Study mode switch and Back to Reading controls in the compact workspace header, and preserve the reader toolbar Study entry point (gated by `settings.studyMode.showEntryPoints`).

## 2. Eliminate Duplicate Document Rendering
- [x] 2.1 Remove `OriginalSourcePane` and `LearningPathPane` from `StudyModeWorkspace.tsx` so no duplicate full-document plain-text renderer or naive outline pane is mounted.
- [x] 2.2 Preserve inline citation excerpts, anchor chips, and explicit `View Source` / citation-jump triggers that open `"with-source"` and navigate the canonical reader.

## 3. Redesign Learn, Practice, Explore, and Progress Activity UX
- [x] 3.1 Redesign the `Learn` destination with descriptive activity cards (Explain, Summarize, Worked Examples, Common Misconceptions, Memory Aids, Socratic Tutor), focused reading view for generated materials, and clean material switcher/history.
- [x] 3.2 Polish the `Practice` destination so active questions dominate the workspace, keep closed-book source hidden by default until explicitly requested or post-submission, and preserve authoritative grading and FSRS isolation.
- [x] 3.3 Extract a dedicated `StudyTimelineView.tsx` component with per-event source citation jumps and accessible list/sequence navigation, and ensure Concept Map, Audio Lesson, and Slides receive full-workspace dedicated views.
- [x] 3.4 Ensure `Progress` displays honest evidence-based status distinctions (not studied, studied not assessed, assessed, needs practice) with clear empty states.
- [x] 3.5 Complete `StudyModePreferencesDrawer.tsx` controls (including `teachingApproach`, `questionDifficulty`, `examplePreference`, `explanationLanguage`).
