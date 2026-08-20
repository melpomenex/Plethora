## 0. Dependency gates

Requires #1–#4/#10 and existing import/search contracts. Coordinate with `recommendation-engine`, RSS/YouTube/podcast imports, and Queue owners before implementing shared candidate or ranking files.

## 1. Candidate and ranking model

- [ ] 1.1 Define candidate lifecycle, source/provenance, profile scope, coverage freshness, ranking vector, explanation, dismissal, and duplicate types.
- [ ] 1.2 Add SQLite candidate/cache tables, indexes, source fingerprints, and retention/delete policy.
- [ ] 1.3 Implement staged discovery → text retrieval → analysis → ranking jobs with cancellation/retry and no fabricated coverage.

## 2. Sources and UI

- [ ] 2.1 Integrate existing RSS/web/search/YouTube/podcast/library import adapters and source-quality/duplicate checks.
- [ ] 2.2 Add profile/filter/coverage-band recommendation UI with explanations, pending/error states, accept/import/dismiss/snooze.
- [ ] 2.3 Add optional Queue signal preserving due/review/priority semantics and existing queue safety invariants.

## 3. Verification

- [ ] 3.1 Test profile/interest ranking, measured-vs-pending coverage, duplicate/stale invalidation, provider/offline/privacy, and user consent.
- [ ] 3.2 Test import provenance, Queue ordering invariants, mobile/e-ink/accessibility, large candidate sets, and recommendation performance.
- [ ] 3.3 Coordinate shared search/import/Queue changes with `recommendation-engine`, RSS/YouTube/podcast, and queue composition changes.
