## Context

Documents already have metadata, reading position, Queue priority, and import pipelines. The lexicon supplies profile state and processing supplies token/phrase spans. Coverage must be computed from the learner's actual state, not only CEFR or provider frequency.

## Dependencies

- Hard: #1–#4.
- Soft: #9 analytics, #12 phrases, #23 recommendations, and Queue composition/load changes.
- Freeze coverage policy, band config, freshness, and optional Queue signal before #18/#23 consume it.

## Goals / Non-Goals

**Goals:**

- Provide reproducible coverage/difficulty summaries for a profile and document version.
- Process incrementally and expose stale/pending/error states.
- Make coverage an optional Queue ranking/filter signal without changing scheduler semantics.

**Non-Goals:**

- A universal difficulty truth or automatic content dismissal.
- Blocking imports/readers on full analysis.

## Decisions

1. **Weighted token accounting with configurable policy.** Count lexical units after processor analysis; default denominator excludes punctuation and optionally numbers, while policy records how proper nouns/ignored terms/phrases are treated. Repeated tokens count in coverage denominator; unique lemmas power secondary stats.
2. **State precedence.** Exact-form override, confident lemma state, phrase state where phrase matching is selected, then unknown. Ambiguous/low-confidence tokens contribute to an “unresolved” bucket rather than pretending known.
3. **Versioned background projection.** Key result by document content hash, profile ID, processor version, lexicon state version, phrase policy, and threshold config. Recompute affected chunks/aggregates when one state changes.
4. **Data-driven bands.** Store bands and labels in profile/settings configuration, with defaults such as Very easy, Comfortable, Productive challenge, Difficult, Very difficult; do not scatter magic thresholds.
5. **Queue as signal.** Expose coverage range/score to Queue composition and sorting as one optional dimension. Existing due/review/priority semantics remain in charge.

## Risks / Trade-offs

- [Morphology errors skew coverage] → retain unresolved/confidence counts and show method/freshness.
- [State changes trigger full-novel work] → reverse-index lexical entries to affected documents/chunks and recompute incrementally.
- [Phrase overlap double-counts] → deterministic longest/high-confidence match policy and separate diagnostics.
- [Provider unavailable] → exact-form coverage still works; missing analysis is labeled.

## Migration Plan

1. Add coverage schema/calculator with no UI.
2. Calculate on open/Queue metadata request in background and cache by versions.
3. Add document badge/dashboard and opt-in Queue band filter.

## Open Questions

- Default denominator treatment for named entities and numbers by language.
- Whether unresolved tokens should be included in “unknown” by default or shown separately.
- Maximum coverage recomputation latency acceptable on Android/e-ink.
