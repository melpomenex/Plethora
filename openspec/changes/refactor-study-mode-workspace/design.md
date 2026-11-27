## Context

`DocumentViewerWrapper.tsx` currently owns the split between `AssistantPanel` and `BaseDocumentViewer` (`DocumentViewer.tsx`), while `DocumentViewer.tsx` mounts `StudyModeWorkspace` as a fixed-width sibling container (`w-full md:w-[780px] ...`) next to the reader and `GuidedReadingPanel`. Meanwhile `StudyModeWorkspace.tsx` mounts `LearningPathPane` + `OriginalSourcePane` + `toolsPaneContent` in a 3-pane layout.

## Goals / Non-Goals

**Goals:**
- Make `DocumentViewerWrapper.tsx` the single authoritative owner of `DocumentPresentationMode` (`"read" | "study"`) and `StudyWorkspaceLayout` (`"focused" | "with-source" | "with-assistant"`).
- Keep ordinary Read Mode 100% untouched and zero-overhead when `presentationMode === "read"` (Study Mode is lazy-loaded and never mounted).
- Keep the canonical `BaseDocumentViewer` mounted in a suspended/hidden `inert` container when `presentationMode === "study"` and `layout !== "with-source"` so EPUB CFI, PDF zoom/page, scroll position, and annotations survive without unmounting or duplicating reader instances, while remaining invisible and non-focusable.
- Support resizable split view in `"with-source"` desktop mode using the single canonical `BaseDocumentViewer`, and single-pane/sheet switching on narrow/mobile viewports.
- Coordinate `GuidedReadingPanel`, reader floating controls, and reader overlays so they do not bleed into focused Study Mode.
- Redesign `Learn`, `Practice`, `Explore` (adding a dedicated `StudyTimelineView`), and `Progress` to use the full workspace cleanly.

**Non-Goals:**
- Rewriting `EPUBViewer`, `PDFViewer`, `PracticePanel`, `InteractiveConceptMap`, `PlayableAudioLessonPlayer`, or `PlayableSlidesPlayer` from scratch.
- Adding new database tables in this change (handled in `implement-source-aware-study-scopes`).

## Decisions

1. **Authoritative Host**: `DocumentViewerWrapper.tsx` owns `presentationMode` and `studyLayout` per mounted document tab (`documentId` + `tabId`), exposing a clean `onEnterStudyMode(options?)` / `onExitStudyMode()` callback to `BaseDocumentViewer` so the Read toolbar's `Study` button, Read/Study segmented control, selection actions, and Study Plan launchers all route through one chokepoint.
2. **Suspending vs. Unmounting the Reader**: Keeping `BaseDocumentViewer` inside a `hidden` + `inert` flex child (`aria-hidden="true"`, `display: none`) during `"focused"` and `"with-assistant"` modes avoids re-parsing large EPUBs/PDFs on every Read↔Study toggle while guaranteeing zero visibility, zero focusability, and exact state preservation. On explicit citation navigation (`onJumpToSource`), `DocumentViewerWrapper` transitions to `"with-source"` (or `"read"` if requested) and dispatches the jump to the single canonical reader, overriding automatic position restoration.
3. **Eliminating Duplicate Source Rendering**: `StudyModeWorkspace` no longer renders `OriginalSourcePane` or `LearningPathPane`. Instead, its header provides a compact `View Source` toggle (`"with-source"`) and `Ask Assistant` toggle (`"with-assistant"`), plus Back to Reading / Read|Study switch.
4. **Mutually Exclusive Optional Pane**: Toggling `"with-source"` while `"with-assistant"` is open switches to `"with-source"` (and vice versa), preventing the 4-surface clutter regression.
5. **Performance**: `StudyModeWorkspace` stays behind `createRetryableLazy`. When `presentationMode === "read"`, no Study Mode component mounts, no session lookup runs, and no Study Mode AI/persistence code executes.

## Migration & Compatibility

- Legacy `StudyModeViewTab` values (`source`, `mind_map`, `audio`, `slides`) continue to deserialize via `normalizeStudyModeTab`.
- `StudyModeWorkspace` remains standalone-renderable in unit tests (with sensible defaults when rendered outside `DocumentViewerWrapper`).
