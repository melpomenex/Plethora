## Why

Plethora's generic analytics and review statistics do not answer language-learning questions such as lexical coverage, lookup rate, exposure, passive versus active vocabulary, and movement from Learning to Known. These metrics should be profile-aware projections over existing reading, listening, lexicon, and review events rather than a second analytics system.

## What Changes

- Extend analytics with profile/language dimensions and language-specific metrics.
- Add known/familiar/learning/new lemmas, tokens, unique lemmas, encounters, lookups per 1,000 words, reading/listening/speaking/writing activity, coverage trends, difficulty, and active/passive evidence.
- Add time ranges, per-document/profile views, privacy/retention, and background aggregation.
- Preserve generic analytics and scheduler semantics.

## Dependencies

- Hard: profiles, lexicon/occurrences, vocabulary knowledge states.
- Soft: lexical coverage, SRS integration, audio alignment, shadowing, dictation, writing, existing `implement-plethora-knowledge-health-and-advanced-learning-analytics`.
- Extends `src/api/analytics.ts`/Rust analytics commands; does not duplicate generic metrics.

## Capabilities

### New Capabilities

- `language-learning-analytics`: Profile-scoped language analytics, evidence dimensions, aggregation, and dashboard behavior.

### Modified Capabilities

- None; generic analytics remain available and can gain a language filter without changing non-language results.

## Impact

- SQLite aggregate tables/materialized queries, analytics APIs/store/pages/components, event ingestion hooks in readers/media/review/practice, and settings/privacy.
- Background aggregation and performance tests for large occurrence corpora.
