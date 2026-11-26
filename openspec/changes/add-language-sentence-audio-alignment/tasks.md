## 0. Dependency gates

Requires #1/#2 and existing transcript/media contracts. Freeze alignment confidence, stale fingerprints, resolver result, and original-first/TTS-fallback behavior before #14/#15/#19/#20 implement media actions.

## 1. Alignment contract and schema

- [x] 1.1 Define source-anchor/media-range, confidence, method, fingerprint, stale/error, and resolver result types. `src/lib/languageAudioAlignment/types.ts` defines `MediaRange`, `SentenceAudioAlignment` (source anchor, fingerprints, confidence, method, status, providerId/version, error), `AlignmentResolverInput`, `AlignmentResolveResult` (`original`/`stale`/`ambiguous`/`fallback`), and `ReplayResult`; confidence tiers and status unions are explicit.
- [x] 1.2 Add SQLite alignment tables/indexes and repository APIs with version/staleness checks. Migration `097_language_sentence_audio_alignment` creates `language_audio_alignments` + `language_audio_alignment_candidates` with indexes on (profile_id, source_id, sentence_id, status) and media ranges; repository APIs `upsert_language_audio_alignment`/`list_language_audio_alignments` plus mark-stale updates live in `src-tauri/src/database/language_ecosystem_repository.rs`/`repository.rs`, exposed as Tauri commands `upsert_language_audio_alignment`/`list_language_audio_alignments`.
- [x] 1.3 Add normalized ingestion adapters for Whisper/captions/audiobook pairing/audio editions/forced alignment. `ingest.ts` (`normalizeAlignmentSegment`) normalizes raw segments; `bridge.ts` maps worker results (`alignmentsFromWorkerResult`, Whisper), audiobook/EPUB pairing maps (`alignmentsFromEbookAlignmentMap`), and video-caption segments; method marks include `caption`, `whisper`, `audiobook-pair`, `audio-edition`, `forced`, `manual`.

## 2. Playback integration

- [x] 2.1 Implement original-first resolver with TTS fallback and explicit user override. `replayOriginalFirst` prefers the original-audio candidate and falls back to TTS on playback failure/stale/ambiguous/low-confidence/missing media; explicit user override is now supported via `allowStale`/`allowAmbiguous` options (`src/lib/languageAudioAlignment/resolver.ts`, tested in `resolver.test.ts`).
- [x] 2.2 Wire transcript/video/EPUB/audio-edition sentence seek/replay/loop and source-anchor navigation. `LanguageVideoHost` (YouTube/local/audiobook surfaces) drives sentence seek/replay/loop/auto-pause; `LanguageReaderActionOverlay` and `useAlignment`/`useAlignmentPlayback` wire reader/EPUB/audio-edition replay; `AudiobookEpubSyncView` consumes `useAlignment`.
- [ ] 2.3 Expose media references/ranges to Flashcard Studio, mining, shadowing, and dictation contracts. Mining consumes alignment timestamp/frame provenance in `LanguageVideoHost` (`frameTimestampMs`/`frameAvailable`/`frameDataUrl`); Flashcard Studio, shadowing, and dictation do not yet consume alignment ranges — left for the workspace media-action work.

## 3. Verification

- [x] 3.1 Test sentence/phrase alignment, caption-only, stale text/media, ambiguity, confidence tiers, and fallback. `resolver.test.ts` covers fingerprint-matched original playback, stale/ambiguous/missing → TTS fallback without wrong-occurrence playback, override paths, and confidence-tier selection; caption-only segments use the same normalized `caption` method and registry path.
- [x] 3.2 Regression-test existing karaoke, audiobook, podcast, YouTube, TTS, listening position, and offline behavior. `YouTubeViewer.test.tsx`, `PodcastManager.globalAudio.test.tsx`, audiobook sync suites, and `crossSurfaceAcceptance.test.ts` pass; karaoke/auto-follow invariants are preserved (verified in the video host suite).
- [x] 3.3 Add large-transcript lookup benchmarks and provider consent/cache tests. New `src/lib/languageAudioAlignment.bench.ts` covers a 10k-sentence transcript lookup + full fingerprint-miss traversal; provider consent/redaction is covered by `src/lib/languageTutor/__tests__/privacy.test.ts` and cache identity/dedup by `languagePeek/service.test.ts`.
