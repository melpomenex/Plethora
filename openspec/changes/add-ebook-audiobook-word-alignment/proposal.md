## Why

Plethora already offers split-screen audiobook+EPUB reading with segment-level transcript sync, but users who read while listening need **word-level** highlighting, reliable bidirectional seek, and persisted alignment that survives restarts. Segment-only matching fails on narrator intros, punctuation drift, abridgements, and STT errors. Storyteller's MIT-licensed error-tolerant alignment algorithm addresses these gaps; Plethora should adopt its approach without importing GPL transcription code.

## What Changes

- Add a **Storyteller-inspired alignment engine** (ported MIT `errorAlign` logic) that maps ebook tokens to transcript word timestamps with fuzzy tolerance for insertions, deletions, and substitutions.
- Introduce a **provider-agnostic `TranscriptionTimeline`** consumed by the aligner (Whisper, Nemotron, OpenRouter, segment-only fallback with interpolation).
- Persist a **native `PlethoraAlignmentMap` sidecar** (no EPUB repackaging) keyed by ebook+audiobook content hashes.
- Upgrade **audiobook+EPUB sync playback** from segment CFI highlights to word-level highlighting with efficient timestamp lookup.
- Enable **bidirectional navigation**: audio seek → reader jump; intentional text tap → audio seek.
- Unify **reading/listening progress** via aligned locators.
- Add **alignment generation UX** with progress, cancellation, retry, and low-confidence warnings.
- Keep mobile as **alignment consumer** (precomputed maps synced from desktop); document future on-device alignment.

## Capabilities

### New Capabilities

- `ebook-audiobook-word-alignment`: Error-tolerant ebook↔transcript alignment, persisted map, confidence, invalidation.
- `alignment-playback-sync`: O(log n) word lookup, reader highlighting, bidirectional seek, follow-narration scroll.
- `alignment-generation-ux`: User-initiated alignment workflow, progress, cancellation, partial/resumable chapters.

### Modified Capabilities

- `audiobook-epub-pairing`: Pair detection unchanged; pairs now feed word-alignment generation.
- `transcript-karaoke-sync`: Reuse normalized word-timing types; no behavior change outside sync view.

## Impact

- **New modules**: `src/lib/ebookAudiobookAlignment/**` (aligner, normalization, persistence, playback lookup).
- **Modified**: `AudiobookEpubSyncView`, `EPUBViewer` sync props, `api/alignmentCache.ts` (superseded by new persistence).
- **Tests**: Unit tests for normalization, errorAlign, playback lookup; integration fixtures without live STT.
- **Dependencies**: No new npm packages; no GPL code. MIT Storyteller `errorAlign` ported in-tree with attribution.
- **Platforms**: Alignment generation desktop-first; all platforms consume maps. Mobile documented as consumer-only for v1.
- **Non-goals (v1)**: PDF word sync, EPUB Media Overlay export, cloud alignment service, pronunciation scoring.
