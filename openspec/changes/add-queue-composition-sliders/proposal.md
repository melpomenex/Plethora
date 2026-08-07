## Why

The Scroll Mode "Queue Settings" flashcard slider is inert on the path most users take. The
purple **Scroll Mode** button in the Queue opens the tab with `mode: "queue-list"`
([ReviewQueueView.tsx:1113](src/components/review/ReviewQueueView.tsx:1113)), and that path returns
from the session builder at [QueueScrollPage.tsx:1055](src/pages/QueueScrollPage.tsx:1055) — before
`settings.scrollQueue.flashcardPercentage` is ever read. The session is whatever rows the Queue list
happened to show, so setting the slider to 55% changes nothing and a reading-mode queue yields zero
flashcards. On this machine that is 1037 due flashcards that never surface.

Even on the "Start Optimal Session" path where the slider *is* read, it does not mean what the label
says. `targetFlashcardCount = pct × nonReview / (100 − pct)` is a target derived from however many
documents/RSS/podcast items exist, then silently clamped by `min(target, availableFlashcards)`. There
is no downward pressure on documents, so a document-heavy queue stays document-heavy at any
percentage. Extracts have no control of their own at all: one boolean decides whether they eat the
flashcard budget, under a hardcoded `maxExtractsPerSession: 20`
([QueueScrollPage.tsx:1307](src/pages/QueueScrollPage.tsx:1307)).

## What Changes

- Replace the single Flashcard Percentage slider and the "Extracts count as flashcards" toggle with
  **three sliders — Documents, Extracts, Flashcards** — expressing the target share of the session.
- Make the sliders mean *share of the session the user actually sees*: the composition targets are
  applied to the assembled session, so raising Flashcards to 55% removes documents rather than only
  adding flashcards that availability may not supply.
- Apply composition on **both** Scroll Mode entry points. The `queue-list` path stops short-circuiting
  past the budget step; it composes from the same due-flashcard and due-extract pools the optimal path
  uses, so a reading-mode queue can still reach its flashcard target.
- Redistribute shares that cannot be filled. If a type is exhausted (6 extracts exist, 20% asked for),
  its unusable share goes to the remaining types instead of shrinking the session.
- Retire the hardcoded 20-extract session cap — the Extracts slider is now the control.
- Keep the Queue's item-type toggles authoritative: a type that is unchecked contributes nothing and
  its share is redistributed, regardless of slider position.
- **BREAKING** (settings shape): `scrollQueue.flashcardPercentage` and
  `scrollQueue.extractsCountAsFlashcards` are replaced by `scrollQueue.composition`
  (`{documents, extracts, flashcards}`). Persisted values migrate on load; no user action needed.

## Capabilities

### New Capabilities
- `queue-composition-mix`: How Scroll Mode sizes and mixes documents, extracts and flashcards from
  the user's three composition targets — normalization, redistribution of unfillable shares,
  interaction with availability, and applying to both entry points.

### Modified Capabilities
- `queue-item-type-routing`: the "All three types selected" scenario currently defers to "the existing
  flashcard-percentage and extract-budget settings"; it now defers to the composition targets. The
  requirement that unchecked types contribute nothing is unchanged but gains a redistribution clause.

## Impact

- [src/stores/settingsStore.ts](src/stores/settingsStore.ts) — `ScrollQueueSettings` shape, defaults,
  and the persisted-settings merge at line 1007 (migration from the two old fields).
- [src/pages/queueScrollBudget.ts](src/pages/queueScrollBudget.ts) — `splitReviewBudget` is replaced by
  a three-way composition function; its [tests](src/pages/__tests__/queueScrollBudget.test.ts) and
  [bench](src/pages/queueScrollBudget.bench.ts) are rewritten against the new signature.
- [src/pages/QueueScrollPage.tsx](src/pages/QueueScrollPage.tsx) — both branches of `buildScrollItems`
  (the `queue-list` early return and the optimal path's percentage math).
- [src/components/queue/ScrollQueueSettings.tsx](src/components/queue/ScrollQueueSettings.tsx) — three
  sliders in place of one slider and one toggle.
- i18n: new slider labels across all six locales in [src/lib/i18n/locales](src/lib/i18n/locales).
- No backend, DB, or Tauri-command changes — this is entirely frontend session assembly.
