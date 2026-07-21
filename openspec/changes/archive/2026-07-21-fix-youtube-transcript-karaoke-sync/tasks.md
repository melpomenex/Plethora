## 1. Frontend Player Time-Polling & State Fixes

- [x] 1.1 Fix race condition in `YouTubeViewer.tsx` time-polling `useEffect` by triggering poll setup when `playerRef.current` is set in `onPlayerReady`.
- [x] 1.2 Update `onPlayerStateChange` in `YouTubeViewer.tsx` to handle buffering, cued, and play state transitions reliably without dropping time polling.
- [x] 1.3 Ensure `toTranscriptSegments` in `YouTubeViewer.tsx` maps and preserves per-word timings (`wordTimings: seg.words`).

## 2. Transcript Synchronization & Inter-Cue Gap Handling

- [x] 2.1 Refactor active segment resolution in `TranscriptSync.tsx` to maintain active index during inter-cue gaps and prevent highlight flickering.
- [x] 2.2 Verify `useKaraokeClock` in `TranscriptSync.tsx` interpolates smoothly between `currentTime` samples during playback.

## 3. Backend & API Per-Word Timing Extraction

- [x] 3.1 Update `api/youtube/transcript.py` to parse `tOffsetMs` from YouTube `fmt=json3` timedtext tracks and return per-word timings (`words: [{ word, start_ms, end_ms }]`).
- [x] 3.2 Update `src/utils/youtubeTranscriptBrowser.ts` to type and pass through `words` per-word timings.

## 4. Verification & Testing

- [x] 4.1 Update and run unit tests in `src/components/media/__tests__/karaokeHighlight.test.tsx` to verify time polling, segment gap handling, and word timing synchronization.
- [x] 4.2 Verify frontend build passes without TypeScript or lint errors (`npm run build`).
