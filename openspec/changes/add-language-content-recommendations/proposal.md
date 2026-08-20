## Why

Plethora already imports RSS, web content, YouTube, podcasts, and user documents, while lexical coverage can describe what a learner can comprehend. The missing layer is an explainable, profile-aware recommendation signal that feeds the existing Queue rather than creating a separate backlog or content marketplace.

## What Changes

- Add language content discovery/recommendations from configured search/import sources, saved feeds, YouTube, podcasts, and existing library.
- Rank by learner interest, actual lexical coverage/new-word density, phrase difficulty, length, source quality, recency, preferences, and duplication.
- Show “Recommended for [language]” with measured coverage/difficulty and an explanation of why.
- Integrate recommendations as optional Queue inputs and normal import/document flow; do not fabricate coverage before text retrieval/analysis.

## Dependencies

- Hard: profiles, processing, lexicon/knowledge states, lexical coverage/difficulty, existing content import/search/discovery contracts.
- Soft: analytics, phrase tracking, personalized generation, Queue composition/load changes, existing `recommendation-engine`.
- Extends `src/api/rss*`, YouTube/podcast/import/search, and Queue; no social/course marketplace.

## Capabilities

### New Capabilities

- `language-content-recommendations`: Retrieval, candidate analysis, ranking/explanations, import/deduplication, Queue integration, and privacy/provider behavior.

### Modified Capabilities

- None; generic recommendation/import/Queue behavior remains available without a language profile.

## Impact

- Recommendation/candidate schema and jobs, search/import adapters, coverage processing, document metadata, Queue strategy signal, settings/privacy, analytics, mobile/e-ink UI, and source-quality tests.
