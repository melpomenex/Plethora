## Why

Plethora already stores transcription segments, word timings, podcast/audiobook positions, YouTube captions, and TTS timing, but it has no general sentence-to-original-media relation. Without alignment, replay, shadowing, sentence mining, and language cards fall back to TTS even when native audio exists.

## What Changes

- Add a source-anchor-to-media alignment model for sentence/phrase/text anchors and start/end timestamps.
- Ingest Whisper/provider word/segment timestamps, captions, audiobook chapter alignment, imported captions, and future forced alignment.
- Prefer original audio for sentence play/replay/loop, cards, mining, shadowing, and transcript navigation; TTS remains fallback.
- Add confidence/version/staleness handling and reference media rather than duplicating blobs.

## Dependencies

- Hard: profiles, processing adapter sentence/source-anchor contract, existing transcription/media/audio playback infrastructure.
- Soft: audiobook EPUB sync, audio editions, YouTube transcript sync, TTS, video mode, mining/shadowing/dictation.
- Extends transcript/audio anchor data; does not replace current karaoke sync.

## Capabilities

### New Capabilities

- `language-sentence-audio-alignment`: Versioned text/media alignment, confidence, ingestion, resolution, and original-audio preference.

### Modified Capabilities

- `transcript-karaoke-sync`: Reuse/generalize existing timestamp resolution without changing current playback behavior when no language profile is active.

## Impact

- SQLite alignment tables/repository, transcription/caption import normalization, reader/media playback APIs, source anchors, TTS/card/mining consumers, stale invalidation, and privacy/provider settings.
