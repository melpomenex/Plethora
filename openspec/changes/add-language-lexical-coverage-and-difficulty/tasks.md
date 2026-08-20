## 0. Dependency gates

Requires #1–#4. Coordinate document/Queue metadata and coverage policy with #9 and #23; later consumers must treat pending/stale coverage as non-measured rather than zero.

## 1. Calculator and schema

- [ ] 1.1 Define coverage policy, counted-unit, state precedence, phrase overlap, unresolved bucket, band configuration, and freshness types.
- [ ] 1.2 Add SQLite coverage tables/indexes keyed by document/profile/content/processor/lexicon/policy versions.
- [ ] 1.3 Implement deterministic weighted calculator and chunk-level reverse invalidation.

## 2. Background and APIs

- [ ] 2.1 Add background job scheduling, progress, cancellation, retry, and stale-result handling.
- [ ] 2.2 Add Rust/TS APIs for summaries, document detail, bands, policy settings, and explicit recompute/delete.
- [ ] 2.3 Integrate profile/document metadata, Queue optional signal, analytics, and future recommendation inputs.

## 3. UX and verification

- [ ] 3.1 Add coverage/difficulty badges and detail views with counts/method/freshness.
- [ ] 3.2 Test inflections, phrases, proper nouns, numbers, punctuation, ignored/low-confidence terms, repeated words, and unsupported languages.
- [ ] 3.3 Test large-document performance, one-word incremental invalidation, Queue invariants, profile deletion, offline behavior, and export/import.
