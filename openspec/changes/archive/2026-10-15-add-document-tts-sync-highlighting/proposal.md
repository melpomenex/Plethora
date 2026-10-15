## Why

Plethora already reads documents aloud via TTS and has partial word highlighting, follow-scroll, and listening-position persistence — but synchronization is fragmented across `ReaderTTSControls`, `wordTimings`, provider adapters, and reader-specific locators. The parallel ebook+audiobook alignment work introduces a second timing pipeline (`PlethoraAlignmentMap` + `PlaybackLookup`) that must share the same playback/highlight/follow abstraction. Without a unified `TimedTextMap` model, TTS and external-audio sync will diverge, duplicate lookup logic, and make cross-format behavior inconsistent.

## What Changes

- Introduce a **shared timed-text domain** (`TimedTextMap`, `TimedTextEntry`, `TextLocator`, `TimedTextPlaybackLookup`) consumed by document TTS and audiobook alignment
- **Unify playback lookup**: binary-search + cursor-advance engine shared across TTS chunks and alignment maps
- **Preserve and extend** existing anchored speech index (`ReaderSpeechIndex`), `WordHighlighter`, `useSpokenWordFollow`, and `ttsListeningPosition` — not replace them
- **Provider timing adapters**: formalize capability tiers (measured word → character alignment → synthesized duration → chunk/sentence fallback)
- **EPUB/reflowable**: section-keyed anchored highlighting via existing `SourceAnchor` + `sectionContainers`
- **PDF**: canonical `pdf-word` / `pdf-token` anchors via existing canonical pipeline; explicit scanned/OCR degradation
- **Narration follow UX**: consolidate on `useSpokenWordFollow` with `followSpokenWord` setting
- **Persistence/cache**: store measured `wordTimings` alongside cached TTS audio (existing); invalidate on text/voice/chunking changes
- **Tests**: deterministic fixture maps for lookup, chunk offset conversion, locator resolution, follow arbitration
- Fix remaining pause/resume/seek edge cases in the shared controller path where found

## Capabilities

### New Capabilities

- `document-tts-sync`: Unified timed-text model, TTS chunk provenance → timings → highlight/follow playback sync for EPUB/HTML/PDF readers
- `timed-text-playback`: Shared playback lookup engine (advance + seek) for any `TimedTextMap` producer
- `narration-follow`: Manual-scroll arbitration, re-center affordance, e-ink/reduced-motion behavior for document narration

### Modified Capabilities

- `transcript-karaoke-sync`: Extend shared word-timing types and lookup patterns (no user-visible regression)

## Impact

- **New**: `src/lib/timedText/` (types, lookup, TTS/alignment adapters)
- **Modified**: `ReaderTTSControls`, `WordHighlightLayer`, `wordTimings` integration, `ebookAudiobookAlignment/playbackLookup` (re-export shared engine)
- **Readers**: `DocumentViewer`, `PDFViewer` (canonical anchor wiring — mostly present)
- **TTS**: `api/tts/timing.ts`, provider capability flags, `ttsCache` timing sidecar
- **Settings**: `highlightSpokenWord`, `followSpokenWord` (existing v4 prefs)
- **Tests**: unit tests for timed-text module; existing ReaderTTS pause/resume tests remain
- **Parallel work**: `add-ebook-audiobook-word-alignment` adopts shared `TimedTextMap` instead of duplicating lookup
