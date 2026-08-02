## 1. Data layer

- [x] 1.1 In `ReviewHome.tsx`, add an `allItems` state fetched via `getAllLearningItems()` (from `src/api/learning-items.ts`), loaded alongside the existing `getDueItems` call in `loadStats()`.
- [x] 1.2 Wire the same refresh triggers already used for due items (tab-active effect, collection change, `incrementum:synced-card`/`-deleted` events) to also refresh `allItems`.
- [x] 1.3 Track a separate `isStatsLoading`/`statsError` pair for the `allItems` fetch so its failure state is distinguishable from the due-items failure state.

## 2. Stats computation

- [x] 2.1 Extend the `deckStats` memo in `ReviewHome.tsx` to compute, per deck, `{ deck, total, due, newCount, learningCount, reviewCount }` by running `matchesDeck` (from `src/utils/studyDecks.ts`) over `allItems` once per deck.
- [x] 2.2 Derive `due` per deck using the same due-date comparison logic already used for `dueToday` (today-or-earlier `due_date`), so due counts stay consistent with the hero "due today" stat.
- [x] 2.3 Classify each matched item's state (new/learning+relearning/review) reusing the same state-name mapping conventions as `DeckStatsPanel.tsx`.

## 3. Deck list UI (ReviewHome)

- [x] 3.1 Replace the single `{t("reviewHome.countDue", { count })}` badge (around `ReviewHome.tsx:434`) with a two-part summary: "N due · M cards".
- [x] 3.2 Add a thin segmented bar (new/learning/review) beneath each deck row, matching `DeckStatsPanel.tsx`'s existing color/segment convention (lines ~273-289).
- [x] 3.3 Render an explicit empty-state ("No cards yet") for decks where `total === 0`, instead of "0 due".
- [x] 3.4 Render an inline error/loading affordance on the deck panel when `statsError`/`isStatsLoading` is set, distinct from normal zero-count rendering.
- [x] 3.5 Add/update i18n strings for the new due/total copy and empty-state copy (check `t("reviewHome.countDue", ...)` usages and any locale files that define it).

## 4. Deck picker modal (ReviewDecksModal)

- [x] 4.1 Update `ReviewDecksModal.tsx` to accept and render the extended `deckStats` shape (total/due/breakdown) instead of just `count`.
- [x] 4.2 Update the modal's `totalDueCount` aggregate (around line 74-76) if its computation depends on the old `count` field shape.

## 5. Testing

- [x] 5.1 Add/update a test covering: deck with cards but none due shows non-zero total and "0 due" (not empty state).
- [x] 5.2 Add/update a test covering: deck with zero matching cards shows the empty-deck state.
- [x] 5.3 Add/update a test covering: deck list and `ReviewDecksModal` render identical totals for the same deck data.
- [x] 5.4 Add/update a test covering: stats fetch failure renders an error indicator, not zero counts.

## 6. Manual verification

- [x] 6.1 Run the app, open Review Home, and confirm a deck with un-due cards no longer shows "0 due" without context. (Covered by automated test in `ReviewHome.deckStats.test.tsx`; no due-but-populated cards were seedable via the dev UI to check visually.)
- [x] 6.2 Confirm the deck picker modal and deck list panel show matching numbers. (Verified live: both panels showed "No cards yet" for the same test deck.)
- [x] 6.3 Confirm behavior with an actually-empty deck (freshly created, no matching tags) still reads clearly as empty. (Verified live in the dev app: a freshly created deck shows "No cards yet".)
