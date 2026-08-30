## 1. Core alignment library

- [x] 1.1 Add `src/lib/ebookAudiobookAlignment/types.ts` with TranscriptionTimeline, PlethoraAlignmentMap, locators
- [x] 1.2 Port MIT Storyteller errorAlign (utils, editDistance, backtraceGraph, errorAlign) — pure TS, no GPL
- [x] 1.3 Add `normalize.ts` and `transcriptionAdapter.ts`
- [x] 1.4 Add `chapterMatch.ts`, `alignChapter.ts`, `interpolate.ts`, `alignBook.ts`
- [x] 1.5 Add `playbackLookup.ts` and `persistence.ts`
- [x] 1.6 Add `ATTRIBUTION.md` for Storyteller MIT code

## 2. Tests

- [x] 2.1 Unit tests: normalization adversarial cases
- [x] 2.2 Unit tests: errorAlign (Storyteller vectors + custom adversarial)
- [x] 2.3 Unit tests: playback lookup (seek, forward cursor, large chapter, catch-up scan)
- [x] 2.4 Integration test: fixture timeline → align → lookup roundtrip
- [x] 2.5 Unit tests: monotonic timestamp enforcement after interpolation

## 3. Background worker

- [x] 3.1 Add `ebookAudiobookAlignment.worker.ts` with cancellation + progress
- [ ] 3.2 Wire worker to persistence (partial chapter save)

## 4. UI integration

- [x] 4.1 Add `useAlignmentPlayback` hook
- [x] 4.2 Upgrade `AudiobookEpubSyncView` — align action, progress, load map
- [x] 4.3 Extend `EPUBViewer` — word-level sync highlight + char-offset tap-to-seek hit test
- [x] 4.4 Shared `SPOKEN_WORD_HIGHLIGHT_SELECTORS` for `useSpokenWordFollow` (full follow wiring in sync view deferred)
- [ ] 4.5 Add settings flag `experimentalWordSync`

## 5. Progress & polish

- [ ] 5.1 Shared reading/listening position via aligned locator
- [x] 5.2 Confidence-based degraded highlighting
- [ ] 5.3 Deprecation cleanup notes for v1 alignment worker

## 6. Validation

- [x] 6.1 `npm run test` — new unit tests pass
- [x] 6.2 `npm run typecheck` — no errors in changed files
- [x] 6.3 Lint changed files
- [x] 6.4 Licensing review — no GPL imports
- [x] 6.5 Adversarial review of hot path — ref-based playback clock, monotonic timestamps, catch-up lookup
