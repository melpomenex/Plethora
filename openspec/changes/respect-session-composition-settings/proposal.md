## Why

The Optimal Session composition sliders (Documents / Extracts / Flashcards) are silently
overridden by a second, hidden control. `defaultSettings.smartQueue.sessionItemTypes`
ships as `{ documents: true, extracts: false, learningItems: false }`, and
`zeroUncheckedTargets` in `QueueScrollPage` forces the flashcard and extract targets to 0
whenever those toggles are off. A user who sets Flashcards to 50% therefore gets a
documents-only session, with nothing in the UI explaining why. Two controls claim
authority over the same decision, they disagree out of the box, and the invisible one wins.

## What Changes

- The composition sliders become the single source of truth for what an **Optimal Session**
  contains. A share above 0 means that type participates; a share of 0 means it is excluded.
- `zeroUncheckedTargets` is deleted. The optimal path gates its source pools on the
  composition shares instead of on `sessionItemTypes`.
- **BREAKING (behavioural)**: unchecking Flashcards in Customize Queue no longer removes
  flashcards from an Optimal Session — setting the Flashcards share to 0 does. The toggles
  keep governing the Queue list and the list-sourced ("Scroll Mode" button) session, which is
  a replay of the list the user is looking at.
- `defaultSettings.smartQueue.sessionItemTypes` defaults to all three types enabled, so the
  Queue list and the composition sliders agree for a new user instead of contradicting.
- The session's presentation order tracks the configured mix. The combined-criterion sort's
  proportion bias currently pulls toward a hardcoded 50/50 topic-vs-item alternation
  regardless of the sliders; it takes the configured ratio as its target instead, so a 60/40
  setting reads as 60/40 while scrolling rather than only in the totals.
- Scarcity is reported, not silently absorbed. When a type cannot fill its share (e.g. 40%
  flashcards but only 12 due), the session still honours the ratio it can and the Queue
  Settings panel says which type ran short.

## Capabilities

### New Capabilities

- `session-composition`: How the Documents / Extracts / Flashcards shares govern an Optimal
  Session — which types participate, how many of each, how the ordering reflects the mix,
  and what happens when a type cannot supply its share.

### Modified Capabilities

- `queue-item-type-routing`: The requirement "Queue item-type selection propagates into
  Scroll Mode" is narrowed to the queue-list entry point. The optimal entry point is
  governed by the composition shares, so its scenarios move to `session-composition`.

## Impact

- `src/pages/QueueScrollPage.tsx` — remove `zeroUncheckedTargets`; gate the optimal path's
  source pools on composition shares; pass the configured ratio into the ordering sort.
- `src/pages/queueScrollBudget.ts` — `composeSession` gains a shortfall report; core
  allocation arithmetic is unchanged.
- `src/utils/queueScrollOrder.ts` — `orderScrollItemsByCombinedCriterion` targets a
  configured topic/item ratio rather than parity.
- `src/stores/settingsStore.ts` — `sessionItemTypes` default flipped to all-enabled.
- `src/components/queue/ScrollQueueSettings.tsx` — shortfall note; "0% = excluded" hint.
- Tests: `src/pages/__tests__/queueScrollBudget.test.ts`,
  `src/pages/__tests__/queueScrollItemTypes.test.ts`,
  `src/components/review/__tests__/ReviewQueueView.test.tsx`.
- No database, API, or dependency changes.
