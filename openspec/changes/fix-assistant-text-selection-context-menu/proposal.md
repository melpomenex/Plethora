## Why

When a user selects text inside the Assistant panel (especially alongside non-PDF/EPUB/HTML/Markdown documents such as audio or video transcripts), `DocumentViewer`'s global `document` `mouseup`/`keyup`/`mousedown` listeners intercept the Assistant selection as if it were a document selection. This pops up the document viewer's floating "Create Extract" button, pins the Assistant's own response as a `selection-context-chip` (resizing the message viewport and jumping the scroll position back toward the top/query), and clears `window.getSelection()` on right-click `mousedown` before the Assistant's context menu can act on the selected text.

## What Changes

- Scope `DocumentViewer` text-selection capture (`mouseup`, `keyup`, `selectionchange`, `touchstart`, and `scroll` dismissal) strictly to selections anchored within the document viewer's own content surface, explicitly ignoring selections inside `[data-assistant-panel]` or other non-viewer UI surfaces.
- Prevent `DocumentViewer`'s outside-click `mousedown` handler from calling `clearTextSelection()` (and `window.getSelection()?.removeAllRanges()`) when the user interacts with or right-clicks inside the Assistant panel.
- Mark `AssistantPanel` with an explicit boundary attribute (`data-assistant-panel="true"`) and ensure its `handleContextMenu` preserves the active text selection and opens reliably whether right-clicking on message text or elsewhere in the panel.
- Ensure `useAssistantConversationScroll` preserves the user's current scroll position when text is selected, when a context menu opens, or when container layout shifts occur while reading.

## Capabilities

### New Capabilities
- `assistant-text-selection-and-context-menu`: Isolates text selection and right-click context menu interactions within the Assistant panel so selecting text or right-clicking in Assistant messages preserves scroll position, keeps the native selection intact, shows the Assistant context menu with selection actions, and never triggers document-viewer extract UI or selection pinning.

### Modified Capabilities
<!-- None: selection-aware-assistant continues to govern reader-side selections; this change prevents Assistant-side selections from being misclassified as reader selections. -->

## Impact

- `src/components/viewer/DocumentViewer.tsx`: Global `handleSelection`, `readDocumentSelection`, `isDocumentContentScrollTarget`, `handleTouchStart`, and `handleClickOutside` listeners.
- `src/components/assistant/AssistantPanel.tsx`: Panel root boundary marker and context menu / selection preservation.
- `src/components/assistant/useAssistantConversationScroll.ts`: Scroll preservation during selection and non-user-initiated layout updates.
- Unit / component tests in `src/components/assistant/__tests__/` and `src/components/viewer/__tests__/`.
