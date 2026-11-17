## Context

See `proposal.md` for motivation. In `DocumentViewer.tsx`, desktop non-reader document types (`docType` other than `pdf`, `markdown`, `html`, and `epub` — e.g. `audio`, `video`, `youtube`, `other`) attach global `document` `mouseup` and `keyup` listeners (`handleSelection`) that only exclude `.textLayer`. Similarly, the mobile selection-change path (`readDocumentSelection`, `isDocumentContentScrollTarget`, `handleTouchStart`) matches `.prose` globally, which also matches markdown rendered inside `AssistantPanel` (`AssistantResponseContent`). Furthermore, `handleClickOutside` in `DocumentViewer.tsx` listens to `document` `mousedown` and calls `clearTextSelection()` (which executes `window.getSelection()?.removeAllRanges()`) whenever `activeExtractSelection` is non-empty and the click target is not the extract button, a dialog, or `.context-menu`.

When a user selects text in `AssistantPanel` alongside an audio/video document:
1. `DocumentViewer`'s `handleSelection` captures the Assistant's `window.getSelection()` and sets `selectedText`, displaying the floating `Create Extract` / `Lookup` pill and calling `onSelectionChange(selectedText)`.
2. `DocumentViewerWrapper` passes that selection back into `AssistantPanel` via `assistantContext.selection`, which triggers `setPinnedSelection(...)` and mounts `selection-context-chip`, shrinking `messagesContainerRef` and triggering `useAssistantConversationScroll`'s `ResizeObserver`.
3. Right-clicking anywhere in `AssistantPanel` fires `DocumentViewer`'s `mousedown` `handleClickOutside` first, clearing `window.getSelection()` before `AssistantPanel`'s `handleContextMenu` runs.

## Goals / Non-Goals

**Goals:**
- Enforce strict DOM ownership boundaries so `DocumentViewer` only captures and clears selections originating inside its own document content surface.
- Explicitly exclude `[data-assistant-panel="true"]` (and other non-viewer surfaces) from `DocumentViewer` global selection, scroll-dismissal, and outside-click selection-clearing listeners.
- Ensure `AssistantPanel` context menu and `useAssistantConversationScroll` preserve both the user's native selection and scroll position across selection and right-click interactions.

**Non-Goals:**
- Changing how `selection-aware-assistant` works when the user genuinely selects text in a document or transcript viewer.
- Redesigning `ContextMenu` positioning or `DocumentViewer`'s extract creation flow.

## Decisions

### Decision 1: Scope `DocumentViewer` selection and outside-click handlers by container ownership
- **Choice**: Add a root/content ref (or `data-document-viewer` / `[data-document-content="true"]` containment check) in `DocumentViewer.tsx` and explicitly reject selections/events whose `anchorNode`/`focusNode` or `event.target` are inside `[data-assistant-panel="true"]` or outside the viewer's own DOM subtree.
- **Rationale**: Checking both "inside this viewer's content container" and "not inside `[data-assistant-panel="true"]`" prevents cross-pane leakage even when `.prose` is used in both `MarkdownViewer` and `AssistantResponseContent`, and prevents `handleClickOutside` from wiping `window.getSelection()` when right-clicking in the Assistant panel.
- **Alternatives considered**: Stopping `mouseup`/`mousedown` propagation inside `AssistantPanel`. Rejected because stopping `mousedown`/`mouseup` propagation at the panel root can break global dismiss/drag/resize listeners and `ContextMenu` outside-click dismissal.

### Decision 2: Mark `AssistantPanel` with `data-assistant-panel="true"` and verify `handleContextMenu` on text and non-text areas
- **Choice**: Add `data-assistant-panel="true"` to `AssistantPanel`'s root element and ensure `onContextMenu` on both the panel root and message containers reads `window.getSelection()` before any menu state update can disturb focus/selection.
- **Rationale**: Provides a clean, testable DOM boundary for any host viewer (`DocumentViewer`, `WebBrowserTab`, `QueueScrollPage`, `RSSScrollMode`) and keeps selection intact when right-clicking on message text or panel chrome.

### Decision 3: Guard `useAssistantConversationScroll` against jumping during active selection / context menu interactions
- **Choice**: Verify `useAssistantConversationScroll` does not restore/overwrite `scrollTop` to `0` or an older anchor when the user has an active selection inside `messagesContainerRef` or opens a context menu, and add a regression test covering selection + resize + context menu.
- **Rationale**: Even without `selection-context-chip` mounting, other layout resizes (e.g. window resize, streaming, or toolbar changes) while text is selected should never snap the reader back to the top of the query.

## Risks / Trade-offs

- [Transcripts inside `DocumentViewer` (e.g. `TranscriptViewer` / `AudiobookViewer`)] → Ensure the viewer-side containment check still includes the viewer's own transcript/content area (`viewerRootRef` or `[data-document-content="true"]`) so legitimate transcript selections in audio/video documents continue to show `Create Extract`.
