## 1. Study Media Cache & TTS Bridge

- [x] 1.1 Implement `src/lib/study-plans/studyMode/studyMediaCache.ts` for offline caching of audio lesson & slide narration metadata and playback position per artifact/revision.
- [x] 1.2 Implement `src/lib/study-plans/studyMode/studyTtsBridge.ts` integrating Plethora's existing `generateSpeech` (`src/api/tts.ts`) with offline cache reuse and graceful `speechSynthesis`/timed fallback.

## 2. Playable Audio Lesson & Interactive Narrated Slides Players

- [x] 2.1 Build `PlayableAudioLessonPlayer` (`src/components/viewer/study-mode/PlayableAudioLessonPlayer.tsx`) with play/pause, seek scrubber, speed control (`0.75x`–`2x`), synchronized transcript highlighting, optional Active Recall Pauses, and offline cache status.
- [x] 2.2 Build `PlayableSlidesPlayer` (`src/components/viewer/study-mode/PlayableSlidesPlayer.tsx`) with step-by-step presentation, synchronized TTS narration, deterministic explanatory visual diagram strip, clickable source-anchor citations, embedded per-slide knowledge check, and offline cache status.
- [x] 2.3 Wire `PlayableAudioLessonPlayer` and `PlayableSlidesPlayer` into `StudyModeWorkspace.tsx` (`Explore` tab).

## 3. End-to-End Validation & Final Verification Gate

- [x] 3.1 Write comprehensive Wave 4 and cross-wave E2E tests in `src/lib/study-plans/studyMode/__tests__/wave4MediaAndE2E.test.tsx` covering playable audio lessons, recall pauses, offline media cache reuse, narrated slides with citations & embedded checks, and Read Mode non-regression.
- [x] 3.2 Run full verification gate across all 4 waves: `openspec validate` on all 4 changes, `npx tsc --noEmit`, `npx eslint`, `npx vitest run`, and `npm run build` (`vite build`).
