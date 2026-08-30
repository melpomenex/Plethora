## Why

In-line YouTube playback recently broke following changes to the desktop runtime, Linux WebKitGTK graphics policies, and viewer component lifecycle:

1. **Linux WebKitGTK Hardware Acceleration**: Commit `2238238a` unified the Linux graphics policy and removed previously required WebKitGTK compatibility flags (`WEBKIT_DISABLE_HARDWARE_ACCELERATION`, `WEBKIT_DISABLE_COMPOSITING_MODE`, `WEBKIT_DISABLE_DMABUF_RENDERER`). Enabling hardware video acceleration on WebKitGTK causes YouTube HTML5/iframe playback to fail with black screens, error 5, or compositing hangs.
2. **Auto-Enable Inline Player Reset**: In `YouTubeViewer.tsx`, although `showInlinePlayer` was set to initialize to `true` to auto-play/embed on open, the `useEffect` keyed on `[documentId, videoId]` immediately resets `showInlinePlayer` to `false` on initial mount, leaving the viewer trapped in thumbnail mode.
3. **Codec Probe Guard Swallowing Play Clicks**: When `canPlayType` fails to detect H.264/MP4 in WebKitGTK, `inlinePlaybackLikelyUnsupported` is set. The primary action button at the bottom of the thumbnail contains `if (inlinePlaybackLikelyUnsupported && !forceInlinePlayback) return;`, silently discarding user clicks and preventing inline playback from launching.
4. **Origin and Host Scoping**: With Tauri 2.11+ localhost remote origin scoping, YouTube iframe embeds require predictable origin parameters and embed hosts (`youtube.com` fallback vs `youtube-nocookie.com`) to avoid iframe error 150/153 and postMessage dispatch failures.

This change fixes these regressions so YouTube videos open and play inline reliably across Tauri desktop environments, particularly on Linux.

## What Changes

- **Linux Graphics & WebKit Video Compatibility**: Restore the necessary WebKitGTK video playback safeguards on Linux (ensuring media/iframe compositing does not crash when hardware acceleration is active, or safely falling back for embedded media).
- **YouTubeViewer Lifecycle & Inline Playback Restoration**:
  - Prevent initial document load from clobbering `showInlinePlayer(true)`. When opening a YouTube document, the inline player should display directly unless explicitly switched or errored.
  - Remove silent click swallowing in thumbnail play button: when `inlinePlaybackLikelyUnsupported` is set, user interaction should still allow attempting inline playback rather than dead-ending.
  - Normalize `embedHost` and `playerVars.origin` handling so YouTube iframe API postMessage communication succeeds across `localhost` and Tauri protocols.
  - Ensure overlay elements (such as `LanguageVideoHost`) do not block pointer interaction or swallow player controls.
- **Regression Testing**: Add dedicated test coverage for `YouTubeViewer` mount, inline playback state, embed host resolution, and play click handling.

## Capabilities

### New Capabilities
<!-- None: uses existing capabilities -->

### Modified Capabilities
- `youtube-playback`: Restore in-line YouTube playback in Tauri desktop application, ensuring opening a YouTube document initializes the player inline and does not drop user interactions or fail under WebKitGTK graphics acceleration.

## Impact

- `src-tauri/src/graphics.rs`: Linux graphics policy WebKitGTK media compositing settings.
- `src-tauri/src/main.rs`: Linux startup environment variable configuration for WebKitGTK media stability.
- `scripts/tauri-wrapper.sh`: Linux dev wrapper environment variables for WebKitGTK.
- `src/components/viewer/YouTubeViewer.tsx`: Inline player state management, play button click handlers, and YouTube player embed options.
- `src/utils/youtubeEmbed.ts`: Embed host and URL resolution.
- Test suites: `src/components/viewer/__tests__/YouTubeViewer.test.tsx` (new test suite).
