## Context

Reader position infrastructure already supports EPUB CFI, PDF page/reflow/canonical anchors, text offsets, transcript timestamps, and Queue session state. Sentence Mode can be a route/panel overlay that holds a `SentenceModeSession` with entry/return anchors, rather than cloning document content.

## Dependencies

- Hard: #1–#4 and #7; reader position/source-anchor infrastructure is also required.
- Soft: #13 alignment, #11 SRS, #19 shadowing, and #20 dictation.
- #5/#6 should share annotation/Peek entry contracts; #14/#15/#19/#20 should consume the sentence session rather than create another sentence navigator.

## Goals / Non-Goals

**Goals:**

- Navigate deterministic sentence units and inspect associated lexical state.
- Use existing translation/TTS now and original audio when alignment exists.
- Return to the exact prior normal-reader location and preserve Queue invariants.

**Non-Goals:**

- A grammar curriculum, independent document copy, or automatic card creation.
- Forcing Sentence Mode on ordinary content.

## Decisions

1. **Anchor-backed session.** Store document/media ID, profile ID, sentence ID, entry anchor, current sentence ID, and return anchor; recompute view from source rather than storing a copied passage collection.
2. **Sentence index as a lazy projection.** Use adapter sentence segments with bounded window loading; if analysis is incomplete, show an explicit pending state and allow returning to normal reader.
3. **Control routing.** Play/replay uses TTS service with an original-audio resolver seam; vocabulary opens Language Peek; translation uses sentence cache; grammar help is optional AI/dictionary context.
4. **Reading state semantics.** Moving sentences updates a language-mode/session progress projection and only updates generic reading position at explicit/normal-reader-compatible checkpoints; it never rates Queue items.
5. **Platform presentation.** Desktop gets a panel/route, mobile a full-screen clean view, e-ink a high-contrast static layout, all honoring reduced motion and screen readers.

## Risks / Trade-offs

- [Sentence segmentation changes] → Pin session to analysis version and resolve stale IDs by anchor/fingerprint with a visible fallback.
- [PDF fixed sentence mapping is weak] → Use reflow/canonical anchors where available and disable mode for unsupported pages.
- [AI grammar call cost] → Make it an explicit action with bounded sentence context and cache when appropriate.
- [Queue navigation accidentally advances] → Separate mode session actions from Queue completion and add lifecycle tests.

## Migration Plan

1. Add sentence index/session contracts and an opt-in entry action.
2. Implement text/EPUB/HTML/Markdown and PDF reflow.
3. Add transcript/video/audio anchors as those capabilities become available.

## Open Questions

- Whether Sentence Mode should persist last sentence per document/profile.
- Exact generic reading-progress checkpoint policy while browsing sentences.
- How much surrounding context is shown on e-ink.
