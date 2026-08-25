## Context

Scroll Mode (`src/pages/QueueScrollPage.tsx`, ~4400 lines) builds a session
once via a build effect whose dependency array includes 16 sources:
`documentQueueItems`, `documentsMap`, `dueFlashcards`, `dueExtracts`,
`isRating`, `isNeuralMode`, `readRssItemIds`, three `settings.*` objects,
three `activeTabQueueData` fields, three rated/dismissed id sets, and
`customSubset`. Rating mutates the session **in place** via
`advanceAfterRemoval` (remove the rated item, keep the numeric index, which
now addresses the successor). The build effect must not undo that in-place
advance: `shouldBuildScrollSession` (`queueScrollSessionLifecycle.ts`) skips
runs while the `isRating` lock is held **and the first run after release** —
but any *later* dependency-identity change rebuilds and replaces
`scrollItems` wholesale while `currentIndex` keeps pointing at the same
number.

Two properties make that replacement visible today:

1. `composeSession` (`queueScrollBudget.ts`) anchors session size on document
   availability (`N = a.documents / w.documents`), and the optimal branch
   filters rated documents out of the pool (`ratedDocumentIds`). One rating →
   smaller `N` → the recomposed session holds **fewer items**, including
   fewer flashcards (`slice(0, composed.flashcards)` drops tail cards).
2. `orderScrollItemsByCombinedCriterion` (`queueScrollOrder.ts`) is a greedy
   *sequential* interleave whose output depends on the whole input multiset
   and, since `bd1f0cba`, on a `targetTopicShare` recomputed from the
   composed counts. Removing one document changes picks after its position.

Measured with the real functions: 12 docs / 30 cards at 50/50 sliders —
rating each document and rebuilding changes the item at the rater's index in
11/11 cases. The card shown by `advanceAfterRemoval` flashes and is replaced
by a document. The card is not rated; it may resurface in a later rebuild or
be dropped entirely.

Triggers observed/ruled out during investigation: wheel momentum and EPUB
iframe swipe bridges are guarded (Aug 8 fix `4ce6df14`); the rating path
itself, viewer unmount saves, backend event emits, and polling intervals were
ruled out by code audit. The live trigger class is shared-store identity
churn — strongest candidate the sync engine's debounced
`scheduleDocumentStoreReload()` → `loadDocuments()` (fires on any incoming
replicated document; drained by the input-aware scheduler when the user stops
interacting, i.e. right after tapping a rating orb) plus any queue-store
`applyFilters()` re-run from other live subscribers. The fix must not depend
on naming the trigger.

Neural mode already snapshots and restores its session
(`preNeuralScrollItems`); the queue-list branch (`customQueueItems` +
`selectByQuotaInOrder` re-selection) has the same replacement hole.

## Goals / Non-Goals

**Goals:**

- The item the user is currently viewing is never displaced or dropped by a
  session rebuild, whatever triggers it (known or future).
- Both build branches (optimal and queue-list) get the same guarantee.
- The composed per-type counts of an optimal session stop shrinking mid-flight
  when documents are rated (cards promised by the session are delivered).
- The guarantee is pinned by three test layers, including one
  component-level test that fails for *any* future trigger.
- All new logic that can be pure **is** pure and unit-tested without mounting
  the 4400-line page.

**Non-Goals:**

- Identifying or eliminating specific dependency-churn triggers (sync reload
  coalescing, store subscriber hygiene). Defense is at the consumer.
- Changing `composeSession`'s anchor semantics or the greedy interleave
  itself — they are correct for *building* sessions; the problem is applying
  them to a session already in progress.
- Changing rating, scheduling (FSRS/Plethora Precision), or queue-list ordering behavior.
- Neural mode's refill path (already snapshot-restored) beyond ensuring the
  re-anchor helper is not applied against it.

## Decisions

### D1: Re-anchor by item id at the single write point (rather than guarding triggers or freezing lists)

Add one pure reconciliation step — `reanchorSessionPosition` in
`queueScrollSessionLifecycle.ts` — applied wherever the build effect calls
`setScrollItems`:

```
input:  currentItems, currentId (the item in view, from the OLD list),
        nextItems (the freshly built list)
output: { items, currentIndex }
  1. if nextItems contains currentId → { nextItems, indexOf(currentId) }
  2. else → re-insert the old current item at min(oldIndex, nextItems.length)
     → { reinserted, that index }
  3. if currentId is null (empty/initial state) → pass through unchanged
```

`currentIndex` and `renderedIndex` are set together (no transition, no
scroll reset — the item on screen does not change, so there is nothing to
animate).

*Why not the alternatives:*
- *Guard triggers:* enumerate and suppress dependency churn. Rejected —
  this bug exists because the Aug-8 fix guarded the triggers it knew about;
  churn sources are open-ended (16 deps, multiple stores, sync).
- *Freeze the list for the session lifetime (never rebuild):* rejected —
  legitimate mid-session updates (new due cards created from the very item
  being read, `setDueFlashcards(prev => [item, ...prev])`; settings changes;
  RSS reads) must still reach the session.
- *Key the render by item id only and let the index drift:* rejected —
  `renderedIndex`/`currentIndex` drive progress UI, smart-start persistence,
  and the horizon prefetch; a drifting index corrupts those.

### D2: Re-insertion keeps the current item; shrinking applies only to the unseen tail

