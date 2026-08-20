## Why

Plethora already imports YouTube/local video, transcripts captions, video extracts, and karaoke synchronization, but those surfaces are media-first rather than language-aware. A shared Video Language Mode can add transcript learning, lexical state, translation, sentence seeking, and mining without forking the video or vocabulary systems.

## What Changes

- Add synchronized video + transcript Language Mode with live sentence/token highlighting.
- Add Language Peek, vocabulary states, sentence translation, sentence seek/replay/loop, subtitle controls, and sentence mining entry points.
- Prefer original video/audio timestamp ranges; preserve normal playback mode and graceful e-ink degradation.
- Reuse profile/lexicon/processing/alignment and existing YouTube/local transcript infrastructure.

## Dependencies

- Hard: profiles, processing, lexicon/knowledge states, sentence translation, sentence audio alignment, existing video/transcription playback.
- Soft: phrase tracking, sentence mining, reading assist, SRS integration.
- Extends active/archived YouTube transcript/karaoke proposals; coordinate with `youtube-transcript-playback-sync` and `fix-youtube-mobile-transcript`.

## Capabilities

### New Capabilities

- `video-language-learning-mode`: Video/transcript layout, sync, controls, language annotations, and graceful platform behavior.

### Modified Capabilities

- `transcript-karaoke-sync`: Add language-state/sentence integration while retaining normal karaoke semantics.

## Impact

- `YouTubeViewer`, `YouTubeViewerWrapper`, local video/transcript components, transcript models/APIs, alignment resolver, profile/lexicon/highlighting/translation, mobile/e-ink UI, mining/flashcards.
