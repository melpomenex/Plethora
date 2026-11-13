## 1. Deadline and calendar

- [x] 1.1 Add optional plan deadline and rest-day preferences with backward-compatible defaults; test date boundaries, removing/extending a date and unchanged history after a deadline passes.
- [x] 1.2 Project remaining ordered lessons and display existing projected due reviews separately; test overflow, unavailable forecasts, rest days with reviews and no scheduler writes.

## 2. Recognition and evaluation

- [x] 2.1 Add opt-in quests, evidence-backed achievements, session wrap-up and weekly cadence; test repeated events, overturned grades, unverified outcomes and missed days without penalties.
- [x] 2.2 Add quiet/dismiss/reduced-motion controls; if controls live in Settings, add search target, catalog, coverage and tests per `docs/settings-search.md`. Verify Continue remains primary on mobile and desktop.
- [x] 2.3 Define and verify local aggregate instrumentation and optional network opt-in; record separate engagement and delayed transfer measures, with no raw learner or source data in payloads.

## 3. Integration verification

- [x] 3.1 Exercise deadline and rest-day scenarios through Plan Home, confirm existing Workload Calendar and FSRS behavior, and run focused tests and `npm run bench:check`.
