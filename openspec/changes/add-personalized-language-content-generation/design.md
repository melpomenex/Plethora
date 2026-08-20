## Context

The app has AI providers, document creation/import paths, content metadata, TTS, and language coverage projections. Generation should be a provenance-aware content producer feeding those existing paths, not a new lesson database.

## Dependencies

- Hard: #1–#4, #10, and existing AI/content-import/document creation contracts.
- Soft/preferred: #7, #11, #17, #23.
- Coordinate document provenance, provider consent, and processing queues with #18 consumers; generated content must enter the normal document pipeline.

## Goals / Non-Goals

**Goals:**

- Generate/adapt content within an approximate learner-appropriate lexical range and interests.
- Make generated/adapted status obvious and preserve the original source when adapting.
- Reuse Language Mode, lexicon processing, coverage, Queue, TTS, and analytics.

**Non-Goals:**

- Replacing user-selected content with a canned curriculum.
- Claiming exact coverage/grammar guarantees or hiding generated provenance.

## Decisions

1. **Structured generation request.** Include profile ID/language, topic/genre, length, target coverage band, desired new-word count, target-learning sample, style/grammar constraints, provider policy, and source adaptation ID.
2. **Bounded learner context.** Use sampled lexicon/coverage statistics and selected interests; never send the entire lexicon or unrelated library by default.
3. **Provenance-first document creation.** Store generated/adapted kind, prompt/settings/provider/model, source document ID/version for adaptations, and generated timestamp. Original remains a separate immutable document.
4. **Post-generation verification.** Process generated content through the same language adapter/lexicon/coverage pipeline; report actual measured coverage/difficulty rather than trusting the prompt.
5. **Provider/cost controls.** Use existing AI consent, quotas, local/BYO/hosted provider registry, streaming/cancel/retry, and cache only safe deterministic requests.

## Risks / Trade-offs

- [Model misses lexical target] → Re-analyze, show actual coverage, allow regenerate/adjust, never present prompt target as fact.
- [Generated text looks like source] → Strong generated/adapted provenance, source link, and metadata label.
- [Provider cost/context privacy] → Bounded context, disclosure, quotas, and no automatic generation.
- [Analysis delays use] → Import/open immediately with pending coverage/processing.

## Migration Plan

1. Add generation request/provenance and normal document creation.
2. Add post-generation analysis/coverage and adaptation actions.
3. Add TTS, Queue, analytics, and tutor/recommendation entry points.

## Open Questions

- Whether generated documents default to a dedicated collection/tag.
- How to handle generated content whose detected language misses the target.
- Which model settings should be visible versus profile presets.
