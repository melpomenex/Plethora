## Context

EPUB, Markdown, PDF reflow/fixed, HTML/article, Queue Scroll Mode, and transcript surfaces use different DOM/anchor strategies. Existing `HighlightLayer`, `WordHighlightLayer`, selection interaction, and PDF canonical word tables provide extension points, but a language layer must be independent of user annotations and spoken-word state.

## Dependencies

- Hard: #1–#4 profile, processing, lexicon, and state APIs.
- Soft/coordination: `improve-reader-tts`, `readable-document-highlights`, `overhaul-reader-selection-ux`, and PDF selection fixes.
- #6, #8, #14, #15, and #16 must share the layer precedence/anchor contract; coordinate edits to viewer annotation files.

## Goals / Non-Goals

**Goals:**

- Make state visible at a glance with contrast-safe, theme-aware styles.
- Resolve forms through the lexicon without mutating source DOM/content.
- Limit work to visible/processed ranges and update only affected lexical identities.

**Non-Goals:**

- Coloring every token in unsupported fixed PDFs or replacing text selection.
- Treating color as the only state control or replacing spoken-word karaoke.

## Decisions

1. **Shared `LanguageAnnotationLayer` contract.** Hosts provide analyzed token spans and anchor resolvers; the layer requests a profile-scoped state map and emits annotated ranges. Readers own mounting/scroll lifecycle.
2. **Theme tokens plus non-color cues.** Define semantic tokens for new/learning/familiar/ignored; Known is normally unstyled. Patterns/underlines/ARIA labels supplement color, and user theme contrast wins.
3. **Layer precedence.** Selection is transient topmost, TTS active-word is a strong temporary emphasis, user highlight/search retain their existing semantics, and language state is a background treatment. Combine via CSS variables/classes rather than nested DOM rewrites.
4. **Incremental visibility.** Build token indexes once per analysis/reader container, virtualize or decorate visible ranges, and invalidate by lexical-entry/version key, not whole-document state.
5. **Graceful anchor confidence.** Do not annotate an occurrence when mapping is ambiguous; keep Dictionary Peek/manual actions available.

## Risks / Trade-offs

- [Large EPUB DOM becomes heavy] → Decorate visible ranges, cap DOM marks, and use worker/page-level indexes.
- [Fixed PDF text spans differ from analysis] → Use canonical PDF word IDs and confidence gating; skip unreliable pages.
- [Color overload with TTS/search/highlights] → Explicit style precedence and accessibility tests.
- [State update races] → Version state maps and reject stale analysis/annotation writes.

## Migration Plan

1. Add tokens/settings and no-op layer when Language Mode is off.
2. Integrate text/EPUB and PDF reflow using existing anchors.
3. Add fixed PDF and Queue/transcript only where confidence and performance budgets pass.

## Open Questions

- Exact visual tokens for each built-in theme.
- Whether Minimal mode annotates only New/Learning or also displays an icon/tooltip for Familiar.
- Fixed PDF fallback UX when token anchors are unavailable.
