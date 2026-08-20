## Why

The shared Dictionary Peek from `unify-selection-dictionary-lookup` is English-definition oriented and its one-tap flashcard action bypasses language state. Language Mode needs a richer Language Peek that understands surface forms, lemmas, morphology, context, phrases, profile languages, and explicit vocabulary actions without creating a second selection popover.

## What Changes

- Extend the existing `DictionaryPeek`/selection-intent architecture into a profile-aware Language Peek.
- Show encountered form, lemma/POS/morphology when supported, pronunciation, target/base-language meanings, source sentence and translation, and optional context explanation.
- Add state selector, Pronounce, original/TTS sentence replay, Memorize, Extract, Examples, Explain, morphology/conjugation, phrase actions, and More.
- Preserve AI independence, provider caching/failure states, native selection, Queue safety, mobile/e-ink behavior, and current dictionary history.

## Dependencies

- Hard: `add-language-learning-profiles`, `add-language-processing-adapter-layer`, `add-language-lexicon-and-occurrence-model`, `add-language-vocabulary-knowledge-states`.
- Extends active `unify-selection-dictionary-lookup` and its `dictionary-peek`/`vocabulary-lookup-history` specs; coordinate before implementing either change.
- Soft: sentence translation, audio alignment, phrase tracking, and SRS integration.

## Capabilities

### New Capabilities

- `language-aware-dictionary-peek`: Profile-aware lookup/presentation/actions and graceful capability degradation.

### Modified Capabilities

- `dictionary-peek`: Add language-aware presentation and actions while preserving existing English/off-profile behavior.
- `vocabulary-lookup-history`: Record durable profile-scoped lookup/interaction events through the lexicon projection.

## Impact

- `src/components/viewer/selectionInteraction/DictionaryPeek.tsx`, selection intent/controller, `useDictionaryEntry`, dictionary providers/cache, lexicon APIs, TTS/audio replay, extracts, Flashcard Studio, i18n, and mobile/e-ink presentation.
- No new dictionary UI and no automatic learning-item creation.
