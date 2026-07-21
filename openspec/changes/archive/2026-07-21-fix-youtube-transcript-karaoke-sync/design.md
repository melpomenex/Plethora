## Context

When watching YouTube videos in Incrementum across Desktop Tauri, Web/PWA, and Mobile (Android/iOS), the transcript list and word-level karaoke text are intended to move continuously as words are spoken.

However, root-cause analysis revealed four key failures:
1. **Time-Polling Race Condition (`YouTubeViewer.tsx`)**: The time-polling `useEffect` was gated on `[isPlaying]`. When `isPlaying` became `true` before `playerRef.current` was populated by `onPlayerReady`, the effect executed `if (!playerRef.current) return;` and terminated without starting a timer. Because setting a `ref` does not trigger re-renders, the timer was never scheduled and `currentTime` remained frozen at `0`.
2. **Player State Desynchronization (`YouTubeViewer.tsx`)**: `isPlaying` was driven solely by `onStateChange` (event.data === 1). Player state transitions during buffering (state 3), iframe reloads, or touch play events caused `isPlaying` to get out of sync with the underlying iframe.
3. **Segment Gap Dropouts (`TranscriptSync.tsx`)**: Active segment lookup (`findIndex`) strictly checked `start <= currentTime < end`. Small timing gaps between cues or floating-point rounding errors caused `findIndex` to return `-1`, causing auto-scroll and highlight evaluation to pause/blink between cues.
4. **Backend Per-Word Timing Discard (`api/youtube/transcript.py`)**: The serverless transcript API fetched YouTube `fmt=json3` timedtext tracks containing per-word `tOffsetMs` values inside `event.segs`, but discarded `tOffsetMs` during JSON building. Consequently, `words` were missing from transcript responses and the frontend defaulted to crude linear word timing estimates (`synthesizeWordTimings`).

## Goals / Non-Goals

**Goals:**
- Fix the time-polling race condition so `currentTime` updates continuously whenever the YouTube player is playing.
- Synchronize `isPlaying` state reliably across player events, buffering, and seeking.
- Ensure active-segment lookup continuously maps current playback time to transcript rows, even during inter-cue silences/gaps.
- Extract and preserve YouTube `tOffsetMs` per-word timings (`words: WordTiming[]`) in `api/youtube/transcript.py`, `src/utils/youtubeTranscriptBrowser.ts`, and `src-tauri/src/youtube.rs`.
- Ensure karaoke word highlighting and auto-scrolling work smoothly on Desktop, Web, and Mobile.

**Non-Goals:**
- Re-architecting the YouTube embed player component from scratch.
- Changing SponsorBlock or video extract behaviors.

## Decisions

1. **Robust Time-Polling Loop in `YouTubeViewer`**:
   - Polling checks `playerRef.current` and queries `getCurrentTime()` whenever the player is mounted and active (checking both `isPlaying` state and `playerRef.current.getPlayerState()`).
   - We trigger poll initialization both on `isPlaying` state changes and when `onPlayerReady` sets `playerRef.current`.
   - Rationale: Eliminates the race condition where `playerRef.current` was null when `isPlaying` became true.

2. **Continuous Active Segment Mapping in `TranscriptSync`**:
   - `findIndex` resolves the active segment by finding the segment that contains `currentTime`. If `currentTime` lies between `seg[i].end` and `seg[i+1].start`, `seg[i]` remains active until `seg[i+1].start` is reached (unless user seeks prior to `seg[i].start`).
   - Rationale: Prevents active-segment flickering and keeps auto-follow smooth through inter-cue silence gaps.

3. **Extracting `words` (`tOffsetMs`) from YouTube `fmt=json3`**:
   - In `api/youtube/transcript.py`, parse each `seg` in `event.segs` to record `start_ms` (`event.tStartMs + seg.tOffsetMs`) and `end_ms`, outputting a `words: [{ word, start_ms, end_ms }]` array per segment.
   - Forward `words` in `youtubeTranscriptBrowser.ts` and `YouTubeViewer.tsx` to `TranscriptSync`.
   - Rationale: Enables true measured karaoke word highlighting from YouTube auto-captions instead of linear length-based estimates.

## Risks / Trade-offs

- **[Risk]**: Frequent cross-origin `getCurrentTime()` calls might degrade performance on weak mobile WebKit engines.
  - **Mitigation**: Maintain `250ms` poll cadence (`500ms` on WebKitGTK Linux) and interpolate locally via `useKaraokeClock` requestAnimationFrame loop for 60fps word highlight transitions.
- **[Risk]**: Videos without `fmt=json3` word timings (e.g. manual standard VTT captions) won't have `words`.
  - **Mitigation**: Fall back smoothly to `synthesizeWordTimings` with approximate styling, as already supported by `TranscriptSync` and `KaraokeText`.
