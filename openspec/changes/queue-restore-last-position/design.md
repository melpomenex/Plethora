## Context

"Queue" is really two tabs: the list view (`type: "queue"`, `QueueTab`) and Scroll Mode (`type: "queue-scroll"`, `QueueScrollPage`), opened from inside the list via "Open Scroll Mode". Both are `SINGLE_INSTANCE_TAB_TYPES` in `src/stores/tabsStore.ts`, and inactive tabs stay mounted-but-hidden (`src/components/common/Tabs/TabContent.tsx`), so `QueueScrollPage`'s reading position (`currentIndex`, backed by tab `data.currentIndex` and a `sessionStorage` fallback) already survives switching tabs. The bug is that the nav entry points — `openTabByType("queue")` in `src/components/layout/MainLayout.tsx:518-547` and the bottom-nav "Queue" button in `src/components/mobile/MobileNavigation.tsx` (hardwired to `tabType: "queue"`) — always target the list tab, so a user reading in Scroll Mode who clicks away and clicks "Queue" again is dropped back on the list, not their document.

`tabsStore` already tracks `activeTabHistory: string[]`, a global most-recently-activated-tab-id list, updated on every `setActiveTab`/`addTab` call.

## Goals / Non-Goals

**Goals:**
- Clicking "Queue" (sidebar, mobile bottom nav, command palette) reactivates whichever of `"queue"` / `"queue-scroll"` was more recently active, if either is currently open.
- Preserve existing behavior when no queue-related tab is open yet (open the list, as today).
- Reuse existing tab/position-restore mechanisms; no new persistence layer.

**Non-Goals:**
- Changing how `QueueScrollPage` restores its own position within a session (already correct).
- Changing `SINGLE_INSTANCE_TAB_TYPES` membership or tab-reuse semantics for other tab types.
- Cross-session restore beyond what `sessionStorage`/tab `data` already provide.

## Decisions

- **Resolve via `activeTabHistory`, not a new "last queue mode" field.** Add a small selector/helper (e.g. `getMostRecentTabOfTypes(types: TabType[])`) to `tabsStore.ts` that scans `activeTabHistory` from the end and returns the first open tab whose `type` is in the given set. The "Queue" nav action calls this with `["queue", "queue-scroll"]`; if it finds a match, activate that tab id; otherwise fall back to `openTabByType("queue")`.
  - Alternative considered: store a dedicated `lastQueueTabType` field updated whenever a queue/queue-scroll tab is activated. Rejected — duplicates information `activeTabHistory` already encodes, and adds another piece of state to keep in sync.
- **Single shared helper used by both `MainLayout.tsx` and `MobileNavigation.tsx`**, rather than duplicating the resolution logic in each nav component, since both need identical behavior.
- **No change to `QueueScrollPage` or `QueueTab` internals.** They already restore position correctly once reactivated; the fix is purely about which tab gets reactivated.

## Risks / Trade-offs

- [Ambiguous intent if user closed Scroll Mode and only the list tab remains] → Falling back to the list tab is correct in that case; there's nothing to restore since the tab (and its position) no longer exists.
- [`activeTabHistory` could theoretically list a stale tab id after tab-close cleanup] → `tabsStore` already prunes closed tab ids from `activeTabHistory` on close (existing behavior); the helper only needs to skip ids no longer present in `state.tabs` defensively.
- [Command palette "Queue" action (`MainLayout.tsx:601`) uses the same `openTabByType`] → covered by fixing the shared entry point, no separate change needed there.
