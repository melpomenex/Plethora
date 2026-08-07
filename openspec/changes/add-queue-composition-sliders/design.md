## Context

Scroll Mode assembles its session in one ~420-line effect,
`buildScrollItems`, in [QueueScrollPage.tsx](src/pages/QueueScrollPage.tsx). It has two
branches:

- **`queue-list` (sequential)** — entered from the Queue's purple "Scroll Mode" button, which passes
  `items: visibleItems` and `mode: "queue-list"`
  ([ReviewQueueView.tsx:1113](src/components/review/ReviewQueueView.tsx:1113)). It maps the source rows
  1:1 into `ScrollItem`s and **returns at [line 1055](src/pages/QueueScrollPage.tsx:1055)**, never
  reaching the budget code. `settings.scrollQueue.flashcardPercentage` is not read on this path at all.
- **`optimal`** — entered from "Start Optimal Session"
  ([ReviewQueueView.tsx:1029](src/components/review/ReviewQueueView.tsx:1029)). It reads the percentage
  and calls `splitReviewBudget`.

Two independent defects follow. The first is the reported one: the slider is inert on the sequential
path. The second is that even on the optimal path the percentage is a ratio against *available
non-review items* —
`targetFlashcardCount = pct × nonReview / (100 − pct)` — then clamped by `min(target,
availableFlashcards)`. Nothing ever removes documents, so the slider can only add flashcards, and a
document-heavy queue stays document-heavy at any setting. Extracts get a boolean and a hardcoded
`maxExtractsPerSession: 20` rather than a control of their own.

Constraint worth stating: the two source pools are wildly asymmetric in practice. On the reporting
machine there are 371 active documents, 1037 due flashcards, and 6 due extracts. Any composition rule
has to behave sanely when one type is ~2 orders of magnitude scarcer than another.

## Goals / Non-Goals

**Goals:**
- Three sliders whose numbers describe the session the user actually sees.
- One composition rule, applied identically on both entry points.
- Graceful degradation when a type cannot supply its share — redistribute, don't shrink to the scarcest
  type and don't silently ignore the slider.
- Pure, unit-testable arithmetic, kept out of the 4000-line component (the existing
  `queueScrollBudget.ts` / `queueScrollItemTypes.ts` precedent).

**Non-Goals:**
- No backend, DB, or Tauri-command changes; composition is frontend session assembly.
- No session-length setting. Session size stays derived, as it is today.
- No change to how items are *ordered* once chosen — `applyVarietyMixing` and the interleave loop stay
  as they are.
- No new controls for RSS or podcasts; they fold into the Documents share.

## Decisions

### Replace `splitReviewBudget` with a three-way `composeSession`

```ts
export interface CompositionInput {
  targets: { documents: number; extracts: number; flashcards: number };   // raw slider values
  available: { documents: number; extracts: number; flashcards: number };
}
export function composeSession(input: CompositionInput):
  { documents: number; extracts: number; flashcards: number };
```

Pure, no React, lives in `src/pages/queueScrollBudget.ts` (renamed conceptually, same file).
`splitReviewBudget` and its `extractsCountAsFlashcards` parameter are deleted rather than kept
alongside — nothing else calls it, and two overlapping budget rules is how the current confusion
started.

*Alternative considered:* keep `splitReviewBudget` and add a document cap next to it. Rejected —
the defect is that documents were never part of the budget, so the budget has to become three-way at
its core, not gain a satellite.

### Session size is anchored on documents

Targets alone do not determine how many items a session holds. Given normalized weights `w` and
availability `a`, the session size is:

```
N = a.documents / w.documents
```

then `c_i = min(a_i, w_i × N)`, with any shortfall redistributed (below).

Documents anchor because they are the reading queue's backbone and effectively bounded (371 here),
whereas due flashcards are near-unbounded (1037) — anchoring on flashcards would produce 1000-item
sessions whenever the user nudged the slider. This also matches what the current code already does
implicitly: `pct × nonReview / (100 − pct)` is anchored on the non-review count.

Fallbacks: if `w.documents == 0` or `a.documents == 0`, anchor on whichever remaining type has the
largest target with items available. If no type is active, `N = 0` and Scroll Mode shows its empty
state.

*Alternatives considered:* `N = min(a_i / w_i)` gives exact proportions but lets the scarcest type
cap the session — 6 due extracts at a 20% target would produce a 30-item session. `N = Σa_i` takes
everything and reduces the mix to whatever availability dictates, which is the bug being fixed.

### Shortfall redistribution, proportional and iterated

