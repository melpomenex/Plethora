## Context

`ItemDetailsPopover` renders document/item metadata and action controls from both the Queue scroll view (`QueueScrollPage`) and the Review Queue (`ReviewQueueView`). Currently, it renders an unconstrained `fixed inset-x-4 bottom-4` div without a portal, without a backdrop scrim, and without vertical max-height or scroll properties on mobile.

When an item has rich metadata (category, tags, stats summaries, memory stability/difficulty, preview intervals, raw json toggle, and action buttons), the container grows upwards past the top of the mobile screen. The user cannot see the header or close button, cannot scroll the content, and cannot tap outside to dismiss.

## Goals / Non-Goals

**Goals:**
- Provide a robust, thumb-friendly mobile bottom sheet presentation with safe-area insets and rounded top corners.
- Render a dimmed backdrop scrim with an open-tap guard that reliably dismisses the details view when tapped outside.
- Pin the header (`Info` icon, title, and `X` close button) so it is always visible at the top.
- Make the content body vertically scrollable with touch momentum (`overflow-y-auto overscroll-contain`).
- Constrain desktop popover presentation height with scroll support so it never overflows low-height displays.
- Use `createPortal` to mount mobile sheets directly into `document.body` to avoid stacking context and overflow clipping issues.
- Lock body scroll while the mobile details sheet is active.

**Non-Goals:**
- Restructuring the item metadata fields or altering the scheduling algorithms.
- Modifying the sub-modals (`TagItemsModalContent`, `ItemStatsModal`) beyond ensuring clean focus and z-index compatibility.

## Decisions

### 1. Render Mobile Bottom Sheet via `createPortal` to `document.body`
- **Choice**: When on mobile / touch screen, portal the scrim and sheet directly into `document.body`.
- **Rationale**: Queue pages and viewer overlays employ CSS transforms, backdrop filters, and intricate z-index stacking. Portaling guarantees the sheet and scrim sit cleanly atop the entire UI without clipping or transformed coordinate spaces.
- **Alternatives Considered**: Keeping inline rendering. Rejected because CSS transforms on ancestor elements break `position: fixed` behavior, causing the popover to position relative to the ancestor rather than the viewport.

### 2. Full-Screen Backdrop Scrim with Touch Guard
- **Choice**: Render an explicit `fixed inset-0 bg-black/60` scrim behind the sheet on mobile. Use an `openAtRef` timestamp (300ms guard) to ignore accidental touch-up events that initiated the popover opening.
- **Rationale**: Tapping anywhere outside the sheet immediately dismisses it, providing standard native modal ergonomics and preventing accidental taps on underlying queue navigation controls.
- **Alternatives Considered**: Document-level `mousedown` listener. Rejected because touch devices often suppress or retarget `mousedown` events, leaving users unable to tap outside to dismiss.

### 3. Pinned Header + Scrollable Content Body Architecture
- **Choice**: Split the sheet panel into a `flex flex-col` layout:
  - Top: Fixed header (`flex-shrink-0 border-b border-border`) with title, drag indicator, and prominent `X` button.
  - Middle: Scrollable body (`flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-3`).
  - Bottom: Safe-area inset spacer (`paddingBottom: max(16px, env(safe-area-inset-bottom, 0px))`).
- **Rationale**: Ensures the close button and title are always reachable even when scrolled down to review or trigger action buttons (Dismiss, Postpone, Delete).

### 4. Desktop Height Bounding and Inner Scrolling
- **Choice**: On desktop (`md:`), maintain the positioned dropdown popover below the trigger button, but apply `md:max-h-[min(650px,calc(100vh-6rem))] md:flex md:flex-col` with `overflow-y-auto` on the content section.
- **Rationale**: Prevents popover overflow on small laptop screens or split-screen desktop windows.

## Risks / Trade-offs

- **[Risk] Touch event bubbling**: Taps inside the sheet body could bubble to the scrim and unintentionally close the sheet.
  - **Mitigation**: Add `onClick={(e) => e.stopPropagation()}` on the sheet container.
- **[Risk] Sub-modal coexistence**: `TagItemsModal` and `ItemStatsModal` are opened from within the details popover.
  - **Mitigation**: Ensure sub-modals use higher z-index (e.g. `z-[10000]`) or mount via standard modal context so they sit atop the sheet.
- **[Risk] Body scroll lock leakage**: If component unmounts unexpectedly, body scroll could remain locked.
  - **Mitigation**: Restore `document.body.style.overflow` in the cleanup function of `useEffect`.
