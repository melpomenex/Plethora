# Spec: language-sentence-audio-alignment

## ADDED Requirements

### Requirement: Source/media alignment model

The system SHALL represent a source sentence/phrase/text anchor linked to a media source/range with start/end timestamps, method, confidence, input fingerprints, provider/version, and stale status.

#### Scenario: Podcast sentence
- **WHEN** a transcript sentence is aligned to a podcast segment from 00:10.2 to 00:14.8
- **THEN** the relation is persisted with the transcript/source anchor and media identity/range

### Requirement: Multiple ingestion sources

The system SHALL accept normalized alignment from Whisper/provider timestamps, imported captions, audiobook/EPUB pairing, audio editions, and future forced alignment. A source without word timing MAY provide sentence timing.

#### Scenario: Caption-only media
- **WHEN** captions provide sentence timestamps but no word timings
- **THEN** sentence replay and seeking work while word-level highlighting is marked unavailable

### Requirement: Original audio preference

When a current valid original alignment exists, sentence/phrase play, replay, loop, transcript seek, sentence mining, and language-card media SHALL prefer the original range. TTS SHALL be fallback only when no usable original range exists or the user explicitly chooses TTS.

#### Scenario: Original beats TTS
- **WHEN** a sentence has a native podcast alignment and a TTS voice is configured
- **THEN** Replay uses the native media range and does not synthesize TTS

### Requirement: Stale/confidence handling

Alignment SHALL be rejected or labeled stale when source/media fingerprints change. Ambiguous/low-confidence matches SHALL return typed status and SHALL NOT silently seek to a wrong occurrence.

#### Scenario: Edited transcript
- **WHEN** a transcript sentence changes after alignment
- **THEN** the old mapping is marked stale and replay falls back/asks for re-alignment rather than playing an unrelated range

### Requirement: Resolver and fallback

A shared resolver SHALL return current original range, confidence/method, or typed unavailable/stale/ambiguous result. TTS fallback SHALL use existing provider/cache infrastructure and preserve source context.

#### Scenario: No native media
- **WHEN** a text-only EPUB sentence has no original audio
- **THEN** replay may use existing TTS and identifies it as synthesized/fallback

### Requirement: Media references and privacy

Alignment records SHALL reference existing media/cache IDs and ranges rather than duplicate blobs. Provider-backed alignment SHALL follow existing consent, credentials, disclosure, and cache policies.

#### Scenario: Cloud forced alignment
- **WHEN** the user explicitly requests cloud alignment
- **THEN** the UI discloses provider use and stores only the normalized result/media reference needed for replay

### Requirement: Performance and lifecycle

Alignment lookup SHALL be indexed by source anchor/sentence/media and bounded; it SHALL not block content open, corrupt playback/listening position, or mutate source documents.

#### Scenario: Long transcript
- **WHEN** a long transcript is opened
- **THEN** alignment lookup for the visible sentence is fast and does not load all alignment rows into reactive state
