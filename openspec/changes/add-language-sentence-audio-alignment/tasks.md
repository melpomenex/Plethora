## 0. Dependency gates

Requires #1/#2 and existing transcript/media contracts. Freeze alignment confidence, stale fingerprints, resolver result, and original-first/TTS-fallback behavior before #14/#15/#19/#20 implement media actions.

## 1. Alignment contract and schema

- [ ] 1.1 Define source-anchor/media-range, confidence, method, fingerprint, stale/error, and resolver result types.
- [ ] 1.2 Add SQLite alignment tables/indexes and repository APIs with version/staleness checks.
- [ ] 1.3 Add normalized ingestion adapters for Whisper/captions/audiobook pairing/audio editions/forced alignment.

## 2. Playback integration

- [ ] 2.1 Implement original-first resolver with TTS fallback and explicit user override.
- [ ] 2.2 Wire transcript/video/EPUB/audio-edition sentence seek/replay/loop and source-anchor navigation.
- [ ] 2.3 Expose media references/ranges to Flashcard Studio, mining, shadowing, and dictation contracts.

## 3. Verification

- [ ] 3.1 Test sentence/phrase alignment, caption-only, stale text/media, ambiguity, confidence tiers, and fallback.
- [ ] 3.2 Regression-test existing karaoke, audiobook, podcast, YouTube, TTS, listening position, and offline behavior.
- [ ] 3.3 Add large-transcript lookup benchmarks and provider consent/cache tests.
