## Context

See proposal.md Why. Current state (verified in code):

- `ReviewComplete.tsx:43` computes `duration = Math.round((Date.now() - sessionStartTime) / 1000 / 60)` (whole minutes) and `secondsPerCard` from that rounded value (`:178`), so any session tail < 30s renders `0m` / `0s per card`.
- `reviewStore.ts` resets `sessionStartTime: Date.now()` on every `submitRating` (`:542`), `nextCard` (`:719,:731`), `goToIndex` (`:752,:767`), and per-card navigation — so by the time the queue empties, `sessionStartTime` is the last card's rating time, not the session start. Both `ReviewSession.tsx:797` and `routes/review.tsx:388` pass this per-card timestamp straight into `ReviewComplete`.
- `ReviewComplete.tsx:116` interpolates `lastReviewOutcome.intervalDays` (raw float days from `submitReview`, via `reviewStore.ts:549-554`) directly into `Next review in {x} days`. An Again/relearning step of ~3 seconds arrives as `0.000038…` days and is printed verbatim.
- `formatArenaInterval(days, locale)` in `src/components/review/arenaFormatters.ts` already does locale-aware minute → hour → day → week → month → year formatting with a `max(1, round(minutes))` floor; `useI18n` provides `locale`.

## Goals / Non-Goals

**Goals:**
- Whole-session elapsed clock that survives per-card advances, with a duration formatter that never shows `0m` for a real session.
- Interval line that reuses the existing formatter so `Again` steps read as minutes.
- No backend/API change; both render paths (`ReviewSession`, legacy `routes/review.tsx`) fixed together.

**Non-Goals:**
- Redefining what "next review" means (still the last graded card's outcome; session-earliest-due aggregation is out of scope).
- Changing accuracy / correct / streak / badge logic.
- New i18n copy beyond reusing existing keys + formatter output.

## Decisions

### 1. Add `sessionStartedAt` (session clock) alongside per-card `sessionStartTime`

- Keep `sessionStartTime` semantics for existing consumers (`useBreakReminder(sessionStartTime, 30)`, `recallTimeTaken`, `averageTimePerCard` accumulation) to avoid behavior drift; add a separate `sessionStartedAt: number` set once in `loadQueue` / `startReviewWithQueue` / `studyDocumentCards` and cleared in `resetSession`, never touched by `submitRating` / `nextCard` / `goToIndex`.
- Pass `sessionStartedAt` (fallback to `sessionStartTime` when 0/legacy) into `ReviewComplete` as the duration basis.
- Alternative considered: stop resetting `sessionStartTime` per card — rejected because `timeTaken = Date.now() - sessionStartTime` (`reviewStore.ts:424-425`) deliberately measures per-card recall time for `averageTimePerCard` and the backend `timeTaken`; changing it would corrupt grading telemetry.

### 2. Duration + average from unrounded milliseconds in `ReviewComplete`

- Compute `durationMs = max(0, Date.now() - sessionStartedAt)` once; derive display via a small `formatSessionDuration(ms)` helper: `<60s → "Ns"`; `<60m → "Mm Ss"` (omit `0s` when exact minutes); otherwise `"Hh Mm"`.
- Per-card average = `round(durationMs / 1000 / max(1, reviewsCompleted))`, displayed via existing `reviewComplete.secondsPerCard`; `≥60s` averages reuse the same duration helper for consistency.
- Alternative considered: minutes-with-one-decimal — rejected; seconds resolution is clearer for short sessions and matches the existing `secondsPerCard` key.

### 3. Reuse `formatArenaInterval` for the Scheduled line

- Replace the raw interpolation with `Next review in {formatArenaInterval(intervalDays, locale)}`; guard non-finite/≤0 as `—` (formatter already does). `formatArenaInterval` floors sub-hour to `max(1, round(minutes))`, so the reported `0.000038d` case becomes `1 min`.
- Label stays "Scheduled / Next review in …" for the last graded card (with the Again/Hard/Good/Easy badge); no semantic change, display-only.
- Alternative considered: `formatInterval` from `scheduleItemPresentation.ts` — rejected; it bottoms out at `<1h` with no minute resolution, which is exactly the Again-step range we must display.

## Risks / Trade-offs

- [Risk] Legacy sessions / stored state with `sessionStartedAt = 0` → Mitigation: fallback to `sessionStartTime`; duration degrades to current behavior only for pre-change in-flight sessions.
- [Risk] `Date.now()` in render drifts while the Complete screen sits open → Mitigation: compute once per mount (existing `durationMs` pattern) or memo on props; a live ticking clock is out of scope.
- [Risk] Locale formatting snapshot differences in tests (`Intl` unit style) → Mitigation: unit-test the pure helpers (`formatSessionDuration`, interval wiring) with a fixed locale, plus a component test asserting no raw-float output.

## Migration Plan

- Frontend-only, no data migration. Ship behind no flag (pure bugfix); rollback = revert the three files. No API contract change (`intervalDays` float passthrough unchanged).
