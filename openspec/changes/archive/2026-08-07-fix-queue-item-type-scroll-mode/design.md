## Context

Two Queue defects, unrelated in cause but both surfacing on extracts.

**Flicker.** `useI18n()` in [src/lib/i18n/index.ts:103](../../../src/lib/i18n/index.ts#L103)
builds `translate` inline on every call, so `t` is a new reference on every
render. [ExtractReader](../../../src/components/tabs/ExtractReader.tsx#L39-L67)
has a load effect keyed on `[extractId, t]` whose body runs
`setLoading(true); setLoadError(null); setExtract(null)` then refetches. New `t`
each render → effect re-runs → state resets → re-render → new `t`. That is the
flicker: an unbounded load/blank/load loop with a real fetch in each turn.
Roughly 30 other hooks across the app list `t` in their dependency array;
[ExtractScrollItem:83-108](../../../src/components/review/ExtractScrollItem.tsx#L83-L108)
re-issues `generateProgressiveSummaries` on every render for the same reason.

**Item types stop at the Queue boundary.** The Queue computes
`effectiveItemTypes` and applies it when building `visibleItems`
([ReviewQueueView:427-451](../../../src/components/review/ReviewQueueView.tsx#L427-L451)).
Both Scroll Mode entry points then discard it:

- Sequential — `onOpenScrollMode({ items: visibleItems, mode: "queue-list" })`
  passes the filtered items, so the type selection survives by accident. But
  the rebuild in `QueueScrollPage` looks each extract up in `dueExtracts` and,
  on a miss, fabricates one whose `content` is `item.clozeText ??
  item.learningHint ?? ""` — `learningHint` is a bounded ~80-character preview
  in slim queue listings, so non-due extracts render truncated or blank.
- Optimal — `onOpenScrollMode({ mode: "optimal" })` passes no items at all.
  `QueueScrollPage` falls into its own builder, which derives documents from
  the unfiltered `allQueueItems` and pulls every due flashcard and every due
  extract. Filter the Queue to Extracts, press Start, get documents. That is
  the reported "it opens the source document".

Constraint: the Scroll Mode tab already carries `customQueueItems` and
`queueScrollMode` through `tab.data`, and that data survives tab close/reopen.
Item types belong in the same channel.

## Goals / Non-Goals

**Goals:**
- Extract reader opens once, no flicker.
- Both Scroll Mode entry points honour the Documents/Extracts/Flashcards
  selection, for every one of the eight combinations.
- Extract items in Scroll Mode render the extract's real content.

**Non-Goals:**
- Widening `MobileQueueView`'s reading tab, which is document-only today.
- The RSS/podcast composition rules, the flashcard-percentage budget, or
  `applyVarietyMixing`.
- The known i18n gap where a lazily-loaded locale dictionary does not trigger a
  re-render once it lands. Memoizing `t` per locale neither creates nor worsens
  it — `t` reads `dictionaries` at call time.

## Decisions

### Memoize `t` per locale rather than editing dependency arrays

`useCallback` on `translate`, keyed on `locale`. One edit in one file fixes
`ExtractReader`, `ExtractScrollItem`, and every other `[..., t]` dependency
array in the app.

*Alternative — drop `t` from `ExtractReader`'s deps.* Two-line diff, fixes the
one reported symptom and leaves ~30 sibling call sites holding the same
loaded gun. Rejected: same size, less coverage.

*Alternative — module-level `t` (already exported at
[index.ts:96](../../../src/lib/i18n/index.ts#L96)).* Would require touching
every call site and would not re-render on language change. Rejected.

### Pass item types through `tab.data`, not a store

`onOpenScrollMode` gains an `itemTypes` field; `QueueTab` writes it into the
scroll tab's `data` next to `customQueueItems`. This matches how sequential
mode already ships its payload, survives tab close/reopen with the rest of the
tab data, and keeps two Scroll Mode tabs from clobbering each other's session
shape — which a shared store slice would not.

*Alternative — read `settings.smartQueue.sessionItemTypes` directly inside
`QueueScrollPage`.* No plumbing at all, but that setting is only half the
truth: `effectiveItemTypes` also encodes the "user has not customized yet"
default that varies by filter mode, and it would tie every Scroll Mode tab to
the live setting rather than to the session it was launched from. Rejected.

### Filter the optimal builder at the source lists

In the optimal path, gate the three source collections before any budgeting
runs: `docItems` from `documentQueueItems`, `flashcardItems` from
`activeFlashcards`, `extractItems` from `activeExtracts`. Filtering upstream
keeps `splitReviewBudget` and `applyVarietyMixing` operating on real totals; a
post-hoc filter over `mixedItems` would leave the budget arithmetic computing
against items that are then thrown away.

Default when `itemTypes` is absent from tab data (a Scroll Mode tab opened by
some other route): all three true — current behaviour, so nothing else regresses.

### Resolve extract content by id in the sequential path

The sequential builder already has `getExtract(id)` available
([src/api/extracts.ts:94](../../../src/api/extracts.ts#L94)). For queue extracts
missing from `dueExtracts`, fetch them — the builder is already `async` and
already awaits (`getUnreadItemsAuto`, `getEpisodeQueue`). Fetch the misses in
one `Promise.all`, drop the ones that resolve to `null`.

*Alternative — keep the synthetic fallback but widen `learningHint`.* Pushes a
backend change to fix a frontend truncation, and still guesses. Rejected.

## Risks / Trade-offs

- **Extra fetches when opening sequential Scroll Mode on a long queue** → one
  batched `Promise.all` of misses only, on session build, not per scroll. Due
  extracts (the common case) still come from the in-memory map.
- **Memoized `t` masks a dictionary that loads after first paint** → unchanged
  from today in practice: `t` reads `dictionaries` at call time, and no
  re-render was triggered on dictionary load before this change either. Called
  out here so it is not mistaken for a regression introduced by memoization.
- **Empty session when the user unchecks all three types** → specified as the
  empty state, not a silent fallback to everything. A silent fallback is what
  the current bug already does, and it is what the user reported.
- **`itemTypes` absent on tabs restored from an older session** → the
  all-true default keeps them behaving exactly as before.

## Open Questions

None.
