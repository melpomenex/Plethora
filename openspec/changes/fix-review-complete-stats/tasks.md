## 1. Session clock

- [x] 1.1 Add `sessionStartedAt` to `reviewStore` (set once in `loadQueue`/`startReviewWithQueue`/`studyDocumentCards`, cleared in `resetSession`, untouched by `submitRating`/`nextCard`/`goToIndex`) and verify existing `sessionStartTime` per-card behavior and tests still pass
- [x] 1.2 Pass `sessionStartedAt` (fallback to `sessionStartTime`) into `ReviewComplete` from both `ReviewSession.tsx` and `routes/review.tsx` and verify the Complete screen receives a start timestamp predating the last rating

## 2. ReviewComplete display fixes

- [x] 2.1 Add `formatSessionDuration(ms)` helper and rewire Duration + per-card average to unrounded `durationMs` (seconds <1m, `Mm Ss` / `Hh Mm` above) and verify a 13-card multi-minute session no longer renders `0m` / `0s per card`
- [x] 2.2 Render the Scheduled line via `formatArenaInterval(intervalDays, locale)` and verify `0.000038…` days renders as `1 min` and multi-day intervals render as days, with no raw float in output

## 3. Verification

- [x] 3.1 Add/extend unit tests for the duration formatter, the session-clock (start preserved across `submitRating`), and interval formatting (sub-hour Again step, multi-day Good step) and verify `npm run test` (or targeted vitest) passes
- [ ] 3.2 Run `openspec validate --change fix-review-complete-stats` and verify no errors; manually complete a 2+ card review and verify Duration shows real time and the Scheduled line shows a human interval
