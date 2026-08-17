## Why

When users navigate between views (such as clicking Settings, switching tabs, or triggering actions from the collapsible toolbar rail), the rail expands on hover/focus but fails to collapse back to its icon-only state. This leaves the expanded rail overlaying the page content—obscuring the active view's navigation (e.g., Settings sidebar) and content area indefinitely.

The root cause is that clicking any toolbar button gives it DOM focus. When the pointer subsequently leaves the rail into the page content, `handlePointerLeave` detects that a child element still has focus and aborts the collapse timer. Because clicking non-interactive page elements does not transfer DOM focus, the toolbar button remains focused and the rail stays permanently expanded.

## What Changes

- **Auto-collapse on button click / navigation**: Triggering an action or clicking a button in the toolbar rail clears sticky focus and allows the rail to collapse immediately or after the pointer leaves.
- **Auto-collapse on tab / view transition**: The toolbar rail subscribes to tab activation and automatically collapses whenever the user enters Settings, switches tabs, or changes views.
- **Fixed pointer leave handling**: Ensure `pointerLeave` properly triggers the collapse timer rather than being permanently blocked by a mouse-clicked button retaining DOM focus.
- **Outside click dismissal**: Clicking outside the toolbar rail collapses any expanded state.
- **Preserve keyboard accessibility**: Keyboard tab navigation (`focus-visible`) continues to expand the rail while tabbing through buttons, collapsing when focus moves outside the rail or an action navigates away.

## Capabilities

### New Capabilities
- `collapsible-sidebar-auto-collapse`: Defines the collapse and un-expansion lifecycle for the toolbar rail during pointer hover/leave, click actions, outside clicks, and view/tab navigation transitions.

### Modified Capabilities

## Impact

- `src/components/Toolbar.tsx`: Updated hover, focus, click, and tab-change listeners to ensure the toolbar rail collapses properly.
- `src/components/__tests__/Toolbar.test.tsx`: Updated and expanded test suites covering click-then-leave, tab transitions, outside clicks, and keyboard navigation.
