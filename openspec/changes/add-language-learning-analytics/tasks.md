## 0. Dependency gates

Requires #1/#3/#4. Stabilize metric IDs, event semantics, aggregate freshness, and generic-analytics compatibility before #10, #11, #19, #20, and #22 add producers.

## 1. Metric and storage design

- [ ] 1.1 Define versioned metric catalog and formulas for vocabulary, exposure, activity, lookup, state movement, coverage, difficulty, and active/passive evidence.
- [ ] 1.2 Add profile-scoped daily/hourly aggregate tables, indexes, event cursors, freshness, formula version, and retention migration.
- [ ] 1.3 Add idempotent background aggregation/backfill with bounded recomputation and cancellation.

## 2. Data/API integration

- [ ] 2.1 Ingest lexicon/state/reader/listening/review events without counting cache re-renders.
- [ ] 2.2 Add optional adapters for coverage, SRS retention, shadowing, dictation, and writing evidence.
- [ ] 2.3 Extend Rust analytics commands, TS API/store, filters, date ranges, export/delete controls, and i18n.

## 3. Dashboard and verification

- [ ] 3.1 Add language profile analytics views with denominator/freshness/unknown states and per-document breakdowns.
- [ ] 3.2 Unit-test metric formulas, profile isolation, active/passive evidence, stale coverage, and retention.
- [ ] 3.3 Regression-test generic analytics, Queue/review behavior, offline use, and large-history performance.
