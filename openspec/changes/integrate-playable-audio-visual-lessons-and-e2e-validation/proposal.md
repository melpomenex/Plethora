## Why

Study Mode's `Explore` tab currently renders generated audio lessons and narrated slides as static text transcripts and bullet cards without real playback, synchronized highlighting, active recall pauses, or offline audio caching. Turning generated scripts into genuinely playable, cached audio and visual lessons wired to Plethora's existing TTS infrastructure—and validating all 4 overhaul waves end-to-end—completes the transformation of Study Mode into a cohesive, source-grounded learning workspace.

## What Changes

- **Playable Audio Lessons (`Explore` Tab)**:
  - Wire generated audio lesson scripts (single-speaker explanations and teacher–student dialogues) to Plethora's existing TTS pipeline (`src/api/tts.ts` + graceful speech synthesis fallback).
  - Provide real playback controls (play/pause, seek/scrubber across turns, playback speed `0.75x–2x`), synchronized transcript highlighting (clicking any turn seeks directly to it), and an optional **Active Recall Pause** mode that pauses after student/question turns so learners can think before resuming.
  - Cache synthesized audio segments and lesson metadata locally (`studyMediaCache.ts`) for offline playback without regenerating existing lessons.
- **Interactive Visual Lessons / Narrated Slides (`Explore` Tab)**:
  - Render slides as an interactive step-by-step presentation (`PlayableSlidesPlayer.tsx`) with synchronized TTS narration (play/pause, speed, auto-advance), deterministic structured explanatory visuals (zero unsafe HTML/JS execution), clickable source-anchor citations, and embedded per-slide knowledge checks.
  - Cache slide deck payloads and narration assets locally for offline reuse.
- **End-to-End Validation & Polish**:
  - Add comprehensive Wave 4 and cross-wave E2E tests covering playable audio, recall pauses, offline cache hits, narrated slides, Read Mode non-regression, and full verification gates (`tsc`, `eslint`, `vitest`, production `vite build`).
- **Reconciliation**: Extends and reconciles the unarchived `add-source-grounded-multimodal-learning-views` and `validate-study-mode-end-to-end` specs.

## Capabilities

### New Capabilities
- `study-mode-playable-media`: Playable TTS-backed Audio Lessons and Narrated Slides with seek/speed controls, synchronized transcript highlighting, optional active recall pauses, embedded slide checks, and local offline media caching.
- `study-mode-e2e-validation`: Automated end-to-end verification across all 4 Study Mode overhaul waves including offline cached media playback and Read Mode non-regression.

### Modified Capabilities
- (None in `openspec/specs/`; reconciles unarchived `add-source-grounded-multimodal-learning-views` and `validate-study-mode-end-to-end`.)

## Impact

- **New Logic Modules**: `src/lib/study-plans/studyMode/studyMediaCache.ts`, `src/lib/study-plans/studyMode/studyTtsBridge.ts`.
- **UI Components**: `src/components/viewer/study-mode/PlayableAudioLessonPlayer.tsx`, `src/components/viewer/study-mode/PlayableSlidesPlayer.tsx`, and updates to `StudyModeWorkspace.tsx`.
- **Tests**: `src/lib/study-plans/studyMode/__tests__/wave4MediaAndE2E.test.tsx`.
