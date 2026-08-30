## 1. Shared timed-text domain

- [x] 1.1 Create `src/lib/timedText/types.ts` with `TimedTextMap`, `TimedTextEntry`, `TextLocator`, `TimedTextSource`
- [x] 1.2 Create `src/lib/timedText/playbackLookup.ts` with `TimedTextPlaybackLookup` (binary search + cursor advance)
- [x] 1.3 Create `src/lib/timedText/fromTtsChunk.ts` — build map slice from `TTSChunk` + `WordTiming[]`
- [x] 1.4 Create `src/lib/timedText/fromAlignmentMap.ts` — adapt `PlethoraAlignmentMap` → `TimedTextMap`
- [x] 1.5 Create `src/lib/timedText/index.ts` public exports
- [x] 1.6 Refactor `ebookAudiobookAlignment/playbackLookup.ts` to delegate to shared lookup (thin wrapper, preserve API)

## 2. TTS playback integration

- [x] 2.1 Create `src/hooks/useTimedTextPlayback.ts` — RAF-throttled clock → lookup → callbacks
- [x] 2.2 Wire `ReaderTTSControls.startWordTracking` through `TimedTextPlaybackLookup` + chunk map builder
- [x] 2.3 Add `pdfScannedDetection` helper for canonical pages without native text words
- [x] 2.4 Expose chunk-level degradation flag to `WordHighlightLayer` when PDF lacks word anchors
- [x] 2.5 PDF page-scoped `sectionContainers` for anchored highlighting (fixed + reflow)
- [x] 2.6 EPUB href-based section routing (replace text-fingerprint-only mapping)

## 3. Tests

- [x] 3.1 Unit tests: `playbackLookup.test.ts` (advance, seek, empty map)
- [x] 3.2 Unit tests: `fromTtsChunk.test.ts` (locator mapping, positional alignment)
- [x] 3.3 Unit tests: `fromAlignmentMap.test.ts` (audiobook adapter)
- [x] 3.4 Unit tests: `pdfScannedDetection.test.ts`

## 4. Validation

- [x] 4.1 Run `npm test` on new + affected test files
- [x] 4.2 Run TypeScript typecheck
- [x] 4.3 Run lint on changed files
