## 1. TranscriptSync follow engine

- [x] 1.1 Replace the bottom-edge "only scroll when out of view" trigger with a comfort-offset scroll: when `activeIndex` changes, scroll so the active segment's top sits at the configurable reading offset (~25–30% from the top; smaller for `compact`). Skip the scroll if the segment is already within the comfort band.
- [x] 1.2 Remove the 2-second per-index throttle (`lastScrolledIndexRef` / `scrollThrottleRef` gate). Replace with a ~150ms debounce on `activeIndex` change so rapid segment transitions coalesce, plus a ~400ms minimum-interval guard against re-centering the same index on `currentTime` wobble.
- [x] 1.3 Add user-scroll detection: a `scroll` listener on `containerRef` that sets a `userScrollingRef` when the scroll is not immediately preceded by our own programmatic `scrollTo` (track via a brief `programmaticScrollRef` flag set around every `container.scrollTo` call).
- [x] 1.4 While `userScrollingRef` is set, suppress auto-follow scrolling on active-segment change but keep highlighting the active segment.
- [x] 1.5 Auto-resume follow: clear `userScrollingRef` when the active segment re-enters the visible region (playback catches up) or immediately when the user seeks (clicks a segment → `handleSegmentClick`).
- [x] 1.6 Add the persistent auto-follow toggle: read `localStorage['transcript-autoscroll']` (default `"true"`) on mount; add a header button (next to copy/export) that flips it and persists. When off, never auto-scroll but still highlight.
- [x] 1.7 Render a "Follow paused — click to resume" chip when follow is suppressed due to user scroll (desktop; on `compact` mobile rely on auto-resume only).

## 2. YouTube active-segment latency

- [x] 2.1 In `YouTubeViewer.tsx`, add a second lightweight interval (~250ms, ~500ms on Linux WebKitGTK via the existing detection) that only calls `playerRef.current.getCurrentTime()` and `setCurrentTime(time)`. Leave the existing 1000ms interval responsible for SponsorBlock + position saving.
- [x] 2.2 Verify the lighter poll does not duplicate SponsorBlock skips or position saves (it must only update `currentTime` and call `onTimeUpdate`).
- [x] 2.3 Confirm `handleSeek` still resets follow state (click-to-seek resumes follow) after the interval split.

## 3. Audiobook TranscriptPanel parity

- [x] 3.1 Update `TranscriptPanel.tsx`'s auto-scroll (lines 40–76) to the same comfort-offset + debounce + user-scroll-pause algorithm used in `TranscriptSync`.
- [x] 3.2 Back the existing "Auto-scroll" checkbox with the shared `transcript-autoscroll` localStorage key so the preference is consistent across viewers.

## 4. Verification

- [ ] 4.1 Manual test (desktop): play a YouTube video with transcript open; confirm the active line stays near the top quarter of the panel and advances promptly (under ~600ms) as speech moves.
- [ ] 4.2 Manual test (desktop): scroll the transcript up while playing; confirm follow pauses, the "paused" chip appears, and follow resumes when playback reaches the visible region.
- [ ] 4.3 Manual test: click a transcript segment while follow is paused; confirm it seeks and follow resumes immediately.
- [ ] 4.4 Manual test: toggle auto-follow off, close and reopen the document; confirm the preference persisted and the panel no longer scrolls (but still highlights).
- [ ] 4.5 Manual test (mobile/compact): confirm the smaller comfort offset and that rapid short segments don't stutter.
- [ ] 4.6 Manual test: open a local video (`LocalVideoPlayer`) and an audiobook chapter; confirm both follow playback with the same behavior.
- [ ] 4.7 Regression check: SponsorBlock skipping, position save/resume, transcript search, and click-to-seek still behave correctly after the interval split.
