## Context

The repository has timestamped transcript segments, podcast word timings, YouTube caption parsing, audio edition anchors, and TTS caches. These have different IDs and confidence semantics. A shared alignment record must bridge text source anchors and media without requiring generated audio.

## Dependencies

- Hard: #1/#2 plus existing transcription, source-anchor, and media playback infrastructure.
- Soft: audiobook/EPUB sync, audio editions, YouTube sync, and TTS cache proposals.
- Downstream hard consumers #14, #15, #19, and #20 must use this resolver; coordinate repository/audio files before parallel playback work.

## Goals / Non-Goals

**Goals:**

- Resolve exact sentence/phrase source anchors to original media ranges with confidence.
- Keep alignment stale-safe when transcript/source changes.
- Offer a common resolver for replay, transcript seek, card media, mining, and practice.

**Non-Goals:**

- Guaranteeing forced alignment quality in the first release.
- Replacing existing media playback/transcription/karaoke implementations.
- Copying audio clips into every card by default.

## Decisions

1. **Generic alignment record.** Store source kind/document ID, source anchor/sentence ID, media document/edition ID, start/end milliseconds, confidence tier/score, method, transcript/content fingerprint, and provider/version.
2. **Immutable/versioned inputs.** Alignment references text/media fingerprints and is stale when either changes; old alignment can remain for diagnostics but is never silently used as current.
3. **Provider normalization.** Normalize Whisper/provider/caption/audiobook/forced alignment output into the same monotonic timeline. Missing word timing still permits sentence-level alignment.
4. **Resolver policy.** Prefer highest-confidence current original alignment, then compatible segment overlap, then TTS. Return typed unavailable/stale/ambiguous results.
5. **Reference media.** Store media IDs/ranges; use existing media server/cache/export paths for playback and optional clip extraction.

## Risks / Trade-offs

- [Transcript edits invalidate timestamps] → fingerprints/version and explicit stale state.
- [Multiple candidate alignments conflict] → deterministic priority by current input/method/confidence and surface method.
- [Huge word timing payloads] → keep segment/sentence alignment in core tables and word timing in existing bounded transcript stores.
- [Provider privacy/cost] → use existing transcription/AI consent and disclose forced-alignment requests.

## Migration Plan

1. Add alignment contract/table/resolver with adapters over existing timestamp sources.
2. Backfill existing transcript/audio edition anchors lazily.
3. Migrate sentence replay/card/mining consumers to original-first resolver.

## Open Questions

- Whether audio clip extraction should be a separate media-cache capability.
- Default confidence thresholds for auto replay versus confirmation.
- How to represent audiobook alignment where text edition and audio files are separately imported.
