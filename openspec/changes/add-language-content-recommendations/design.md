## Context

Plethora has multiple import/discovery paths and Queue composition/priority logic. Candidate content arrives as URLs/metadata/full text at different stages. Recommendation must analyze only after enough text is available and must explain unknown/pending coverage.

## Dependencies

- Hard: #1–#4, #10, and existing import/search/discovery contracts.
- Soft: #9, #12, #18, Queue composition/load changes, and active `recommendation-engine`.
- Freeze candidate lifecycle, coverage freshness, ranking explanation, and optional Queue-signal contracts before parallel source adapters edit shared search/import files.

## Goals / Non-Goals

**Goals:**

- Recommend content the user cares about at a profile-appropriate challenge.
- Explain ranking with measured signals and avoid duplicate library items.
- Feed existing Queue/import/document flows without changing generic Queue semantics.

**Non-Goals:**

- Fabricated coverage from title/snippet alone, a course marketplace, or social recommendations.
- Auto-importing/queuing content without user consent.

## Decisions

1. **Candidate lifecycle.** `discovered → metadata → text_available → analyzed → ranked → accepted/dismissed`; coverage is unknown until full/adequate text is retrieved and processed.
2. **Explainable ranking vector.** Score profile/interest match, coverage band distance, new-word/phrase density, length, source quality, recency, duplicate similarity, and user preferences. Store component explanations, not only a scalar.
3. **Coverage-aware rank policy.** Prefer configured band (e.g. 92–98%) but allow productive challenge/difficult results with labels; profile may choose target range. Low-confidence/pending candidates are not presented as measured percentages.
4. **Queue integration as optional signal.** Accepted content follows normal import/document/Queue priority; a recommendation strategy may influence ordering without bypassing due/review/explicit priorities.
5. **Provider/privacy.** Search/cloud source use follows existing connectors/credentials/consent; send only necessary metadata/text for analysis and cache candidate/coverage by source fingerprint.

## Risks / Trade-offs

- [Full-text retrieval is costly/blocked] → Stage candidates, show pending, reuse existing import/cache, and never invent coverage.
- [Recommendations become spam] → User controls, cooldowns, dismissals, source quality/duplication filters.
- [Coverage stale after lexicon changes] → Versioned cached analysis and incremental re-rank.
- [Queue conflicts] → Add a low-level score/signal and preserve current selector invariants.

## Migration Plan

1. Add candidate lifecycle/ranking explanation over existing sources, no Queue integration.
2. Add coverage analysis and recommendation UI/import acceptance.
3. Add optional Queue strategy and learned preference/analytics signals.

## Open Questions

- Which content-search providers are configured/available in target deployments.
- Default discovery cadence and local cache retention.
- Whether recommendations should be per profile or shared with explicit profile filters.
