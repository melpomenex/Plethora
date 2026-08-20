## Context

The reader stack has distinct DOM/anchor implementations and theme/presentation contexts, including e-ink and reduced motion. Script assistance needs to render derived annotations without modifying imported EPUB/HTML or confusing existing TTS/selection ranges.

## Dependencies

- Hard: #1, #2, and the #5 reader annotation/anchor contract.
- Soft: #6, #7, TTS, e-ink/mobile reader work.
- Coordinate DOM/CSS and source-span selection with #5/#6/#8; do not create language-specific markup inside individual viewers.

## Goals / Non-Goals

**Goals:**

- One layer and contract for per-language annotations with capability disclosure.
- Preserve exact source offsets and interaction semantics.
- Support density/disable settings and RTL/screen-reader correctness.

**Non-Goals:**

- Promising pitch accents/phonology/transliteration for every language.
- Replacing TTS, dictionary, morphology, or source text.

## Decisions

1. **Annotation span model.** `ReadingAssistAnnotation` references source span/anchor, display text, kind, provider/version/confidence, direction/script, and optional accessibility pronunciation.
2. **Capability-driven providers.** A profile/language adapter advertises furigana, romaji, pinyin, script conversion, romanization, diacritics, or pitch metadata separately; unsupported kinds are unavailable.
3. **Derived overlay with layout modes.** Render via a reader-owned layer/annotation markup that can be hidden, compact, or full. EPUB styling and PDF text remain source-authoritative.
4. **Interaction mapping.** Assistance text is not a separate selectable vocabulary token by default; selection maps back to source span, and TTS uses source text unless the user explicitly chooses assist pronunciation.
5. **RTL and accessibility first.** Preserve bidi isolation, direction metadata, reading order, and screen-reader verbosity settings; e-ink favors static inline/above-text layouts.

## Risks / Trade-offs

- [Ruby annotations alter line height] → Per-reader layout adapters, density settings, and PDF fixed opt-out.
- [Incorrect romanization] → Show provider/confidence and allow disable; never mark as lexical truth.
- [Accessibility doubles content] → Configure screen-reader announcement/hidden assist semantics.
- [Cache/licensing] → Keep provider/version metadata and bounded derived results.

## Migration Plan

1. Add contract/settings and disabled default.
2. Implement Japanese/Chinese/text/EPUB adapters where stable.
3. Add Korean/RTL/provider-specific assistance and PDF/e-ink behavior incrementally.

## Open Questions

- Best bundled libraries for ruby/pinyin/RTL transliteration.
- Whether traditional/simplified conversion is an assist or a lexical normalization capability.
- Per-document override versus profile-only settings.
