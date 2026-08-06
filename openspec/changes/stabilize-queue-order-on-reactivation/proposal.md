## Why

The Queue list visibly reorders itself the instant the user returns to it after
performing an action or navigating away — closing the Queue tab, switching tabs,
opening a document/Scroll Mode and coming back, or completing a queue action
(postpone, suspend, archive, finish). The displayed order must stay stable unless
the user changes sort, filter, search, or explicitly refreshes. This is the fourth
report in this class; three narrow per-site patches already landed and each
recurred, which is the signal that the root cause is structural — too many
independent reload paths each replace the whole list.

## What Changes

- **Add one shared, mode-aware reload chokepoint** (`reloadForCurrentMode()`) to
  the queue store. Every reconcile site currently hardcoding `loadQueue()` routes
  through it instead, so a reload after an action always re-issues the *active*
  query (due-all / due-today / all-items / new-only), never the wrong query's
  result set.
- **Stop the post-mutation reconcile from replacing `items` when the local
  optimistic update is already correct.** Single-item mutations already patch
  `items` in place via `applyItemDelta` / `removeItemsLocally`; the follow-up
  full reload that re-sorts the whole list is removed where the local update is
  authoritative, and kept (routed through the chokepoint) only where a genuine
  server refresh is required (bulk unsuspend, lifecycle "forget", postpone-all).
- **Make the `ReviewQueueView` / `MobileQueueView` first-load refs survive tab
  close/reopen** by moving the "have we done our first load for this query"
  state out of component `useRef`s (which reset on unmount) and into the store,
  keyed by the query identity. This closes the "close the Queue tab and reopen"
  path, where the ref reset and re-ran the bounded startup fast-path.
- **Add a regression test** that captures the rendered id order, simulates the
  confirmed trigger, and asserts the order is unchanged. The test is verified to
  fail without the fix.

## Capabilities

### New Capabilities
- `queue-order-stability`: The reading/review queue's displayed item order stays
  stable across tab close/reopen, tab switches, returning from a document / Scroll
  Mode / review session, and across the user's own queue actions — reordering only
  when the user changes sort, filter, or search, or explicitly refreshes.

### Modified Capabilities
<!-- None. No existing spec covers queue display-order behavior; this is a new
     capability. -->

## Impact

- **Frontend store** — `src/stores/queueStore.ts`: new `reloadForCurrentMode()`;
  the ~10 reconcile sites that call `loadQueue()` unconditionally (lines ~514,
  688, 725, 850, 877, 925, 1015, 1043 and `reconcileIfDirty`) route through it;
  per-query "first load done" state added to the store so it survives unmount.
- **Components** — `src/components/review/ReviewQueueView.tsx`,
  `src/components/mobile/MobileQueueView.tsx`: replace component `useRef`
  first-load guards with the store-level guard.
- **External callers** — `src/stores/collectionStore.ts` (`createCollection`,
  `switchCollection`), `src/stores/reviewStore.ts` (`startReviewAtItem`),
  `src/components/viewer/DocumentViewer.tsx` (`onArchive`): route their
  post-mutation queue reloads through the same chokepoint.
- **Test** — new test capturing rendered id order across the confirmed trigger.
- **Not affected / deliberately preserved**: session customization filters,
  `customSubset` (semantic study), the bounded 50-item startup snapshot fast-path
  for first paint, multi-select (`applyFilters` pruning of `selectedIds`), the
  three prior narrow fixes (no regression), and the mode-aware no-op guard in
  `setQueueFilterMode`. No backend (Rust/SQL) changes are required — the backend
  queries are deterministic per query; the instability is entirely a frontend
  reload-path problem.
