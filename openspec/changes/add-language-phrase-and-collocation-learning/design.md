## Context

Selection intent already distinguishes single-word and multi-word text, but multi-word selections currently route to generic extract/card actions. The new lexicon needs a stable phrase object that can share source occurrences with token analyses without double-counting coverage or altering the constituent words.

## Dependencies

- Hard: #1–#4.
- Soft: #7, #11, #13, and #10 coverage.
- Coordinate phrase identity/overlap with #5/#6 reader/Peek and #3 lexicon; do not generate speculative candidates in parallel without one acceptance policy.

## Goals / Non-Goals

**Goals:**

- Let users manage meaningful phrases as independent learnable objects.
- Preserve exact selected text/source context and allow multiple lexical analyses.
- Keep automatic suggestions conservative and review intentional.

**Non-Goals:**

- Modeling every n-gram or building a grammar curriculum.
- Automatically creating phrases or cards from every sentence.

## Decisions

1. **Phrase object with normalized key.** Store profile/language, normalized phrase, display form, phrase type, optional head lemma/constituent links, meanings, confidence, and state/SRS links.
2. **Occurrence spans can overlap tokens.** Phrase occurrence references sentence/source span and constituent token IDs; coverage uses an explicit longest/high-confidence policy to avoid double-counting.
3. **Candidate pipeline is opt-in/progressive.** Deterministic dictionaries/statistics and AI may suggest candidates, but only user acceptance promotes a candidate to a visible phrase object.
4. **Selection-first UX.** User-selected phrases are authoritative; Language Peek shows phrase actions before speculative suggestions and retains exact surface text.
5. **Shared audio/examples.** Phrase replay uses sentence/audio alignment or TTS, and examples query source occurrences/library search with permission and paging.

## Risks / Trade-offs

- [Overlapping phrase/token colors become confusing] → Define precedence/outline/badge and accessible labels; use phrase style only when explicitly enabled.
- [Candidate false positives] → Confidence threshold, acceptance gate, dismiss/snooze, and no default auto-highlighting.
- [Phrase state conflicts with word states] → Independent state plus constituent evidence; do not infer one from the other.
- [Phrase identity changes by language] → Profile/language/config/version keys and user merge/split actions.

## Migration Plan

1. Add phrase tables/contract and explicit selection save path.
2. Integrate Peek/actions and SRS draft links.
3. Add candidate suggestions, examples, coverage, and analytics after stable phrase identity.

## Open Questions

- Whether phrase candidates should be generated during lexical analysis or on demand.
- Exact longest-match policy for nested idioms.
- Which provider data can be stored/synced under licensing constraints.
