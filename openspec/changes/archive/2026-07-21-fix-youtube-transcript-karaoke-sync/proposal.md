## Why

When users watch YouTube videos across all versions of the app (Desktop Tauri, Web/PWA, Mobile Android/iOS), the transcript fails to move smoothly as the video plays and words are spoken. A previous attempt to fix karaoke-style transcripts left critical race conditions where time-polling intervals failed to initialize when the YouTube player became ready, state changes desynchronized playing status, gaps between transcript cues caused highlight dropouts, and backend transcript endpoints discarded per-word timing offset data (`tOffsetMs`), leaving the UI with inaccurate fallback estimates.

## What Changes

- **Fix Time-Polling Race Condition in `YouTubeViewer`**: Ensure player time polling initializes reliably whenever `playerRef.current` becomes available and the video is playing, preventing the transcript clock from getting stuck at zero.
- **Robust Player State Tracking**: Synchronize `isPlaying` state across player events, state changes, buffering, and manual iframe controls.
- **Continuous Segment Active-Index Resolution**: Enhance active-segment matching in `TranscriptSync` to seamlessly handle inter-cue gaps and ensure auto-scroll follows smoothly without blinking or stalling.
- **Preserve True Word-Level Timings in Backend & API**: Update `api/youtube/transcript.py` (Vercel/cloud serverless function) to extract and return `tOffsetMs` word timing data (`words`) from YouTube `fmt=json3` timedtext tracks, providing true karaoke-style word highlighting across all platforms.
- **Propagate Word Timings**: Ensure `toTranscriptSegments` in `YouTubeViewer.tsx` forwards per-word timings to `TranscriptSync` so measured karaoke highlights animate accurately as words are spoken.

## Capabilities

### New Capabilities
- `transcript-karaoke-sync`: Automatic transcript scrolling and true word-level karaoke text highlighting synchronized with media playback across all platforms.

### Modified Capabilities
- `youtube-playback`: Adds reliable continuous time polling, active segment auto-scrolling, and word-level transcript playback synchronization.

## Impact

- **Frontend Code**: `src/components/viewer/YouTubeViewer.tsx`, `src/components/media/TranscriptSync.tsx`, `src/components/media/KaraokeText.tsx`, `src/utils/youtubeTranscriptBrowser.ts`.
- **Backend API**: `api/youtube/transcript.py` (extracts word timings from `fmt=json3`), `src-tauri/src/youtube.rs`.
- **Testing**: `src/components/media/__tests__/karaokeHighlight.test.tsx` (adds/updates tests for time polling, gap handling, and word timing sync).
