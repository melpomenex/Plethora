# Implementation Tasks

## 1. Canonical playback state (`ReaderTTSControls.tsx`)
- [x] 1.1 Introduce canonical position `{chunkIndex, wordIndex, intraChunkMs}`; make `wordOffset`/highlight, follow `wordKey`, and resume anchor derived from it
- [x] 1.2 Remove/audit independent start/current/resume index variables; keep `getInitialChunk` only as the initial-position resolver, never as a live reset target
- [x] 1.3 Keep `wordOffsetRef` in sync as a derived mirror; stop zeroing it in `stopWordTracking`

## 2. Pause/resume correctness (#5)
- [x] 2.1 Change `stopWordTracking` to cancel rAF without resetting `wordOffset`/canonical word index (keep visual marker behavior sensible)
- [x] 2.2 Fix the "moved" heuristic in `handlePlayPause` (lines ~1095–1103): base re-anchor only on deliberate user scroll (respecting `useSpokenWordFollow`'s `pausedByUser` state) or a queued anchor; never on the viewport-top word while auto-follow is active
- [x] 2.3 Add the sentence look-behind for deliberate-scroll resume
- [x] 2.4 Fix the `textFingerprint` reset effect (lines ~511–534): only reset on genuine fingerprint change; preserve session position on incidental re-extraction; never reset while paused
- [x] 2.5 Verify pause/resume for all three engines (cloud audio, system speechSynthesis, native Android) and all control paths (mouse, touch, keyboard/media keys)

## 3. Persistence (#2)
- [x] 3.1 Wire `saveTTSListeningPosition` on throttled playback + flush on pause/stop/unmount/unload/navigation/Queue advancement
- [x] 3.2 Add `getTTSListeningPosition` as level-4 "saved position" in `resolveStartPosition`; pass through `DocumentViewer`
- [x] 3.3 Implement fingerprint reconciliation (nearest-anchor fallback) on restore
- [x] 3.4 Keep reading-position persistence separate (no cross-contamination)

## 4. Highlight & follow verification (#1)
- [x] 4.1 Verify highlight continuity after pause/resume fixes; fix any highlighter bugs surfaced (no rewrite)
- [x] 4.2 Verify follow-along on desktop + mobile, EPUB continuous + PDF, and manual-scroll suspension/Re-center
- [x] 4.3 Confirm no full re-render per word (targeted updates only)

## 5. Tests
- [x] 5.1 Add `ReaderTTSControls.pauseResume.test.tsx`: pause at 51 keeps position (mouse), resume continues, touch/keyboard parity, viewport-top no-re-anchor
- [x] 5.2 Add fingerprint-reset regression test (relocated re-extraction while paused preserves position)
- [x] 5.3 Add `ttsListeningPosition` integration test: save/flush/restore, restart, document-change reconciliation, per-document independence
- [x] 5.4 Extend `useSpokenWordFollow.test.ts` for mobile compact mode and EPUB/PDF follow
- [x] 5.5 Add the cross-feature sequence test (start 37 → reach 51 → pause → resume → restart → resume from correct location)
- [x] 5.6 Run `npm run test:run` for affected suites; run `npm run bench:check` if any hot path changed

## 6. Spec
- [x] 6.1 Confirm all four spec files match implementation