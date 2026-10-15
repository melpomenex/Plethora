## Why

When users tap the "Details" button while reviewing items in the Queue (rendered via `ScrollOverlayControls` and `ItemDetailsPopover`), particularly on mobile devices or smaller viewports, the popover renders with `fixed inset-x-4 bottom-4` without a maximum height constraint or internal scrolling. Because the details view contains extensive document metadata (title, category, tags, stats, scheduling parameters, intervals, modifier inputs, and action buttons), the popover expands upwards beyond the top of the viewport.

This causes critical UX failures:
1. The header containing the "X" close button is pushed off-screen above the viewport and is completely unreachable.
2. The popover container does not have `overflow-y-auto`, making it impossible to scroll through the details content.
3. There is no full-screen backdrop/scrim to tap outside to dismiss, leaving users trapped in the details view with no way to close it or return to their queue.

Providing a responsive, scrollable bottom sheet presentation on mobile with a sticky header, close button, tap-to-dismiss scrim overlay, and bounded scroll area restores usability and accessibility.

## What Changes

- **Responsive Mobile Bottom Sheet & Scrim**: On mobile devices and compact viewports, render `ItemDetailsPopover` as a bottom sheet modal via a portal to `document.body` with a full-screen dimmed scrim overlay (`fixed inset-0 bg-black/60`).
- **Tap-to-Dismiss Scrim**: Tapping anywhere outside the sheet on the scrim dismisses the details modal immediately (with open-tap guards to prevent swallowing immediate touches).
- **Sticky Header with Accessible Close Button**: Keep the sheet header (`queue.itemDetails` title and `X` close button) pinned at the top so it never scrolls off-screen or gets clipped.
- **Scrollable Content Body**: Confine the sheet height to a viewport-safe boundary (e.g., `max-h-[85vh]` or `max-h-[calc(100dvh-2rem)]`) and make the content area scrollable with smooth touch momentum scrolling (`overflow-y-auto overscroll-contain`).
- **Desktop Height Bounding**: Constrain desktop popover presentation with `max-h-[calc(100vh-6rem)]` and internal scrolling so tall item details do not overflow low-height desktop displays.
- **Safe Area Padding**: Ensure the bottom of the sheet respects `env(safe-area-inset-bottom)` so bottom action buttons (Postpone, Delete) are not obscured by device home bars or gesture navigation.
- **Escape & Keyboard Dismissal**: Maintain reliable keyboard Escape handling across mobile and desktop.

## Capabilities

### New Capabilities
- `queue-item-details`: Covers responsive presentation, sticky navigation header, scrollable metadata layout, and dismissal interactions (backdrop scrim, close trigger, Escape key) for the queue item details popover/sheet.

### Modified Capabilities
*(None)*

## Impact

- `src/components/common/ItemDetailsPopover.tsx`: Refactored to support mobile bottom-sheet presentation with portal mounting, backdrop scrim, sticky header, and scrollable body.
- Existing tests covering `ItemDetailsPopover` and Queue scroll overlay interactions.
