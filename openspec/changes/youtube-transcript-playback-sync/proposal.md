## Why

The YouTube transcript panel does not reliably follow playback. The active line is detected from a 1-second poll, auto-scroll is further throttled to once per 2 seconds per segment, and it only fires when the active segment is already *outside* the visible area (80px padding). The result is a transcript that appears "stuck" — the highlight changes but the list does not visibly move with the spoken word, so users lose their place and miss the karaoke-style read-along experience they expect.

## What Changes

- Keep the active transcript segment pinned within the visible region as the video plays, scrolling smoothly and promptly when a new segment becomes active (not only when the current one has already scrolled out of view).
- Move the active line toward a comfortable reading position (near the top/center of the panel) rather than letting it drift to the bottom edge before triggering a scroll, so it always "leads" the eye.
- Reduce the scroll latency: the active-segment detection and the auto-scroll no longer depend on a 2-second-per-index throttle that suppresses motion between short segments.
- Respect user scrolling: when the viewer manually scrolls the transcript (to read ahead or look back), auto-scroll pauses until the active line is far enough out of view (or playback catches up) rather than fighting the user.
- Add a small "auto-scroll on/off" affordance (consistent with the audiobook `TranscriptPanel`) so users can pin the view manually.
- Apply the same improvements to `LocalVideoPlayer` and the audiobook `TranscriptPanel`, since they share the `TranscriptSync` component and the same scroll-to-active pattern.

## Capabilities

### New Capabilities
- `transcript-playback-sync`: Auto-following behavior that keeps the transcript list aligned to media playback time, including user-scroll detection, latency characteristics, and the manual auto-scroll toggle.

### Modified Capabilities
- `youtube-playback`: Adds the requirement that the transcript list scrolls to keep the active segment within a comfortable reading position during inline playback, and pauses while the user is manually reading.

## Impact

- **Code**: `src/components/media/TranscriptSync.tsx` (shared scroll-to-active logic — primary), `src/components/viewer/YouTubeViewer.tsx` (poll interval + `currentTime` plumbing), `src/components/viewer/LocalVideoPlayer.tsx` (same plumbing), `src/components/media/TranscriptPanel.tsx` (parallel audiobook implementation).
- **APIs/dependencies**: No new dependencies. Uses existing `react-youtube` IFrame API and HTML5 `<video>` `timeupdate` where available.
- **Storage**: One new localStorage key for the auto-scroll preference (default on), consistent with the existing `transcript-visibility` / `transcript-panel-width` keys.
- **Risk**: Low–medium. All changes are in the transcript scroll layer; playback, seeking, SponsorBlock, and search remain untouched. Main risk is over-scrolling on mobile/side layouts, mitigated by user-scroll-pause and per-layout positioning.
