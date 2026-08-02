## Context

Review Home (`src/components/review/ReviewHome.tsx`) shows a "Decks" panel where each deck renders as a clickable card with a single badge: `{t("reviewHome.countDue", { count })}`. `count` comes from a `deckStats` memo (lines 188-193) that filters `dueItems` — the output of `getDueItems(activeCollectionId)`, a due-only fetch (`src-tauri/src/database/repository.rs` `get_due_learning_items`). No total-card or state-breakdown data is fetched at all, so a deck with 200 cards and none currently due looks identical to an empty deck: both show "0 due".

The codebase already solves the harder version of this problem in `DeckManager.tsx` + `DeckStatsPanel.tsx`, which fetch `getAllLearningItems()` (`src/api/learning-items.ts`) once and compute new/learning/review/relearning counts, young/mature split, leech count, and a retention estimate, rendered as a segmented progress bar with `StatRow` badges. That fetch and computation pattern is reused here rather than re-invented.

## Goals / Non-Goals

**Goals:**
- Every deck row on Review Home shows total card count and due-now count, unambiguously distinguishing "empty deck" from "caught up".
- Add a compact new/learning/review breakdown per deck, visually consistent with `DeckStatsPanel`'s existing segmented-bar language.
- Keep `ReviewDecksModal` (the deck-picker) showing the same numbers so the two surfaces never disagree.
- No new Tauri/Rust commands; reuse `getAllLearningItems` and existing deck-matching utilities (`src/utils/studyDecks.ts`).

**Non-Goals:**
- No deck-level persisted stats table or backend aggregation query — computation stays client-side, matching the existing `DeckManager` approach.
- No change to how due items are computed/scheduled (FSRS logic untouched).
- No redesign of `DeckStatsPanel`'s full detail view (leeches, retention, algorithm breakdown) — Review Home gets a *summary* only; users needing full detail still go to Deck Manager.
- Not addressing performance of very large collections (tens of thousands of cards) beyond what `DeckManager` already tolerates today.

## Decisions

- **Reuse `getAllLearningItems()` instead of adding a new aggregate command.** `DeckManager` already fetches this full list client-side and it performs acceptably there; adding a bespoke `get_deck_stats` Rust command would duplicate deck-matching logic (which is inherently client-side via tag filters in `studyDecks.ts`) on the backend for no clear win. Alternative considered: a SQL `GROUP BY` aggregate command — rejected because deck membership is a client-side smart-filter concept (tags/doc/difficulty), not a DB column, so the backend can't group by deck without re-implementing `matchesDeck`.
- **Fetch the full item list once per Review Home mount/refresh cycle, alongside the existing `getDueItems` call**, reusing the same debounce triggers (sync events, tab activation, collection switch) already wired at lines 130-157. Alternative considered: fetch lazily per-deck on hover/expand — rejected as unnecessary complexity for a list that's typically a handful of decks.
- **Extend the `deckStats` memo shape** from `{ deck, count }` to `{ deck, total, due, new, learning, review }`, computed via one pass over `allItems` per deck (using existing `matchesDeck`). Both `ReviewHome`'s deck list and `ReviewDecksModal` consume the same extended shape (passed as a prop, as today).
- **Visual treatment**: keep the existing card/button layout for each deck row; replace the single due badge with a two-line summary — a primary "N due · M cards" line, plus a thin 3-segment horizontal bar (new/learning/review, matching `DeckStatsPanel`'s color convention) beneath it. Empty decks (`total === 0`) render a muted "No cards yet" state instead of "0 due" to remove ambiguity.
- **Loading/error state**: track the `getAllLearningItems` fetch's own `isLoading`/`error` independent of the due-items fetch, so a stats-fetch failure shows a distinct inline notice on the deck panel rather than rendering misleading zeros.

## Risks / Trade-offs

- [Extra IPC call on every Review Home refresh] → Mitigated by sharing the same debounce/refresh triggers already in place for `getDueItems`, and by only computing `deckStats` via `useMemo` off the fetched arrays (no extra fetches per deck).
- [Large collections could make the per-deck full-array scan (`allItems.filter(matchesDeck)` × N decks) noticeably slower than the current due-only scan] → Acceptable since `DeckManager` already performs an equivalent or heavier computation (multiple derived stats) over the same data; can revisit with memoized per-item deck-tag indexing if profiling shows an issue.
- [Two data sources (`dueItems`, `allItems`) must stay consistent] → Both are refreshed by the same effect/trigger set, and `dueItems` becomes redundant for due-count purposes once `allItems` is available (due count can be derived from `allItems` by due-date filtering, matching `DeckStatsPanel`'s own `dueToday` calculation) — reduces divergence risk rather than adding it.

## Open Questions

- Should `ReviewHome` drop its separate `getDueItems` call entirely once `allItems` is fetched (deriving due-today from `allItems` the way `DeckStatsPanel` does), or keep both fetches for now to minimize blast radius? Leaning toward keeping `getDueItems` for the top-level "due today" hero stats (unchanged behavior) and adding `allItems` only for the deck list, to keep this change narrowly scoped.
