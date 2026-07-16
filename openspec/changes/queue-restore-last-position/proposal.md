## Why

The "Queue" nav item (sidebar and mobile bottom nav) always opens/activates the plain list tab (`type: "queue"`), even when the user was last reading inside Scroll Mode (`type: "queue-scroll"`), which already keeps its own reading position alive in a hidden tab. After navigating away and clicking "Queue" again, the user lands back on the list instead of the document they were actually viewing, and has to notice and re-open Scroll Mode manually to get back to where they were.

## What Changes

- The "Queue" nav action (sidebar `openTabByType("queue")` in `MainLayout.tsx` and the mobile bottom-nav "Queue" button in `MobileNavigation.tsx`) resolves to whichever queue-related tab (`"queue"` or `"queue-scroll"`) was most recently active, instead of unconditionally targeting `"queue"`.
- If neither a `"queue"` nor a `"queue-scroll"` tab currently exists, the nav action falls back to opening the plain list tab (today's behavior), so first-time navigation is unaffected.
- No change to `QueueScrollPage`'s own position-restore logic (`currentIndex` / `sessionStorage` fallback) — this change only fixes which tab the nav button surfaces.

## Capabilities

### New Capabilities
- `queue-navigation-continuity`: Clicking the "Queue" nav entry point returns the user to whichever queue-related tab (list or Scroll Mode) they were most recently viewing, preserving in-progress reading position.

### Modified Capabilities
(none — no existing spec covers queue nav-to-tab resolution)

## Impact

- `src/components/layout/MainLayout.tsx` (`openTabByType`, sidebar "Queue" action/command-palette entry)
- `src/components/mobile/MobileNavigation.tsx` (bottom-nav "Queue" button)
- `src/stores/tabsStore.ts` (`activeTabHistory`, used to determine "most recently active" among queue-related tab types; may need a small helper/selector)
- No changes to `QueueScrollPage.tsx`, `QueueTab.tsx`, or the position-restore/session-storage mechanisms already in place there.
