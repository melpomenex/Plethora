## Why

The existing readers can render user highlights, search marks, and spoken-word highlighting, but they do not show profile-scoped lexical state. Learners need a fast visual comprehension signal that remains performant and does not conflict with selection, annotations, TTS, Queue, or fixed-PDF constraints.

## What Changes

- Add a shared language vocabulary annotation layer for EPUB, PDF reflow/fixed where anchors are reliable, HTML/article, Markdown/text, and Queue readers.
- Render New/Encountered, Learning, Familiar, Known, and Ignored using accessible theme tokens and Off/Minimal/Full density.
- Define coexistence/precedence with user highlights, search, TTS spoken-word highlighting, selection, and reader position.
- Use visible-range/indexed rendering and incremental invalidation rather than rerendering every token.

## Dependencies

- Hard: `add-language-learning-profiles`, `add-language-processing-adapter-layer`, `add-language-lexicon-and-occurrence-model`, `add-language-vocabulary-knowledge-states`.
- Soft: `improve-reader-tts`, `readable-document-highlights`, `fix-pdf-text-selection`, e-ink/mobile UI changes.
- Extends existing reader selection/annotation layers; does not replace normal user highlights.

## Capabilities

### New Capabilities

- `language-reader-vocabulary-highlighting`: State-driven reader annotations, rendering policy, performance, and accessibility.

### Modified Capabilities

- None; existing highlights/search/TTS behavior remains authoritative for their own layers.

## Impact

- Shared annotation/index utilities and reader hosts under `src/components/viewer/`, CSS/theme tokens, profile settings, lexical APIs, and Queue/transcript adapters.
- PDF fixed text may show no annotation where canonical token anchoring is not reliable; ordinary PDF reading remains unchanged.
