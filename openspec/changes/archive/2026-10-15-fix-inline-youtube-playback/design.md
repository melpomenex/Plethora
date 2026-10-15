## Context

See `proposal.md` for motivation.

In Plethora, YouTube documents are viewed using `src/components/viewer/YouTubeViewer.tsx`, which embeds videos using `react-youtube` and synchronizes transcripts and SponsorBlock segments. The desktop app runs on Tauri v2. Recent changes to the Linux graphics policy (`src-tauri/src/graphics.rs`, commit `2238238a`), Tauri 2.11+ localhost origin scoping (`commit a652eda3`), and lifecycle effects in `YouTubeViewer.tsx` introduced several issues that break inline playback:

1. Initial mount effect clobbering `showInlinePlayer`.
2. Silent click swallow in the thumbnail play button when codec probes report `likelyUnsupported`.
3. WebKitGTK media pipeline instability on Linux when hardware acceleration is forced without software media compositing safeguards.
4. Overlay obstruction from sibling elements like `LanguageVideoHost`.

## Goals / Non-Goals

**Goals:**
- Guarantee that opening a YouTube document presents the inline player immediately without dropping back to thumbnail mode on mount.
- Ensure user clicks on the thumbnail play button always initiate playback and bypass heuristic codec warnings (`forceInlinePlayback`).
- Ensure Linux WebKitGTK environment configuration safely supports HTML5/iframe video playback without hangs or blank screens.
- Prevent overlays from capturing clicks intended for the video player controls.
- Provide comprehensive automated test coverage for `YouTubeViewer` mount, user interactions, and error states.

**Non-Goals:**
- Replacing `react-youtube` with a custom iframe implementation.
- Changing video extraction or local download (`yt-dlp`) workflows.
- Altering graphics policies on macOS or Windows.

## Decisions

### 1. Differentiate Initial Mount vs Document Switch in `YouTubeViewer`
- **Choice**: Track the previous `documentId` using a ref (`prevDocumentIdRef`). Only reset `showInlinePlayer(false)` when transitioning from one valid document to a *different* document. On initial mount of a YouTube document, respect `showInlinePlayer = true` so the video player loads immediately.
- **Alternative considered**: Removing thumbnail mode entirely. Rejected because thumbnail mode is still useful as a fallback when playback errors occur or when switching documents to show resume timestamps.

### 2. Remove Silent Click Swallowing on Thumbnail Play Button
- **Choice**: In `YouTubeViewer.tsx`, modify the play button `onClick` handler so that if `inlinePlaybackLikelyUnsupported` is true, clicking the play button automatically sets `setForceInlinePlayback(true)` and invokes `handlePlayVideo()` instead of returning early with a no-op.
- **Alternative considered**: Hiding the play button when unsupported. Rejected because the codec heuristic (`canPlayType`) can produce false negatives in WebKitGTK and containerized environments where YouTube's iframe can still play via MSE or fallback formats.

### 3. Linux WebKitGTK Video Compositing Safeguards
- **Choice**: In `src-tauri/src/graphics.rs` and `scripts/tauri-wrapper.sh`, ensure WebKitGTK video playback compatibility flags are applied when running on Linux. Specifically, ensure `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` is preserved and provide a clean fallback mechanism (or default compatibility flags for media iframes) so hardware acceleration does not freeze the webview during video playback.
- **Alternative considered**: Disabling GPU acceleration completely across all of Linux. Rejected because GPU acceleration is beneficial for ambient canvas/WebGL themes; only media/compositing flags need careful handling.

### 4. Interactive Overlay Boundary for Video Viewer
- **Choice**: Ensure `LanguageVideoHost` and similar overlays in `YouTubeViewer` do not block interaction with the video container. Restrict pointer-events on the overlay container to only its actual UI controls.
- **Alternative considered**: Placing the overlay below the video. Rejected because the overlay layout is designed to sit alongside or on top of transcripts.

### 5. Automated Test Coverage
- **Choice**: Create `src/components/viewer/__tests__/YouTubeViewer.test.tsx` using `@testing-library/react` and `vitest`. Mock `react-youtube` and verify:
  - Component mounts with `showInlinePlayer === true`.
  - Clicking play activates inline player even if codec check reports missing codecs.
  - Correct embed host is supplied to `react-youtube`.
- **Alternative considered**: Only testing utility functions. Rejected because the regressions occurred in component lifecycle effects and click handlers.

## Risks / Trade-offs

- **[Risk] WebKitGTK variance across Linux distributions** → *Mitigation*: Support `PLETHORA_GPU_MODE=compatibility` / `PLETHORA_GPU_MODE=software` environment variables and surface clear diagnostic logging at startup.
- **[Risk] Autoplay policy restrictions in browsers/WebViews** → *Mitigation*: Keep `autoPlayOnOpen` optional and ensure the player can be cleanly started with a single user tap.
