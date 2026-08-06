## 1. Store: shared mode-aware reload chokepoint

- [x] 1.1 In `src/stores/queueStore.ts`, add `reloadForCurrentMode: () => Promise<void>` to the `QueueStore` interface. It reads `get().queueFilterMode` and dispatches to the existing loader for that mode (the same mode→loader mapping already inline in `setQueueFilterMode` ~lines 378-392): `due-today`→`loadDueDocumentsOnly`, `due-all`→`loadDueQueueItems`, `all-items`/`new-only`/default→`loadQueue`.
- [x] 1.2 Implement `reloadForCurrentMode` in the store body reusing the existing loaders (which already `dedupeLoad`-coalesce), so concurrent callers are safe.
- [x] 1.3 Add a code comment on `reloadForCurrentMode` marking it as the **single** chokepoint for post-mutation/navigation reconciles, and that raw `loadQueue()` calls in reconcile contexts are to be routed here.

## 2. Store: route reconcile sites through the chokepoint (D1 + D2)

- [x] 2.1 `reconcileIfDirty` (~line 512): replace `await get().loadQueue()` with `await get().reloadForCurrentMode()`.
- [x] 2.2 `postponeItemSmart` document fallback (~line 688) and learning-item fallback (~line 725): the delta path already ran (`applyItemDelta`); only the *fallback* reload (when the server response can't be mapped) should run, via `reloadForCurrentMode()`. Verify the success branch does not reload.
- [x] 2.3 `postponeItem` (~line 850): success branch already calls `applyItemDelta`; the `else` fallback reload routes through `reloadForCurrentMode()`. Confirm no unconditional reload on the success path.
- [x] 2.4 `postponeAll` reconcile (~line 877): keep the reload (server decides dates), route it through `reloadForCurrentMode()`.
- [x] 2.5 `bulkUnsuspend` (~line 925): keep the reload (items re-enter queue with recomputed scheduling), route through `reloadForCurrentMode()`.
- [x] 2.6 `bulkPostpone` (~line 1015): keep the reload (server decides new due date), route through `reloadForCurrentMode()`.
- [x] 2.7 `bulkSetLifecycle("forget")` branch (~line 1043): keep the reload (schedule reset), route through `reloadForCurrentMode()`. Other lifecycle transitions (done/dismiss) keep `removeItemsLocally` (no reload).
- [x] 2.8 Confirm the pure-optimistic bulk actions (`bulkSetPriority`, `bulkMoveToCollection`, `bulkUpdateTags`) and `bulkSuspend`/`bulkDelete` (which use `removeItemsLocally`) do NOT call any loader. If any stray `loadQueue()` remains, remove it.

## 3. Store: first-load state that survives unmount (D3)

- [x] 3.1 Add `loadedQueryKey: string | null` to the store state (default `null`) and a setter.
- [x] 3.2 In each loader's success path (`loadQueue`, `loadDueDocumentsOnly`, `loadDueQueueItems`, `hydrateStartupQueue`), set `loadedQueryKey` to the canonical key = `JSON.stringify([queueMode, queueFilterMode, activeCollectionId, semanticStudy?.enabled, semanticStudy?.focalTopic])`. (Reading semanticStudy from settings/customization as the views already do.)
- [x] 3.3 Keep the existing `hydrateStartupQueue` truncation guard (~line 400-407) as defense-in-depth; do not remove it.

## 4. Components: replace unmount-resetting refs with store state

- [x] 4.1 `src/components/review/ReviewQueueView.tsx`: remove `isFirstQueueLoadRef` (~line 288) and `lastQueueLoadKeyRef` (~line 296). In the load effect (~line 296-357), compute the current query key and skip the load when `useQueueStore.getState().loadedQueryKey === currentKey`; otherwise load and let the loader set the key.
- [x] 4.2 `src/components/mobile/MobileQueueView.tsx`: remove `loadedQuickFilterRef` (~line 213). Use the store `loadedQueryKey` the same way so returning to the queue tab does not reload when the quick filter is unchanged.
- [x] 4.3 Verify the first-load bounded startup snapshot path in `ReviewQueueView` (the `isFirstLoad && due-all && !semantic` branch ~line 308) still runs on a genuine first load (key mismatch) and only then.

## 5. External callers: route through the chokepoint

- [x] 5.1 `src/stores/collectionStore.ts` `createCollection` (~line 76) and `switchCollection` (~line 118): replace `useQueueStore.getState().loadQueue()` with `useQueueStore.getState().reloadForCurrentMode()`. (Switching collections changes the active query — confirm the query key derivation in task 3.2 includes `activeCollectionId`, so a real collection change still reloads.)
- [x] 5.2 `src/stores/reviewStore.ts` `startReviewAtItem` (~line 817): replace `get().loadQueue()` with the chokepoint (or, if the intent is only to ensure the item is present, prefer a targeted lookup — but minimally route through the chokepoint so it stays mode-stable).
- [x] 5.3 `src/components/viewer/DocumentViewer.tsx` `onArchive` (~line 7010): replace the `loadQueue()` call with `reloadForCurrentMode()` (the archive closes the tab; the reload is for the queue the user lands back on).

## 6. Regression test (acceptance criterion)

- [x] 6.1 In `src/stores/__tests__/queueStore.test.ts` (or a new sibling test file), add a test that: builds a populated queue in `due-all`, captures the rendered id order, simulates the confirmed trigger (a single-item postpone whose delta applies locally, then a reactivation-style reload), and asserts the id order is unchanged.
- [x] 6.2 Verify the test FAILS without the fix: temporarily revert the D1/D2 changes (e.g. restore an unconditional `loadQueue()` on the mutate path) and confirm the test breaks; then restore the fix. Record the before/after in the commit message.
- [x] 6.3 Run the full frontend suite. Confirm the 7 known pre-existing failures (deltaLog/sync suites needing a live server, `ReviewHome.deckStats`, `DeltaLogMigrationPanel`) are unchanged and not regressions; confirm no NEW failures.

## 7. Enumerate deliberately-untouched reloads

- [x] 7.1 In the proposal (or a short note in the change folder), list every reload trigger found during implementation that was deliberately left alone (e.g. `loadStats`, the Toolbar refresh, pull-to-refresh, `ensureStartup`), with a one-line reason. This satisfies the bug report's final requirement.
