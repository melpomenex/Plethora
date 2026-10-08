## Why

The Review Complete screen reports wrong summary stats: a 13-card session shows `0m` duration (and `0s per card`), and the "Scheduled" panel prints a raw fractional-day value (`Next review in 0.00003827570253633894 days`). Both erode trust in scheduling right after a review session.

## What Changes

- Fix session duration on the Review Complete screen so it measures the whole session (load → finish), never `0m` for a real session:
  - Preserve a session-start timestamp across per-card advances (`submitRating`, `nextCard`, `goToIndex` currently reset `sessionStartTime` per card).
  - Render human duration: seconds when < 1 min (e.g. `45s`), `Xm Ys` / `Xh Ym` above; per-card average derived from unrounded milliseconds.
- Fix the "Scheduled / Next review" line so it never prints a raw float:
  - Format `intervalDays` via the existing human-interval formatter (minutes → hours → days → weeks, locale-aware, e.g. `formatArenaInterval`).
  - Handle sub-hour Again/relearning steps (minutes) and sub-minute edge cases without `0.0000… days`.
- Keep accuracy / correct / needs-review counts unchanged.

## Capabilities

### New Capabilities

- `review-complete-summary`: Review Complete screen summary stats — whole-session duration, per-card average, and human-formatted next-review interval for the last graded card.

### Modified Capabilities

<!-- None — completion-summary behavior is not covered by any existing spec (flashcard-review-session covers queue membership only). -->

## Impact

- Affected code: `src/components/review/ReviewComplete.tsx` (duration math, interval rendering), `src/stores/reviewStore.ts` (`sessionStartTime` reset per card in `submitRating`/`nextCard`/`goToIndex`, `lastReviewOutcome.intervalDays` passthrough), `src/routes/review.tsx` + `src/components/review/ReviewSession.tsx` (both render `ReviewComplete`), i18n `reviewComplete.*` keys.
- Reuses existing `formatArenaInterval` (`src/components/review/arenaFormatters.ts`) for interval display; no new dependencies.
- No API/backend change: `submitReview` already returns the correct `interval` (days, float); this is display + session-clock only.