When the recomposed session drops the current item (the `slice` tail case),
D1 step 2 re-inserts it at the current index. Items *behind* the user may
still be dropped by the shrink — that is correct: the composition is a plan
for what remains, and the user has already passed those positions. The
re-inserted item keeps its old scroll item object verbatim (its
`learningItem`/`extract` payload is not refetched).

### D3: Composition snapshot for the session lifetime (optimal branch)

The optimal branch computes `composeSession` once per *session* (first
successful build after mount / after the queue-list↔optimal mode changes),
storing the composed counts. Rebuilds re-run gating, top-ups, and the
interleave against the current pools **but keep the snapshot counts**
(clamped to availability so a genuinely emptied pool still shrinks). The
queue-list branch is a list replay and needs no snapshot.

*Why:* without this, D1/D2 alone would re-insert a tail card every rebuild —
correct but the session would keep its promises only by stitching. With the
snapshot, the rebuild naturally contains the card and re-insertion is the
rare safety net (pool emptied by external suspension/deletion).

*Why not snapshot the whole ordered list:* settings and source-list changes
must still be able to reshape the not-yet-reached part of a session.

### D4: Reveal state is bridged by id, not remount order

`FlashcardScrollItem` reports `onRevealChange`; the page holds
`flashcardRevealedRef`. After a rebuild where the current card survives, the
card remounts only if its `key` (`learningItem.id`) changed — it does not.
No action needed beyond asserting this in the component test (the reveal
flag must still be set when a rebuild lands mid-card). The stale-ref window
between "card B becomes current" and "card B's mount effect reports false"
(pre-existing, affects keyboard rating double-taps) is narrowed as a drive-by:
`handleFlashcardReveal(false)` is also called from the page when
`currentItem?.id` changes to a flashcard id different from the last reported
one.

### D5: Test layers mirror the failure's three strata

1. **Pure (`queueScrollReanchor.test.ts`)** — `reanchorSessionPosition`
   contract (survivor moves, dropped item re-inserts, null passthrough,
   boundary indices), plus two pinning tests documenting *why* it must exist:
   `composeSession` shrinks `N` when one document leaves availability, and
   the greedy interleave displaces the index-addressed item after a removal
   (the 11/11 property, deterministic seeds).
2. **Sequence (`queueScrollSessionLifecycle.test.ts`, extended)** — the
   existing effect-run simulation gains the exact regression sequence:
   build → lock → in-place advance → unlock-skip → **later dep flip** →
   reconcile → the current item is unchanged. Also asserts the unlock-skip
   itself still never rebuilds (today's guarantee, kept).
3. **Component (`QueueScrollPage.rebuild.test.tsx`)** — render with mocked
   stores/APIs; optimal session [epub, card, epub]; rate the epub; advance
   timers past the lock release; flip `documents` identity via a store
   reload; assert the rendered flashcard is unchanged and unrated, then rate
   the card and assert the *next* epub appears. Uses the mocking pattern of
   `src/components/review/__tests__/ReviewQueueView.test.tsx`.

### D6: Implementation shape inside the page

- The build effect's two `setScrollItems(mixedItems)`/`setScrollItems([...selected, ...extras])` call sites route through one local
  `applySessionItems(nextItems)` helper that runs D1 and sets
  `currentIndex`/`renderedIndex` together. `advanceAfterRemoval`,
  `goToNext`, and neural mode continue to bypass it (they own intentional
  advances).
- The snapshot from D3 lives in a `useRef` keyed by
  `${queueScrollMode}:${activeTabId}` so reopening a tab recomposes while
  an open tab keeps its counts; it is invalidated when the user explicitly
  rebuilds (settings change is allowed to re-snapshot — see Open Questions).

## Risks / Trade-offs

- [Re-inserted items keep stale payloads (an extract edited mid-session)]
  → Mitigation: re-insertion copies the object from the *old* list, same as
  today's in-place behavior; a later rebuild without the item in view picks
  up the fresh one. Documented in the helper's JSDoc.
- [Snapshot counts drift from settings sliders until session end]
  → Mitigation: intended (stability is the goal); settings modal is opened
  rarely and the empty-state "Reset Filters" path already rebuilds from
  scratch. Confirm in Open Questions.
- [Component test is brittle against the page's mock surface]
  → Mitigation: mock at the store/API boundary only (queueStore,
  documentStore, settings, `api/*` functions), never page internals; keep
  the scenario to three items so assertion failures are legible.
- [Performance: re-anchor is O(n) per rebuild]
  → Mitigation: rebuilds are already O(n log n)-ish (greedy interleave is
  O(n²) worst case — unchanged); one extra `indexOf` is noise. Bench gate
  unaffected.
- [Regression risk in queue-list branch from shared helper]
  → Mitigation: D5 layer 3 gains a queue-list variant scenario
  (customQueueItems + rate + reload) in the same test file.

## Migration Plan

Single PR, no data or API changes; behavior is internal to a Scroll Mode
tab. Rollback = revert the commit. The two pure "pinning" tests fail *red*
before the fix by design — they are added in the same PR as the fix and pass
together with it.

## Open Questions

- Should changing the composition sliders mid-session re-snapshot counts
  immediately (current design: yes — an explicit user act may reshape the
  unseen tail; the current item still cannot be displaced thanks to D1),
  or only on the next session? Lean yes-immediately; confirm during apply.
- Should the documents reload churn (the likely trigger) additionally be
  dampened at the source (e.g. skip `scheduleDocumentStoreReload` while a
  scroll tab is active and items are mid-session)? Out of scope here; file a
  follow-up if the component test shows reloads are frequent enough to
  matter for performance, not just correctness.
