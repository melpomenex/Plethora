## Why

Listening comprehension needs a deliberate practice loop that is different from reading or flashcard review. Plethora's sentence/audio/transcript/TTS infrastructure can support dictation with tolerant language-aware comparison and meaningful error display without requiring a new scheduler.

## What Changes

- Add sentence/audio dictation: play without text, accept typed answer, compare, reveal sentence/translation, replay, retry.
- Prefer original aligned audio, then TTS; support documents, native audio, podcasts, videos, and vocabulary sentences.
- Normalize punctuation/case/optional diacritics while visually identifying meaningful omissions/errors.
- Track error categories for analytics/recommendations and optionally strengthen an explicitly linked learning item.

## Dependencies

- Hard: profiles, processing, sentence translation, sentence/audio playback/alignment, existing learning-item/review contracts.
- Soft: video mode, SRS integration, shadowing, analytics/recommendations.
- Extends Sentence Mode/TTS/transcript infrastructure; no new scheduler.

## Capabilities

### New Capabilities

- `language-dictation-mode`: Listening prompt, answer normalization/comparison, error feedback, sources, history, and platform behavior.

### Modified Capabilities

- None; existing review answer assessment remains separate unless explicitly linked.

## Impact

- Practice/session schema/APIs, source audio resolver, normalization/comparison utilities, Sentence Mode/video/transcript entry points, analytics, Flashcard Studio optional strengthening, and accessibility/mobile/e-ink UI.
