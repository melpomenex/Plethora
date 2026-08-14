## Why

In an optimal Scroll Mode session, rating a document (e.g. an EPUB) reveals the
next item — frequently a flashcard — which flashes on screen and is then
skipped, unreviewed, in favor of the following document. This is a regression
of the flashcard-skip class fixed for wheel/swipe triggers in `4ce6df14`
(Aug 8): a different trigger walks through the same open hole. The session
build effect replaces `scrollItems` wholesale while `currentIndex` keeps
addressing a *numeric index*, so any post-rating dependency-identity change
(sync's debounced `loadDocuments()` store reload, queue-store `applyFilters()`
re-runs, any of the effect's 16 dependencies) recomposes the session and
displaces the item the user is looking at. Reproduced with the real
`composeSession` + `orderScrollItemsByCombinedCriterion`: rating a document
mid-session changes which item a fixed index addresses in 11/11 positions at
12 docs / 30 cards (50/50). `bd1f0cba` (Aug 13) made rebuilds reorder-prone by
wiring `targetTopicShare` to the composed counts, turning a rare skip into a
reliable one — and the existing lifecycle test explicitly blesses post-unlock
rebuilds ("A later, genuine source/settings dependency change while idle still
rebuilds normally"), which is exactly the behavior that eats the card.

## What Changes

- **Rebuilds re-anchor by item id, not index.** When the session build effect
  replaces `scrollItems`, the current item's position in the new list becomes
  the new `currentIndex`/`renderedIndex`. This applies to both build branches
  (optimal and queue-list/`customQueueItems`).
- **The current item is never dropped by a rebuild.** If a recomposed session
  no longer contains the item the user is viewing (the document-anchored
  session size shrinks after a rating and slices cards off the tail), that
  item is re-inserted at the current index so the user can still finish it.
  Shrinking applies only to items not yet reached.
- **Reveal state survives a rebuild** while the current flashcard stays in
  view (no answer flash/re-hide from an incidental remount).
- **Composition snapshot for the session lifetime** (optimal branch): the
  composed per-type counts are computed once at session build; a mid-session
  rating no longer shrinks the composed session, so cards the session promised
  are not silently dropped from the tail.
- **Three test layers** pinning the invariant permanently:
  1. Pure-function property tests (composition shrink + greedy-interleave
     displacement documented; re-anchor helper covered directly).
  2. Extended effect-sequence test in `queueScrollSessionLifecycle.test.ts`:
     a dependency flip after the rating-lock release must not displace the
     current item.
  3. Component-level integration test on `QueueScrollPage` with mocked
     stores/APIs (pattern already used by `ReviewQueueView.test.tsx`): rate a
     document → advance timers → fire a documents reload → assert the
     flashcard is still current and rendered. This layer catches future
     unknown triggers, which is the actual lesson of this bug.

## Capabilities

### New Capabilities
- `scroll-session-stability`: A Scroll Mode session that has started SHALL
  keep the item the user is currently viewing stable across session rebuilds
  triggered by dependency changes (position re-anchored by item id, membership
  preserved by re-insertion, reveal state preserved), for both the optimal and
  queue-list build paths.

### Modified Capabilities

(none — `queue-item-type-routing` requirements are unaffected; composition
*counts* become session-lifetime snapshots, which is additive behavior
specified under the new capability)

## Impact

- `src/pages/QueueScrollPage.tsx` — the session build effect (both branches),
  `advanceAfterRemoval`, index/rendered-index handling around
  `setScrollItems`, flashcard reveal bridging.
- `src/pages/queueScrollSessionLifecycle.ts` — gains the re-anchor
  reconciliation logic as a pure, testable function (current
  `shouldBuildScrollSession` gating stays).
- `src/pages/queueScrollBudget.ts` — no behavior change to `composeSession`
  itself; the optimal branch snapshots its output for the session lifetime.
- New tests: `src/pages/__tests__/queueScrollSessionLifecycle.test.ts`
  (extended), `src/pages/__tests__/queueScrollReanchor.test.ts` (new, pure),
  `src/pages/__tests__/QueueScrollPage.rebuild.test.tsx` (new, component).
- Performance gate: no new benchmarks expected; the re-anchor is O(n) over the
  session list per rebuild.
