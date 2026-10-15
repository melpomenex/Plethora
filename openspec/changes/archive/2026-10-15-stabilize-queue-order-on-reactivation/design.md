## Context

The Queue list visibly reorders when the user returns to it after an action or
navigation. This is the fourth report in the class; three narrow fixes already
landed (`ReviewQueueView.tsx:98-107` removed reconcile-on-focus;
`DocumentViewer.tsx:3163-3169` removed mount-time `loadQueue()`;
`queueStore.ts:372-376` added a no-op guard in `setQueueFilterMode`; commit
`31fbcc50`). Each recurred because each patched a single call site while ~10
other reload paths kept replacing the whole list.

### Verified ground truth (reproduced from source, not assumed)

1. **Order is produced in `ReviewQueueView`'s `visibleItems` memo**
   (`ReviewQueueView.tsx:409-466`): it reads store `items`, filters by
   mode/customization, then `orderQueueItems(filtered, preset)`. The final
   tiebreaker in `orderQueueItems` (`reviewUx.ts:145-163`) is
   `a.item.id.localeCompare(b.item.id)` — a **fully deterministic** ordering for
   a given item set. So a re-fetch of the *same* set in a *different* backend
   chain order renders identically. **The reorder therefore requires a different
   `items` array**, not merely a different backend row order.

2. **`items` is replaced wholesale by every loader** (`queueStore.ts`):
   `loadQueue` (259), `loadDueDocumentsOnly` (323), `loadDueQueueItems` (347),
   `hydrateStartupQueue` (400). Each does `set({ items, ... })` then
   `applyFilters()`. Replacing `items` is the only thing that can move unrelated
   rows.

3. **`loadQueue()` is already mode-aware internally** (line 260:
   `const mode = forceAllItems ? "all-items" : get().queueFilterMode`). So the
   report's Lead 1 framing ("reloads ignore the active filter mode and swap in a
   *different query's* result set") is **imprecise**: `loadQueue()` does not swap
   in the wrong query — it re-issues the active query. The visible reorder comes
   from two real effects instead:
   - **(A) Wholesale replacement of a correct, locally-patched `items` array.**
     After a single-item mutation, `items` is already correct (via
     `applyItemDelta`/`removeItemsLocally`). The follow-up `loadQueue()` then
     discards that array and rebuilds it from the server, which re-runs the full
     priority sort over the whole set. With ties broken by `id.localeCompare`
     this is usually stable — but the reload also **clears selection**
     (`selectedIds: new Set()`), **re-arms `hasLocalDeltas=false`**, and on a
     ~1400-item queue produces a large synchronous `set` + `applyFilters` pass.
     When the view is frozen behind an inactive tab (effect (B)), this mutation
     is invisible until reactivation, where it surfaces as the "rapid rearrange."
   - **(B) Inactive tabs render frozen, then unfreeze in one burst.**
     `TabContent.tsx:41-49`: `TabWrapper`'s memo comparator returns `true`
     (skip render) for any inactive→inactive or active→inactive transition. So
     while the store mutates behind a backgrounded Queue tab, the view keeps
     showing the stale order; on reactivation every row re-renders into its new
     position at once. This is what "rapidly rearrange" describes.

4. **Component refs reset on unmount** (`ReviewQueueView.tsx:288`
   `isFirstQueueLoadRef`, `:296` `lastQueueLoadKeyRef`;
   `MobileQueueView.tsx:213` `loadedQuickFilterRef`). Closing the Queue tab and
   reopening re-runs the first-load path, including the bounded
   `hydrateStartupQueue` snapshot fast-path, against an already-fully-loaded
   queue.

### Confirmed trigger (the one this proposal targets)

Reproducing "closes the Queue" across the four candidate paths, the path that
actually moves unrelated rows is **(c)+(d): performing a queue action or returning
from a document, where a post-mutation `loadQueue()` replaces `items` while the
Queue tab is inactive, then the user returns to it.** Pure tab close/reopen (a)
and tab switch (b) no longer reorder *on their own* thanks to the three prior
fixes — **but** the close/reopen path resets the component first-load refs
(finding 4), which re-triggers the bounded startup snapshot against an
already-loaded queue, so (a) must still be fixed at the store level to be robust.

## Goals / Non-Goals

**Goals:**
- One shared, mode-aware reload chokepoint that **every** post-mutation
  reconcile routes through — no ad-hoc per-site reloads.
- The displayed order does not change when returning to the Queue after any of:
  close/reopen, tab switch, returning from document / Scroll Mode / review
  session, or a user queue action.
- A user mutation (postpone/suspend/delete) moves/removes only that item's row.
- Component first-load state survives tab unmount.

