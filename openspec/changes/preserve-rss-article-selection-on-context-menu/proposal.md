## Why

In the RSS article reader, right-clicking selected text immediately removes the visible selection, interrupting the user's attempt to act on that passage. The selection should remain visible and available while the user chooses an action from the context menu.

## What Changes

- Preserve the selected article text and its visible range when opening and interacting with the RSS selection context menu, including the Highlight submenu.
- Keep actions bound to the passage selected when the menu opened, even if a later dialog takes focus.
- Preserve the selection when the user cancels with Escape so they can reopen the menu; allow ordinary outside clicks and a new selection to behave normally.
- Discard selection state when its article or content is replaced, preventing actions from using a previous article's passage.
- Add browser regression coverage for the full select, right-click, submenu, and action sequence across the RSS reader pane, full-content view, and Story view.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-menus`: Require RSS article selection menus to retain visible selection and captured action text throughout menu interaction, with explicit cancellation and article-change behavior.

## Impact

- Primary implementation area: `src/components/media/useRssSelectionMenu.tsx` and its consumers in `RSSReader.tsx`, `RSSFullContentView.tsx`, and `StoryView.tsx`.
- Supporting areas, if the reproduction demonstrates a need: shared `ContextMenu.tsx`, `useSurfaceMenu.ts`, and the article HTML rendering boundaries.
- Extend the existing RSS selection unit tests and Playwright RSS harness coverage. Keep shared menu accessibility, action registry ordering, native no-selection menus, and mobile selection gestures compatible.
- No backend, persistence schema, API, dependency, or performance-budget changes are expected.
