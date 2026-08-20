## Why

Learners need sentence meaning while reading content they chose, but Plethora has no language-profile translation layer or cache. Translation must be optional, provider-neutral, source-preserving, and available inline or on demand without turning every reader into a separate course.

## What Changes

- Add sentence-level translation requests keyed by profile language pair, source sentence, provider, and version.
- Add Target-only, Tap-to-translate, inline, and hidden/blurred reveal modes.
- Support local/on-device, configured provider, and dedicated translation adapters with typed fallback/offline states.
- Preserve sentence anchors and original content; integrate with readers, Language Peek, Sentence Mode, transcript/video, and future tutor/mining.

## Dependencies

- Hard: `add-language-learning-profiles`, `add-language-processing-adapter-layer`.
- Soft: lexicon/knowledge states, `add-language-reader-vocabulary-highlighting`, `add-language-audio-alignment` (the actual name is `add-language-sentence-audio-alignment`), and AI provider settings.
- Extends existing AI/provider/cache patterns; does not change imported source text.

## Capabilities

### New Capabilities

- `language-sentence-translation`: Sentence translation contract, cache, display modes, provider policy, and anchors.

### Modified Capabilities

- None; generic AI passage actions remain usable as separate actions.

## Impact

- New translation API/cache/provider adapter and SQLite/IndexedDB cache metadata.
- Reader sentence boundaries/anchor plumbing, transcript/video views, settings/i18n, mobile/e-ink/reduced-motion behavior.
- Privacy/cost disclosure and tests for cached/offline/provider failure paths.
