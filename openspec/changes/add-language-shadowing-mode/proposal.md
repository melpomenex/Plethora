## Why

Plethora can already play TTS/native media and transcribe audio, but it has no focused loop for listening, repeating, recording, and comparing learner speech. Shadowing should turn existing sentence/audio/alignment/transcription infrastructure into a privacy-aware speaking practice mode.

## What Changes

- Add immediate/listen-then-repeat/continuous shadowing modes for current sentences and aligned media.
- Play original audio first, TTS second; record learner audio with explicit consent and local/cloud processing choice.
- Use existing transcription/provider architecture to compare expected and recognized text, show useful discrepancies, retry, and preserve practice history.
- Establish a reusable recording/comparison contract for later pronunciation scoring.

## Dependencies

- Hard: profiles, processing/sentence anchors, sentence mode/audio playback, existing transcription/provider abstraction.
- Soft: sentence audio alignment, video mode, SRS/mining, pronunciation feedback.
- Extends existing TTS/transcription/media permissions; does not claim phoneme accuracy.

## Capabilities

### New Capabilities

- `language-shadowing-mode`: Sentence practice flow, recording, transcription comparison, history, privacy, and platform behavior.

### Modified Capabilities

- None; existing playback/transcription stays unchanged outside explicit practice.

## Impact

- Practice/session schema, audio capture/provider APIs, sentence/audio alignment, transcript comparison, reader/Sentence Mode/video entry points, settings/privacy, mobile/e-ink accessibility.
