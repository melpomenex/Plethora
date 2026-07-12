## 1. Gesture Intent Handling

- [x] 1.1 Identify the Queue Scroll Mode touch/click and volume-key event paths that can affect content scrolling or `showControls`, and establish a single stationary-tap movement tolerance.
- [x] 1.2 Add touch/pointer gesture tracking that records origin, movement, cancellation, interactive targets, and text-selection state without preventing native scrolling.
- [x] 1.3 Replace the touch-device synthetic-click toggle with a completed stationary-tap action so scrolls and swipes leave overlay visibility unchanged.
- [x] 1.4 Integrate the tap classifier with existing queue swipe and embedded-viewer handling to avoid double toggles or duplicate navigation.
- [x] 1.5 Add a cancellable mobile long-press gesture that temporarily reveals rating controls, including an embedded EPUB event bridge.

## 2. Volume-Key Scrolling

- [x] 2.1 Update or isolate the Queue Scroll Mode volume-key handler so it performs only content/boundary scrolling and never changes `showControls`.
- [x] 2.2 Verify volume-key input preserves both hidden and visible overlay states at scrollable positions and content boundaries.
- [x] 2.3 Suppress the EPUB previous/next, font, and TOC bottom toolbar when the viewer is embedded in Queue Scroll Mode while preserving standalone reader chrome.
- [x] 2.4 Relocate embedded EPUB TOC and reading-settings actions to Queue Scroll Mode's top bar while retaining queue navigation controls.
- [x] 2.5 Remove the EPUB mobile bottom toolbar entirely and relocate progress plus EPUB page navigation into the applicable top bar.

## 3. Regression Coverage

- [x] 3.1 Add interaction tests proving stationary taps toggle controls while taps on interactive elements and text-selection gestures do not.
- [x] 3.2 Add interaction tests proving touch scrolls, minor tap jitter, and queue-navigation swipes preserve overlay visibility.
- [x] 3.3 Add interaction tests proving configured volume-key scrolling moves content while preserving hidden or visible overlay state.
- [x] 3.4 Add regression coverage proving embedded EPUBs omit the bottom toolbar while standalone EPUBs retain it.
- [x] 3.5 Run the focused Queue Scroll Mode tests and the relevant frontend type-check/test suite, then resolve any regressions.
- [x] 3.6 Add regression coverage for rating-control visibility gating and relocated EPUB top-bar actions.
