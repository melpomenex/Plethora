## Why

Opening an extract from the Queue flickers: it loads, blanks, and reloads in a
loop. And the Queue's item-type selection (Documents / Extracts / Flashcards)
does not reach Scroll Mode — "Start Optimal Session" rebuilds its own mix from
every document, flashcard, extract, RSS item and podcast episode, so a user who
filtered the Queue down to Extracts is handed source documents instead. The
item-type toggles are the primary way users shape a session; today they stop
working the moment the session actually starts.

## What Changes

- Fix the extract reader flicker at its root: `useI18n()` returns a brand-new
  `t` on every render, so every effect that lists `t` in its dependency array
  re-runs on every render. In `ExtractReader` that effect resets the extract to
  `null` and refetches, producing an endless load → blank → load cycle. `t`
  becomes referentially stable per locale, which also stops
  `ExtractScrollItem` from re-firing progressive-summary generation on every
  render.
- Carry the Queue's effective item types (`documents`, `extracts`,
  `learningItems`) into the Scroll Mode tab alongside the existing
  `customQueueItems` / `queueScrollMode` tab data.
- Make optimal Scroll Mode honour those item types: an unchecked type
  contributes no items to the mix. Any combination works — Extracts only,
  Extracts + Documents, Flashcards + Documents, all three.
- Extract items in sequential Scroll Mode render the extract's real content.
  Today a queue extract that is not in the due-extract set falls back to a
  synthetic extract built from `learningHint` (an ~80-character preview) or an
  empty string, so the card renders truncated or blank.
- Non-typed queue sources (RSS articles, podcast episodes) keep their existing
  settings-driven behaviour and are unaffected by the three toggles, matching
  how the Queue list itself already treats them.

## Capabilities

### New Capabilities
- `queue-item-type-routing`: which item types a Queue session contains, and how
  the Queue's Documents/Extracts/Flashcards selection propagates into both
  sequential and optimal Scroll Mode, including how each type is rendered.
- `extract-reader-stability`: opening an extract from the Queue loads its
  content exactly once and holds it, with no reload loop.

### Modified Capabilities
<!-- None: no existing spec in openspec/specs/ covers queue item-type selection,
     Scroll Mode session composition, or the extract reader. -->

## Impact

- `src/lib/i18n/index.ts` — `useI18n` returns a memoized `t` (fixes ~30 call
  sites that list `t` in a hook dependency array).
- `src/components/review/ReviewQueueView.tsx` — pass `effectiveItemTypes` when
  invoking `onOpenScrollMode` from both the Scroll Mode button and
  `handleStartOptimalSession`.
- `src/components/tabs/QueueTab.tsx` — widen the `onOpenScrollMode` options and
  store item types in the scroll tab's `data`.
- `src/pages/QueueScrollPage.tsx` — read item types from tab data; apply them in
  the optimal build path; resolve real extract content in the sequential path.
- `src/components/mobile/MobileQueueView.tsx` — same `onOpenScrollMode`
  signature; its reading tab is document-only today and is not being widened
  here.
- No backend, database, or API changes.
