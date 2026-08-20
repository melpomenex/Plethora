## Why

The existing readers are optimized for continuous reading, while language learners sometimes need a focused, sentence-by-sentence loop that preserves exact reader location. Sentence Mode should be a presentation over the same document and anchors, not a second document or course tree.

## What Changes

- Add a sentence-by-sentence mode with target sentence, optional translation, vocabulary inspection, contextual grammar help, play/replay/loop/shadow hooks, and previous/next navigation.
- Reuse processing sentence boundaries, lexicon, Dictionary Peek, translation, existing TTS, and later original-audio alignment.
- Preserve and restore exact normal-reader anchors and Queue/listening position semantics.
- Provide clean mobile/e-ink presentation with normal reader return.

## Dependencies

- Hard: profiles, processing adapters, lexicon/knowledge states, sentence translation.
- Soft: `add-language-sentence-audio-alignment`, `integrate-language-vocabulary-with-srs`, `add-language-shadowing-mode`.
- Extends existing reader position and TTS/selection architecture; does not duplicate documents or Queue scheduling.

## Capabilities

### New Capabilities

- `language-sentence-mode`: Focused sentence navigation, controls, context, and position restoration.

### Modified Capabilities

- None; normal reader remains the default.

## Impact

- Reader route/view state, sentence index/anchor adapters, translation/lexicon APIs, TTS controls, and mobile/e-ink presentation.
- Tests for EPUB/PDF/HTML/Markdown/Queue/transcript locations and lifecycle invariants.
