## Context

Waves 1–3 established the resumable 4-tab/3-pane workspace, Guided Loop + adaptive multi-format Practice + unified Evidence Progress, and Contextual Tutor + Inline Personalization + Interactive Concept Map. Wave 4 turns the static Audio and Slides sub-views in `Explore` into playable, offline-cached learning experiences backed by Plethora's existing TTS pipeline (`src/api/tts.ts` + `src/utils/ttsCache.ts`), and executes full end-to-end validation.

## Goals / Non-Goals

**Goals:**
- Build `studyMediaCache.ts` for offline caching of synthesized audio lesson turns, slide narration assets, and playback progress keyed by `scopeKey + artifactId + sourceRevision`.
- Build `studyTtsBridge.ts` wrapping Plethora's `generateSpeech` (`src/api/tts.ts`) with clean fallback to Web Speech API (`speechSynthesis`) or timed transcript playback when no TTS provider is configured, so playback controls always work reliably across desktop, mobile, offline, and test environments.
- Build `PlayableAudioLessonPlayer.tsx` (play/pause, seek scrubber, speed selector, synchronized transcript highlight, Active Recall Pause checkpoint, offline cache badge).
- Build `PlayableSlidesPlayer.tsx` (step-by-step slide deck, synchronized TTS narration, deterministic visual concept diagram strip, clickable source-anchor citations, embedded per-slide knowledge check, offline cache badge).
- Validate all 4 waves end-to-end with Vitest, `tsc --noEmit`, `eslint`, and production `vite build`.

**Non-Goals:**
- Generating video files or adding external media player dependencies.
- Mutating `learning_evidence` mastery from passive audio/slide playback.

## Decisions

### 1. Local Offline Media Cache (`src/lib/study-plans/studyMode/studyMediaCache.ts`)
- Stores lightweight lesson cache manifests (`StudyCachedMediaManifest`) in `localStorage` keyed by `plethora.studyMode.media.<artifactId>` (tracking cached turn/slide audio URLs, durations, `sourceRevision`, `cachedAt`, and `lastPositionIndex`) and leverages Plethora's existing `ttsCache.ts` IndexedDB store whenever `generateSpeech` synthesizes audio.
- Provides `loadCachedStudyMedia`, `saveCachedStudyMedia`, and `clearCachedStudyMedia` with graceful error handling.

### 2. TTS Bridge (`src/lib/study-plans/studyMode/studyTtsBridge.ts`)
- `synthesizeStudySegment({ text, speaker, settings, signal })`:
  - First checks `studyMediaCache` / `ttsCache`.
  - Attempts Plethora's `generateSpeech` (`src/api/tts.ts`) when a TTS provider is configured and online.
  - Falls back cleanly to browser `window.speechSynthesis` or deterministic timed transcript playback (`durationSec` estimated from word count at 150 WPM) when offline or unconfigured, returning a unified `{ audioUrl, durationSec, source: 'tts_cache' | 'tts_provider' | 'speech_synthesis' | 'timed_transcript' }`.

### 3. Playable Audio & Slides Players
- `PlayableAudioLessonPlayer.tsx`: supports real `<audio>` playback when `audioUrl` is available, synchronized with turn index, speed (`0.75x`, `1x`, `1.25x`, `1.5x`, `2x`), range seek scrubber, click-any-turn to jump, and **Active Recall Pause** (when enabled, pauses after any `student` turn or `misconceptionCorrected` turn and displays a reflection prompt + "Resume Explanation" button).
- `PlayableSlidesPlayer.tsx`: renders each slide with a deterministic visual structure (objective header, structured key points + numbered flow diagram nodes, source citation chips, synchronized narration controls, and an embedded "Check this slide" reflection / quick-practice action).
