# Change: TTS Follow-Along, Exact Listening-Position Persistence, and Pause Correctness

Covers numbered requirements **#1 (TTS word highlighting + automatic follow-along scrolling), #2 (persist the exact TTS listening position), #5 (fix TTS pause jumping back to the session-start segment)**.

## Why

Three TTS behaviors are incomplete or buggy, and they are one coherent subsystem: a single canonical playback position should drive the highlight, the follow-along scroll, resume behavior, and persistence.

1. **Follow-along is largely implemented but fragile.** Word highlighting (`WordHighlighter` / `WordHighlightLayer`) and follow-along scrolling (`useSpokenWordFollow`) are wired and default-on (`highlightSpokenWord`/`followSpokenWord`, `src/utils/ttsSettings.ts:153–155`). What is broken is *continuity*: the pause bug (below) destroys the highlight/resume state, and measured word timings do not reliably flow through for every provider (several adapters are flagged `supportsWordTimings: false`, so the approximate synthesized fallback is used — acceptable, but it must be deterministic and must not visibly race the audio).
2. **The exact listening-position module exists but is orphaned.** `src/utils/ttsListeningPosition.ts` (IndexedDB `plethora-tts-positions-db` + localStorage fallback, full `TTSListeningPosition` shape, resolver) has **zero production callers** (only a benchmark). Nothing saves or restores where the user actually stopped listening across pause/stop/document-close/app-restart/Queue advancement.
3. **Pausing can jump playback back to the session-start segment.** Root causes in `src/components/common/ReaderTTSControls.tsx`:
   - `stopWordTracking()` calls `setWordOffset(0)` (line 298) — the exact paused word is discarded.
   - Resume's "moved" heuristic (lines 1095–1103) compares `wordOffsetRef.current` (zeroed) against the **first visible word at the viewport top** (`resolveViewportAnchorRef.current`). Because auto-follow parks the active word ~28% down the viewport, the viewport-top word is usually in an earlier chunk → `moved` is almost always `true` → `startAtPosition(viewport)` re-anchors playback backward to the top-of-viewport segment. For a session begun at chunk 0 with the viewport at the document top, this is exactly "the segment where the session started."
   - The `textFingerprint` reset effect (lines 511–534) resets `chunkIndex` to `getInitialChunk()` (session-start chunk), calls `stopAudio()`, and clears the buffer whenever the document text recomputes (EPUB `relocated` re-extraction, PDF/markdown DOM re-extraction). A text recompute during/after pause wipes the session position back to the start segment.

## What Changes

### 1. Canonical playback position
Introduce one canonical playback-session position in `ReaderTTSControls`: `{ chunkIndex, wordIndex, intraChunkMs }`, where `intraChunkMs` is derived from the live `audio.currentTime` (or the engine's equivalent). Everything else — active word highlight, follow-scroll `wordKey`, resume anchor, persisted listening position — is **derived** from this canonical position. No separate "initial/start index", "current segment index", "audio source", "resume index", and "paused segment" variables that can drift apart.

### 2. Word highlight advances with narration (mobile + desktop)
Keep the existing `WordHighlighter`/`WordHighlightLayer` pipeline. The active word index becomes a derived value of the canonical position rather than an independent zeroable variable. Timing preference: measured provider timings (`resolveChunkTimings` in `src/utils/wordTimings.ts`) when available and aligned; otherwise the deterministic synthesized fallback. The highlight must never visibly race ahead of or badly trail the audio; the `nextActiveWordIndex` commit gate (with its ~200 ms sticky tolerance) already provides this — preserve it.

### 3. Follow-along scrolling converges desktop and mobile
`useSpokenWordFollow` already runs on both desktop and mobile (compact mode when `window.innerWidth < 640`), for EPUB continuous, PDF, and reflowed text. Manual-scroll suspension already exists (arrival-based user-scroll detection + explicit Re-center). Keep this behavior and add regression coverage. No per-platform divergence: both platforms must follow, highlight, and not fight user scrolls.

### 4. Persist the exact listening position
Wire the existing `ttsListeningPosition.ts` module into production:
- **Save triggers:** throttled (existing 4 s throttle) while playing; immediate flush on pause, stop, unmount/unload, and before Queue advancement / document navigation away.
- **Restore:** insert as level 4 ("saved position") of the existing `resolveStartPosition` priority chain in `ReaderTTSControls` (`src/components/common/ReaderTTSControls.tsx:394–417`), so returning to a document resumes from where listening actually stopped. The saved position additionally wins over a live viewport that resolves EARLIER than it (the "TTS advanced past the manually viewed page" case); a viewport at/after the saved position wins (normal follow-sync). Explicit queued anchors (level 1) keep priority over both.
- **Document-change handling:** keyed on `textFingerprint`; if the document changed such that the anchor no longer resolves, fall back to the nearest resolvable position rather than the session start.
- **Interplay with reading position:** the TTS position becomes the meaningful resume location when TTS has advanced past the manually viewed page (consistent with existing Plethora behavior where the last active narration position wins on TTS resume). The visual reading position continues to be persisted separately (existing `ViewState` / `get_document_position` mechanisms are untouched).

### 5. Pause/resume correctness
Pausing freezes narration at the **current playback position**. It must NOT reset the active segment, highlighted word, reader viewport, persisted TTS position, playback cursor, or resume anchor to the session-start segment. Resume continues from the paused word. The only exceptions: (a) a deliberately queued anchor (TOC navigation while paused) rebases position — keep existing behavior; (b) the user deliberately scrolled while paused — re-anchor to the viewport position after a small look-behind (a few words/sentence context) so resumed speech is still audible context, not a jarring word-exact jump. Fix the two root causes (zeroed `wordOffset`, viewport-top "moved" heuristic, `textFingerprint` reset wiping session position) rather than masking the jump visually.

### Cross-feature sequence that must work
1. Start TTS around segment 37 → current word highlights.
2. Reader follows narration.
3. Playback reaches segment 51.
4. User pauses → nothing jumps backward.
5. User resumes → continues near segment 51.
6. User closes Plethora → reopens → returns to the document → resumes from the correct listening location.

## Impact

### Affected Specs
- `tts-playback-state-model` (new) — canonical vs derived state contract.
- `tts-word-highlight-follow` (new) — requirement #1.
- `tts-position-persistence` (new) — requirement #2.
- `tts-pause-resume-correctness` (new) — requirement #5.

### Affected Code Areas
- `src/components/common/ReaderTTSControls.tsx` — canonical position state, pause/resume logic, `textFingerprint` reset, save/restore wiring, `startAtPosition`/`resolveStartPosition`.
- `src/utils/ttsListeningPosition.ts` — first production callers; flush hook points; any bugs found while wiring.
- `src/components/viewer/DocumentViewer.tsx` — pass position-restore/resume props (lines ~8422–8450 where `ReaderTTSControls` is mounted; `handleTTSChunkChange` at 4720–4722).
- `src/components/common/WordHighlightLayer.tsx` / `src/utils/wordHighlighter.ts` — only if continuity bugs surface; do not rewrite the highlighter.
- `src/hooks/useSpokenWordFollow.ts` — verification and small fixes only.
- Tests: `src/components/common/__tests__/ReaderTTSControls.*.test.tsx` (add pause/resume suites), new `ttsListeningPosition` integration test, `src/hooks/__tests__/useSpokenWordFollow.test.ts` additions.

### Non-goals
- No new TTS provider or audio pipeline.
- No redesign of the TTS control bar or reader.
- No change to the `ttsCache` schema.
- No removal of the visual reading-position persistence (`ViewState`, `get_document_position`).