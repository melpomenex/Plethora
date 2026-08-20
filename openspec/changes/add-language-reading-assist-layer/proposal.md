## Why

Learners of Japanese, Chinese, Korean, Arabic, Persian, Hebrew, Urdu, and related scripts need optional reading assistance such as furigana, pinyin, transliteration, script variants, or morphology. These annotations must be a shared reader layer that coexists with lexical highlighting, selection, TTS, EPUB styling, PDF reflow, accessibility, and e-ink.

## What Changes

- Add a generic `ReadingAssistLayer` contract for script annotations, transliteration, pronunciation, script conversion, and morphology hints.
- Add provider/capability negotiation, density settings, source-span mapping, caching/versioning, and profile scoping.
- Integrate Japanese furigana/optional romaji, Chinese pinyin and simplified/traditional relations, Korean romanization/morphology, and RTL-safe transliteration/diacritic assistance where providers support them.
- Keep assists optional, truthful, accessible, and disabled without affecting normal reading.

## Dependencies

- Hard: profiles, processing adapters, reader vocabulary/highlighting anchor contract.
- Soft: Language Peek, TTS, sentence translation, phrase tracking, e-ink/mobile reader work.
- Extends readers without bespoke language hacks or source mutation.

## Capabilities

### New Capabilities

- `language-reading-assist-layer`: Generic script-assistance annotations, provider capability, settings, rendering, and accessibility.

### Modified Capabilities

- None; existing reader styles/source text remain authoritative.

## Impact

- New analysis/annotation types and cache, reader host/layer components, EPUB/PDF/text adapters, settings/i18n, RTL/accessibility CSS, and provider/privacy policy.
