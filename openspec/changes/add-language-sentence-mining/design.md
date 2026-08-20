## Context

Selection surfaces already know source context, EPUB/PDF/text anchors, transcript segments, video timestamps, and extract APIs. Flashcard Studio has draft/mention/source context patterns. Mining should collect a typed payload and delegate editing/acceptance to that existing surface.

## Dependencies

- Hard: #1–#4 and existing extracts/Flashcard Studio draft contracts.
- Soft/preferred: #7, #11, #12, #13, #14, and screenshot capture; text-only mining can ship before alignment.
- Coordinate selection actions, source navigation, Flashcard Studio, and media references; #15 must not create a duplicate editor.

## Goals / Non-Goals

**Goals:**

- One action with source-specific collectors and one shared draft contract.
- Preserve exact text/anchor and optional media references.
- Work with document-only/TTS/native audio/video sources and degrade cleanly.

**Non-Goals:**

- Auto-creating cards or copying large media blobs by default.
- Replacing generic Extract or Flashcard Studio flows.

## Decisions

1. **Typed `LanguageMiningPayload`.** Include profile/object IDs, sentence/target text, neighboring context, translation/analysis, document/source IDs, anchor, audio/media range, provider metadata, and optional frame reference with field-level availability.
2. **Collector adapters per source.** Text readers use sentence/selection anchors; transcript/audio use timed segments/alignment; video adds timestamp/frame; all return typed missing/ambiguous status.
3. **Flashcard Studio first.** Open an editable draft seeded with payload; generic Extract may be an explicit alternate action. User acceptance creates an ordinary item through existing SRS integration.
4. **Context bounded and source-linked.** Use preceding/following sentence or configured context window; avoid duplicating whole passages and keep source recoverable.
5. **Original audio resolver.** Use alignment range, then document TTS, then no-audio with explanation. Never replace native media with TTS when native exists.

## Risks / Trade-offs

- [Anchor mismatch] → Typed “needs review/no source” state, no fake text, and preserve raw selection for editing.
- [Payload too large] → Store source/media references and bounded text; lazy-load optional frame/audio.
- [Mobile action overload] → Surface Mine in context/More and use a compact confirmation/draft route.
- [Provider calls repeated] → Reuse translation/analysis/alignment caches and attach cache keys.

## Migration Plan

1. Add payload/collector interfaces and text-reader action.
2. Add transcript/audio/video collectors and original audio.
3. Route drafts into Flashcard Studio and add optional one-tap shortcuts only where existing policies permit.

## Open Questions

- Default neighboring-context count by source type.
- Frame capture permission/retention policy on YouTube/local video.
- Whether “Mine sentence” should auto-select the nearest sentence when a user selects a word.