When `c_i` is clamped by `a_i`, the unusable remainder is reallocated to the types that still have
headroom, in proportion to their own targets. Repeat until nothing moves or every type is exhausted;
this terminates in at most three passes since each pass exhausts at least one type.

Worked example — targets 40/20/40 against `a = {371, 6, 1037}`: `N = 371/0.4 = 928`; first pass gives
`{371, 6, 371}` (Σ 748) with 180 unusable extract slots; those go 50/50 to documents (already capped,
so its 90 moves on) and flashcards, landing at `{371, 6, 551}` — Σ 928, the session did not shrink and
every available extract is shown.

Rounding uses largest-remainder against `N` so the counts sum exactly and a 1-item type is never
rounded out of existence.

### The sequential path composes, and tops up from the due pools

The `queue-list` branch stops returning early. It partitions its mapped rows by type into three pools,
then calls the same `composeSession`. Where a pool cannot meet its target, it is topped up from
`dueFlashcards` / `dueExtracts` / `documentQueueItems` — the same pools the optimal path uses —
deduplicated by item id, with the source rows always taking priority within their own type. This is
what makes "reading queue + Flashcards at 55%" produce flashcards.

The semantic-cluster path (`customSubset`) is deliberately exempt from top-up: a cluster is an explicit
content boundary, so composition governs counts within the cluster but never introduces items from
outside it.

*Alternative considered:* fix only the sequential path's early return and leave the optimal path's
percentage math alone. Rejected — the two entry points would then disagree about what the same slider
means, and the optimal path's inability to remove documents is half the reported symptom.

### RSS and podcast items count toward Documents

`a.documents` = documents + RSS articles + podcast episodes, and the document share is filled from the
combined pool in the existing priority order. Otherwise enabling RSS-in-queue would quietly dilute the
flashcard share the user just asked for. The per-feed `maxItemsPerSession` limits still apply upstream.

### Settings migration in the existing merge

`ScrollQueueSettings` gains `composition: { documents: number; extracts: number; flashcards: number }`
and loses `flashcardPercentage` / `extractsCountAsFlashcards`. Default: `{ documents: 60, extracts: 15,
flashcards: 25 }` — close to today's effective behaviour at the 30% default.

Migration happens where persisted settings are already merged
([settingsStore.ts:1007](src/stores/settingsStore.ts:1007)): when `composition` is absent and
`flashcardPercentage` is present, map `flashcards = flashcardPercentage`, split the remainder into
documents and extracts using the old `extractsCountAsFlashcards` flag as the hint (true → extracts take
a slice of the flashcard share; false → extracts get a small fixed share). No migration record is
needed — the values are local UI preferences, not data.

## Risks / Trade-offs

- **A small document pool shrinks the session.** With 5 documents and Documents at 45%, the anchor
  yields an 11-item session even though 1037 flashcards are due. → Acceptable: it honours the mix the
  user asked for, and the user can raise the Flashcards slider. If it proves annoying, a minimum
  session size is a one-line addition to `composeSession`; deliberately deferred rather than guessed at.
- **Documents are privileged in a symmetric-looking UI.** Three equal sliders, but one of them
  determines session length. → Documented in the design and invisible in normal use; the alternatives
  (scarcest-type anchor, take-everything) are both worse in the observed data.
- **The sequential path stops being purely sequential.** Users who expect "Scroll Mode = exactly my
  queue list, in order" will now see topped-up flashcards. → This is the requested behaviour; relative
  order of the source rows is preserved, and setting Flashcards and Extracts to 0 restores the old
  document-only sequential feel exactly.
- **Removing the 20-extract cap could surface a large extract session.** → Only if the user's slider
  asks for it; availability here is 6.
- **Migration of a 0% saved value.** `flashcardPercentage: 0` must not migrate into an all-zero
  composition that renders an empty session. → Migration maps 0 to `flashcards: 0` with documents
  keeping the full remainder; covered by a unit test.

## Migration Plan

Settings-only, forward-migrating on load, no rollback path needed. Reverting the code reverts to the
old fields; a persisted `composition` is ignored by old code, which falls back to its own defaults.

## Open Questions

- Should the three sliders be normalized-on-drag (moving one adjusts the others to keep the sum at
  100) or free (independent, normalized at read time)? The spec assumes **free** — simpler to
  implement, no surprising slider movement — but constrained sliders read as more honest to some users.
  Free is the working assumption; changing it later touches only
  [ScrollQueueSettings.tsx](src/components/queue/ScrollQueueSettings.tsx).
