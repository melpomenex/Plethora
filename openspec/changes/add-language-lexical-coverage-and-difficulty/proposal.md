## Why

Language learners need to know whether a document is comprehensible for them, but static CEFR labels cannot reflect a user's actual lexicon. Plethora should compute profile-specific lexical coverage and difficulty as a background document projection that can inform metadata, Queue, dashboards, and future recommendations.

## What Changes

- Count tokens/lemmas by knowledge state with explicit treatment of inflections, phrases, proper nouns, numbers, punctuation, ignored terms, repeated terms, and confidence.
- Expose coverage, unknown density, counts, and configurable data-driven difficulty bands.
- Add lazy/background calculation, cache/version invalidation, document metadata, Queue filters/sorting, and dashboard integration.
- Never block document open or mutate imported source content.

## Dependencies

- Hard: profiles, processing adapters, lexicon/occurrences, vocabulary knowledge states.
- Soft: language analytics and content recommendations; Queue composition changes for final prioritization.
- Extends existing document metadata/Queue selectors; does not replace priority/scheduling semantics.

## Capabilities

### New Capabilities

- `language-lexical-coverage-and-difficulty`: Coverage computation, difficulty bands, caching, document/Queue/dashboard integration.

### Modified Capabilities

- None; generic Queue priority remains authoritative and language coverage is an optional signal.

## Impact

- SQLite coverage tables/results, background jobs, document APIs, Queue strategy inputs, analytics, metadata cards, and settings for thresholds.
- Reader opening/performance safeguards and tests for large documents/languages.
