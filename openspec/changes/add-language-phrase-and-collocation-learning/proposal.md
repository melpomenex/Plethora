## Why

Meaning often lives in multi-word expressions such as `tener en cuenta`, `por lo tanto`, or `on the other hand`, but the lexical model and selection tools currently center on single words. Phrases need independent state, examples, audio, and memorization while preserving constituent-word learning.

## What Changes

- Add first-class phrase/collocation/idiom lexical objects and occurrences.
- Allow selection, definition/translation, state, save, Memorize, examples, replay, and source navigation for phrases.
- Add conservative deterministic/statistical/AI-assisted phrase candidate suggestions with confidence and user acceptance.
- Define overlap/highlighting rules with token-level annotations and sentence mining.

## Dependencies

- Hard: profiles, processing adapters, lexicon/occurrences, knowledge states.
- Soft: sentence translation, SRS integration, audio alignment, content generation.
- Extends lexical/highlighting/Language Peek contracts; no speculative phrase clutter by default.

## Capabilities

### New Capabilities

- `language-phrase-and-collocation-learning`: Phrase identity, occurrences, actions, candidates, overlap, and independent state/SRS links.

### Modified Capabilities

- None; single-word lexical behavior remains valid.

## Impact

- Phrase schema/indexes, processing/candidate pipeline, selection intent, Language Peek/highlighting, source anchors, examples/search, Flashcard Studio, and analytics/coverage.
