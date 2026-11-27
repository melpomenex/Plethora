## Why

Plethora's current Study Mode is mounted inside `DocumentViewer.tsx` as an additive sibling container alongside the live document reader, its table of contents, the Assistant panel, and Guided Reading controls—while `StudyModeWorkspace.tsx` simultaneously renders a second full-document plain-text copy (`OriginalSourcePane`) and a second naive outline (`LearningPathPane`) inside a 3-pane layout. On EPUBs, PDFs, and articles this produces up to four competing surfaces, duplicated reading positions, cramped learning tools, and high cognitive load.

Study Mode must become a first-class, mutually exclusive document presentation mode (`"read" | "study"`) owned by a single workspace coordinator (`DocumentViewerWrapper.tsx`), giving the active learning activity full workspace width and height in Focused mode by default while preserving ordinary Read Mode untouched.

## What Changes

- **Mutually Exclusive Document Presentation Modes**: Introduce `DocumentPresentationMode = "read" | "study"` owned per document tab in `DocumentViewerWrapper.tsx`, replacing the additive sibling mount in `DocumentViewer.tsx`. Entering Study Mode transitions the document's main content area into the dedicated Study Mode workspace, hiding and marking `inert` the ordinary reader surface without duplicating the document tab or resetting reader state.
- **Coordinated Study Workspace Layout**: Introduce `StudyWorkspaceLayout = "focused" | "with-source" | "with-assistant"` so the user gets a clean, full-width Focused Study Workspace by default, with at most one optional companion pane (either the canonical original reader or the existing Assistant) at a time.
- **Eliminate Duplicate Document Rendering**: Remove `OriginalSourcePane` and `LearningPathPane` from the Study Mode layout. Study Mode displays short source citations/excerpts inline and reuses the single canonical `BaseDocumentViewer` when the user explicitly requests `"with-source"` comparison.
- **Exact Return to Reading & Panel Coordination**: Capture canonical reader state (EPUB CFI, PDF page/zoom/scroll, HTML/Markdown scroll, media timestamp, Assistant/panel visibility) before entering Study Mode and restore it seamlessly on exit, while allowing explicit citation jumps to override automatic restoration.
- **Reconcile Prior Unarchived Specs**: Explicitly supersedes the 3-pane / always-visible plain-text `OriginalSourcePane` layout requirement in the unarchived `redesign-study-mode-foundation-and-workspace` change in favor of the mutually exclusive Focused / With-Source / With-Assistant workspace model.
- **Redesign Activity Information Architecture**: Elevate `Learn`, `Practice`, `Explore` (Concept Map, dedicated Timeline component, Audio Lesson, Slides), and `Progress` into spacious, learning-focused activity views with descriptive landing cards, clean activity transitions, and zero automatic generation on visit.

## Capabilities

### New Capabilities
- `study-mode-dedicated-workspace`: Mutually exclusive `DocumentPresentationMode` (`"read" | "study"`), coordinated `StudyWorkspaceLayout` (`"focused" | "with-source" | "with-assistant"`), single-instance canonical reader reuse, exact reader state restoration, compact workspace header, and redesigned `Learn | Practice | Explore | Progress` activity views.

### Modified Capabilities
- (None archived in `openspec/specs/`; supersedes the unarchived `redesign-study-mode-foundation-and-workspace/specs/study-mode-workspace/spec.md` 3-pane plain-text source requirement.)

## Dependencies

- Foundation for `implement-source-aware-study-scopes`, `integrate-study-workspace-assistant`, and `validate-study-workspace-ux`.

## Non-Goals

- Creating a new document tab for Study Mode.
- Building a separate chat engine or second EPUB/PDF renderer.
- Supporting 3+ simultaneous columns by default.
- Modifying ordinary Read Mode behavior when Study Mode is inactive.

## Impact

- **Host & Coordinator**: `src/components/viewer/DocumentViewerWrapper.tsx`, `src/components/viewer/DocumentViewer.tsx`, new `src/components/viewer/study-mode/studyWorkspaceState.ts` (or store/hook).
- **Study Workspace UI**: `src/components/viewer/StudyModeWorkspace.tsx`, `src/components/viewer/study-mode/` (new `StudyTimelineView.tsx`, refactored `Learn` landing/activity layout, removal of duplicate `OriginalSourcePane` & `LearningPathPane` usage).
- **Preferences & Settings**: `src/components/viewer/StudyModePreferencesDrawer.tsx`, `src/stores/settingsStore.ts` (`rememberModePerSource` honored per document).
