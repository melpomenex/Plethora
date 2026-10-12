## Why

On mobile devices (narrow phone viewports), when a user selects one or more items (such as documents in `DocumentsView`, queue items in `BulkActionBar`, extracts in `ExtractsList`, or cards in `DeckManager`), the bulk selection action bar suffers from critical usability and accessibility flaws:

1. **Severe horizontal clipping & unreachable actions**: Multiple action buttons (e.g., Select All, Tag, Move, Reprioritize, Suspend, Archive, Delete) are rendered in a rigid, non-wrapping flex row without horizontal scroll or overflow containment. On phone viewports (360px–412px wide), actions on the right (such as Suspend, Archive, and Delete) overflow entirely off-screen and cannot be seen or tapped.
2. **Dislocated top-anchored placement**: When users scroll through long lists on mobile and select an item, the action menu appears statically at the top of the container, completely outside the active viewport and out of the comfortable thumb zone. The user has no immediate feedback that actions have become available without scrolling back to the top.
3. **Collision with mobile navigation**: Existing floating bars (such as in `BulkActionBar`) lack safe-area and mobile navigation bar clearance on phone presentations, overlapping the bottom navigation bar and wrapping into massive multi-line blocks that obscure the underlying content.

A unified, responsive mobile bulk selection UX is needed across all surfaces where multi-selection occurs so that selection actions are thumb-accessible, never cut off, clear in state, and responsive to phone screen constraints.

## What Changes

- **Unified Responsive Bulk Action Bar (`ResponsiveBulkActionBar`)**:
  - Introduce a reusable, responsive bulk selection bar component aware of mobile shell presentation (`useMobileShell()`, `data-presentation="phone"`).
  - **Adaptive Placement**: On mobile phone viewports, the bar docks at the bottom of the screen as a floating contextual action bar positioned safely above the mobile bottom navigation bar (`bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px))`). On desktop viewports, it preserves clean header-embedded or centered toolbar placement.
  - **Horizontal Responsiveness & Overflow**: Action buttons never clip off-screen. Actions render in a single-row horizontally scrollable container with touch scrolling (`overflow-x-auto no-scrollbar touch-pan-x flex-nowrap`) and/or provide an explicit "More" (⋯) overflow affordance opening a mobile bottom sheet (`MobileContextMenuSheet`) when actions exceed available width.
  - **Compact Selection Header**: Compact selection counter badge (e.g., `1 selected` / `N selected`) paired with a one-tap Deselect / Clear button (✕), avoiding awkward multi-line text wrapping.
  - **Touch Target Sizing**: All interactive touch targets satisfy mobile accessibility standards (minimum 40–44px hit-slop on coarse pointer devices).
- **DocumentsView Integration**:
  - Replace the rigid inline top toolbar in `src/components/documents/DocumentsView.tsx` with the responsive bulk action bar.
  - On mobile devices, selecting documents surfaces the floating action bar in the thumb zone above the bottom nav without displacing the document search or filter controls, with all actions (Tag, Move, Reprioritize, Suspend, Archive, Delete) fully accessible.
- **Queue / BulkActionBar Integration**:
  - Adjust `src/components/queue/BulkActionBar.tsx` to respect mobile navigation bar offsets on phone presentation.
  - Prevent multi-line wrapping sprawl on phone screens, streamlining into horizontally scrollable chips or prioritized actions + overflow sheet.
  - Adapt configuration popovers (priority slider, postpone presets, tags) to open as bottom sheets on mobile devices.
- **ReviewQueueView, ExtractsList, & DeckManager Integration**:
  - Standardize bulk selection toolbars in `ReviewQueueView`, `ExtractsList`, and `DeckManager` to use the responsive bulk action bar pattern, eliminating layout clipping and out-of-viewport scrolling issues.

## Capabilities

### New Capabilities
- `mobile-bulk-selection-bar`: Defines the responsive, thumb-friendly mobile presentation and overflow behavior for multi-selection and bulk action toolbars across application surfaces.

### Modified Capabilities
<!-- None: This introduces a new cross-surface presentation capability for mobile bulk selection. -->

## Impact

- **Affected Components**:
  - `src/components/common/ResponsiveBulkActionBar.tsx` (new shared component)
  - `src/components/documents/DocumentsView.tsx`
  - `src/components/queue/BulkActionBar.tsx`
  - `src/components/review/ReviewQueueView.tsx`
  - `src/components/extracts/ExtractsList.tsx`
  - `src/components/review/DeckManager.tsx`
- **Styling**: `src/styles/mobile.css` (bottom navigation clearance and floating selection bar adjustments).
- **Testing**: Unit tests for `ResponsiveBulkActionBar`, updated tests for `DocumentsView`, `BulkActionBar`, and affected views validating mobile vs. desktop presentation.
- **Dependencies**: Uses existing `@phosphor-icons/react`, `useMobileShell`, `MobileContextMenuSheet`, and `useI18n`. No new external runtime dependencies.
