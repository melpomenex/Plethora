## Why

Queue mode currently treats touch completion too broadly as an intent to reveal its interface, so ordinary document scrolling can expose rating orbs and other controls. Hardware volume-key scrolling can likewise reveal the interface even though the user's only intent is to move through the document, interrupting a focused reading experience.

## What Changes

- Require a deliberate, stationary tap on non-interactive content to show or hide the queue-mode overlay.
- Keep mobile rating orbs hidden by default and reveal them temporarily after a deliberate long press.
- Distinguish taps from touch scrolling, swipes, and other pointer movement so scrolling never toggles overlay visibility.
- Keep volume-key scrolling limited to document movement; it must not reveal the overlay or rating controls.
- Remove the EPUB mobile bottom toolbar entirely, including its progress, previous/next, reading-settings, table-of-contents, and close controls.
- Move EPUB progress and all useful navigation, table-of-contents, and reading-settings actions into the applicable top bar.
- Preserve existing interactive controls, text selection, document paging, and queue navigation behavior.
- Add regression coverage for tap, touch-scroll, and volume-key input paths.

## Capabilities

### New Capabilities
- `queue-overlay-activation`: Defines when the Queue Scroll Mode interface may be revealed and ensures scrolling input remains content-only.

### Modified Capabilities

None.

## Impact

- Queue Scroll Mode gesture and click handling in `src/pages/QueueScrollPage.tsx`.
- Hardware volume-key to scroll input handling and its integration with Queue Scroll Mode.
- Overlay visibility state passed to `ScrollOverlayControls`.
- Embedded Queue Scroll Mode rendering in `EPUBViewer`.
- Frontend interaction tests for touch/pointer gestures and hardware-key scrolling.
