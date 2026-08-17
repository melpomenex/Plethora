## Context

The Incrementum desktop app provides a collapsible navigation toolbar (configured at `top`, `left`, or `right`) with quick access to features like Settings, Review, Queue, Documents, RSS, and Command Palette. When users hover or focus the rail, it expands to show full button labels. 

However, clicking any navigation button (e.g., Settings) leaves DOM focus on that button. When the pointer leaves the rail into the newly displayed page (e.g., Settings view), `handlePointerLeave` detects that `focusInsideRef` is `true` and prevents the close timer from running. Because clicking non-focusable areas on the page does not move DOM focus, the toolbar stays permanently expanded, directly overlapping and obscuring the page's sidebar and contents.

## Goals / Non-Goals

**Goals:**
- Guarantee that the toolbar rail reliably collapses when the pointer leaves the rail, regardless of whether a button was clicked or has DOM focus.
- Ensure the toolbar rail immediately collapses whenever the active tab, route, or view changes.
- Ensure clicking anywhere outside the toolbar rail collapses any expanded rail state.
- Retain keyboard accessibility so keyboard users (`Tab` navigation) can expand and navigate the rail, with automatic collapse when focus leaves the toolbar.

**Non-Goals:**
- Redesign the visual styles or animations of the toolbar rail.
- Change the configurable toolbar positions (`top`, `left`, `right`).

## Decisions

1. **Unblock pointer leave collapse**:
   - Update `handlePointerLeave` so that moving the pointer outside the toolbar rail always schedules the collapse timer (`CLOSE_DELAY_MS`), regardless of `focusInsideRef`. If a button had focus due to mouse click, the toolbar will collapse as expected when the cursor leaves.
   - When the collapse timer expires and collapses the rail, if `document.activeElement` is still within the toolbar rail, blur it to prevent stale focus locks.
   - *Alternatives considered*: Distinguishing focus-visible via `:focus-visible` checks. While `:focus-visible` helps, scheduling collapse on pointer leave directly aligns with user intent when moving the mouse into content.

2. **Sync with active tab / view changes**:
   - Track active tab changes via `useTabsStore`. When the active tab changes (such as opening Settings, switching to Review, or navigating via keyboard shortcut), immediately reset `expanded` to `false`, clear pending open/close timers, and blur any focused element in the rail.
   - *Rationale*: Navigating to a new view is a clear signal that the navigation interaction is complete and the toolbar should not obscure the new view.

3. **Outside interaction listener**:
   - Add a document-level `pointerdown` handler when the toolbar is expanded. If a click/touch occurs outside the toolbar rail, collapse the toolbar immediately.
   - *Rationale*: Provides defense-in-depth so any click on the page (even without pointerleave events in edge cases like window blur or modal popups) cleans up the expanded overlay.

4. **Action button click handling**:
   - On toolbar button click, blur the button and reset open timers so clicked actions don't leave residual focus holding the toolbar open.

## Risks / Trade-offs

- *[Risk]* Keyboard-only users might have their focus unexpectedly blurred if a pointer event fires.
  → *Mitigation*: Only clear focus and collapse on pointer leave when the pointer was actually inside the rail (`pointerInsideRef === true`). Pure keyboard navigation does not trigger pointer events.
- *[Risk]* Fast tab switching could cause race conditions with open/close timers.
  → *Mitigation*: Timers are systematically cleared on tab change, unmount, and outside clicks.