**Non-Goals:**
- Suppressing animations or memoizing rows as *the* fix (rejected by
  requirement #3; the underlying `items` array must not change).
- Changing the backend queries or sort. They are deterministic per query; the
  instability is purely a frontend reload-path problem.
- Re-surveying or "fixing" the 7 pre-existing unrelated test failures.
- Changing the FSRS/engagement priority *computation*.

## Decisions

### D1 — One mode-aware `reloadForCurrentMode()` chokepoint in the store

Add `reloadForCurrentMode()` to `queueStore`. It reads `queueFilterMode`
(+ `activeCollectionId`) and dispatches to the correct loader — exactly the
mode→loader mapping that already exists inline in `setQueueFilterMode`
(`queueStore.ts:378-392`) and is duplicated in `ReviewQueueView.tsx`'s effect.
That duplication is itself a recurrence vector; consolidating it here means there
is exactly one place to edit when the mapping changes.

`reloadForCurrentMode()` reuses the existing loaders (and therefore their
`dedupeLoad` coalescing), so concurrent calls are already safe.

**Rationale over alternatives:**
- *Alternative: add a guard at each of the ~10 call sites.* Rejected — this is
  the pattern that already recurred three times. A guard per site leaves the
  mapping duplicated and invites an 11th site to regress.
- *Alternative: make `loadQueue()` itself the chokepoint.* It already is
  mode-aware, so the minimal change is to (a) make every reconcile site call it
  (most already do) and (b) remove the ones that shouldn't fire at all (D2).
  `reloadForCurrentMode()` is introduced as the *named intent* ("reload the
  current mode") so call sites read clearly and so the external callers
  (`collectionStore`, `reviewStore`, `DocumentViewer`) don't reach for a raw
  `loadQueue()` whose mode-awareness is implicit.

### D2 — Don't reload when the local optimistic update is already correct

For single-item mutations the local update (`applyItemDelta` /
`removeItemsLocally`) is authoritative; the follow-up `loadQueue()` is the thing
that moves unrelated rows. Remove the unconditional post-mutation `loadQueue()`
at:
- `postponeItemSmart` document + learning-item fallback branches
  (`queueStore.ts:688, 725`) — the delta path already ran; the fallback reload is
  only reached when the server response couldn't be mapped, and there it should
  use the chokepoint.
- `postponeItem` (`:850`), `bulkSuspend`-adjacent paths — keep `removeItemsLocally`
  for removals; drop the redundant reload.
- `runBulkPatch` callers that only edit fields already patched optimally
  (`bulkSetPriority`, `bulkMoveToCollection`, `bulkUpdateTags`) — no reload.

Keep a real reload (routed through `reloadForCurrentMode()`) **only** where a
server refresh is genuinely required because the local update can't reconstruct
the result: `bulkPostpone` (`:1015`, server decides the new due date),
`bulkUnsuspend` (`:925`, items re-enter the queue with recomputed scheduling),
`bulkSetLifecycle("forget")` (`:1043`, schedule reset), and the `postponeAll`
reconcile (`:877`). Selection is released in those paths exactly as today.

### D3 — Move first-load state into the store so it survives unmount

Replace `ReviewQueueView`'s `isFirstQueueLoadRef`/`lastQueueLoadKeyRef` and
`MobileQueueView`'s `loadedQuickFilterRef` with a store field
`loadedQueryKey: string | null` (the JSON of `[queueMode, queueFilterMode,
activeCollectionId, semanticStudy.enabled, semanticStudy.focalTopic]`). The
view's load effect becomes: if `loadedQueryKey === currentKey`, do nothing;
otherwise load and set it. Because this lives in the store, closing and
reopening the Queue tab does **not** reset it, so the bounded startup snapshot is
not re-applied over an already-loaded queue. The snapshot guard in
`hydrateStartupQueue` (`queueStore.ts:400-407`) stays as a defense-in-depth.

**Rationale:** refs reset on unmount by definition; the bug explicitly calls this
out. The store is the correct home for state that must outlive a tab.

### D4 — Do NOT touch `TabWrapper`'s freeze comparator

The freeze-then-burst in `TabContent.tsx:41-49` is a *symptom amplifier*, not
the root cause: if `items` never changes behind an inactive tab (D1+D2), the
burst on reactivation renders the *same* order and there is nothing to rearrange.
Leaving the comparator untouched preserves its real purpose (perf on large
queues) and satisfies requirement #3 — the fix is not "hide the animation."

## Risks / Trade-offs

- **[Stale data after a mutation the local update can't model]** → Mitigation:
  the genuine-refresh paths (D2 list) still reload via the chokepoint; the
  Toolbar refresh button still calls the loaders directly; `reconcileIfDirty`
  remains for callers that need a forced reconcile.
- **[A future caller adds a raw `loadQueue()` and reintroduces the bug]** →
  Mitigation: a code comment on `reloadForCurrentMode()` documenting it as the
  single chokepoint, plus the regression test (acceptance criterion) that fails
  on any whole-list replacement across the trigger.
- **[`loadedQueryKey` in the store could skip a load the user expects on
  close/reopen]** → Mitigation: an explicit refresh (Toolbar / pull-to-refresh)
  bypasses the key check; changing sort/filter/search updates the key and reloads.
- **[Test must fail without the fix]** → The acceptance test captures the
  rendered id order before/after simulating the confirmed trigger; it is verified
  by reverting the fix (per the bug report's instruction), not by assumption.

## Migration Plan

Frontend-only; no data migration, no API/IPC contract change. Ship as a single
change. Rollback is `git revert` — the local-update paths (`applyItemDelta` etc.)
already exist and remain the source of truth; reverting restores the unconditional
reloads, which is the current (buggy) behavior.

## Open Questions

None. The confirmed trigger, root cause, and fix surface are determined from
source. Any reload trigger deliberately left alone will be enumerated in the
proposal at implementation time (per the bug report's final instruction).
