## Why

On the Review Home screen, the deck list (left/decks panel) shows a single "X due" badge per deck, and it frequently reads **0 due** even when a deck holds many cards — because the badge is computed only from the currently-due item set (`dueItems`), never from a deck's total card population. Users can't tell whether "0 due" means "empty deck," "fully caught up," or "stats failed to load," and they get no sense of a deck's size, composition (new/learning/review), or health at a glance. This makes deck selection and prioritization guesswork.

## What Changes

- Replace the single "X due" badge per deck with a richer per-deck stats summary: **total cards**, **due now**, and a **new/learning/review** breakdown, following the visual pattern already established in [DeckStatsPanel.tsx](src/components/review/DeckStatsPanel.tsx) (segmented progress bar + compact stat badges).
- Source deck stats from the full learning-item set (via `getAllLearningItems`, already used by [DeckManager.tsx](src/components/review/DeckManager.tsx)) instead of only the due-item set, so counts are accurate even when nothing is due.
- Distinguish, in the UI, "0 due, N cards" (caught up) from "0 cards" (empty deck) so the state is never ambiguous.
- Add a lightweight loading/error affordance for deck stats independent of the due-items fetch, so a stats-fetch failure doesn't silently render as "0".
- Keep the existing due-badge chips (line ~321-333) and `ReviewDecksModal` picker in sync with the same richer stats data.

## Capabilities

### New Capabilities
- `review-home-deck-stats`: Defines how per-deck card totals, due counts, and state breakdowns are computed and displayed on the Review Home deck list and deck picker modal.

### Modified Capabilities
(none — no existing archived spec currently covers Review Home deck list behavior)

## Impact

- Affected code: [ReviewHome.tsx](src/components/review/ReviewHome.tsx) (`deckStats` memo and deck-list JSX), [ReviewDecksModal.tsx](src/components/review/ReviewDecksModal.tsx) (deck badge rendering, `totalDueCount`), [studyDecks.ts](src/utils/studyDecks.ts) (deck matching helpers, reused for the fuller item set).
- New data dependency: `getAllLearningItems()` from [learning-items.ts](src/api/learning-items.ts) is fetched on Review Home (in addition to `getDueItems`), so this adds one more IPC call on load/refresh — should be debounced/cached alongside the existing due-items refresh triggers (sync events, tab activation).
- No backend/Rust changes required; no new Tauri commands.
- No breaking changes to existing stores or APIs.
