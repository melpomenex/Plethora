## 0. Dependency gates

Requires #1/#2/#8 and existing transcription/media contracts. Stabilize the shared practice attempt/recording/comparison contract before #20, #21, and #22 add producers or consumers.

## 1. Practice contract and storage

- [ ] 1.1 Define shadowing session/attempt/source-media/recording-policy/comparison/confidence types.
- [ ] 1.2 Add minimal SQLite practice history and optional local recording references with retention/delete/export policy.

## 2. Playback and capture

- [ ] 2.1 Integrate Sentence Mode/video/transcript/source-anchor entry and original-audio-first/TTS fallback.
- [ ] 2.2 Add microphone permission/capture lifecycle with desktop/mobile capability checks and cancel/delete.
- [ ] 2.3 Integrate local/cloud STT routing, language-aware answer normalization, comparison, uncertainty, and retry modes.

## 3. Verification and handoff

- [ ] 3.1 Test immediate/listen-first/continuous flows, audio alignment, TTS fallback, permission denial, offline, and provider failures.
- [ ] 3.2 Test Queue/reader/listening invariants, privacy/retention, accessibility/e-ink, and active evidence.
- [ ] 3.3 Publish reusable attempt/comparison contract for pronunciation feedback without adding phoneme claims here.
