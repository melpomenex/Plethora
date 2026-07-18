## Context

The Knowledge Universe feature currently renders a 3D WebGL scene of nodes and connections. However, it lacks mobile compatibility, resulting in:
1. Drawing under the Android system navigation bar/toolbar on tablets in landscape (desktop presentation mode).
2. The 3D view is offset to the right when detail panels/sidebars are open, hiding the focused node under the panel.
3. No gesture controls (pinch-to-zoom, panning) for touch-based devices.
4. The feature is completely missing from the mobile navigation.

This design outlines the changes to support mobile navigation, add responsive safe area layout paddings, implement multi-touch pinch-to-zoom/pan and right-click panning, and introduce camera projection offsets to keep focused nodes centered.

## Goals / Non-Goals

**Goals:**
- Add Knowledge Universe to the mobile "More" menu.
- Support pinch-to-zoom and two-finger panning on touchscreens.
- Support mouse-based panning (right-click or Shift/Ctrl+drag).
- Adjust the layout padding on Android/iOS native platforms to clear system navigation bars in all modes.
- Shift the camera projection center to the left when the selected node panel is open, keeping the node visible.

**Non-Goals:**
- Support 3D layout customization on mobile.
- Replace or redesign the existing detail panel.

## Decisions

### 1. PointerEvent-Based Multi-Touch Gestures in `UniverseEngine`
We will handle multi-touch interactions natively inside `UniverseEngine` using a pointer map:
- Maintain `activePointers = new Map<number, { x: number, y: number }>()`.
- In `pointerdown`, add pointer to map. If `activePointers.size > 1`, disable normal single-finger orbit rotation.
- In `pointermove`, if `activePointers.size === 2`, compare the distance and center of the two pointers with the previous frame's values to apply zoom and screen-space panning.
- In `pointerup` / `pointercancel`, delete pointer. If 1 pointer remains, resume single-pointer mode.

*Rationale:* Avoiding external gesture library dependencies (like Hammer.js) keeps the async bundle size minimal and ensures direct integration with Three.js rendering lifecycle.

### 2. Camera Viewport Projection Offsetting
Instead of shifting the camera target coordinates (which would throw off the orbit rotation center), we will use Three.js's native `setViewOffset` method on the `PerspectiveCamera`:
- Add `setViewportOffset(offset: number)` to `UniverseEngine`.
- When a node is selected, React triggers a `useEffect` inside `KnowledgeUniverse.tsx` to set the offset (e.g., `180px` to the left) if not on a narrow phone.
- `setViewOffset` shifts the camera's optical center to the left, centering the node in the remaining visible space (left side of the screen) while keeping the target node as the center of rotation.

*Rationale:* This prevents the focused node from being hidden under the right-aligned detail panel without breaking the orbit camera rotation behavior.

### 3. Safe Area Padding Rules in `index.css`
We will decouple safe area inset variables from the `data-presentation` attribute:
- Always define `--shell-safe-top`, `--shell-safe-bottom`, etc. using CSS `env(safe-area-inset-*)` when `data-platform` is `"android"` or `"ios"`.
- When `data-presentation` is `"desktop"` (e.g. tablet landscape) on a native platform, apply `padding-bottom: var(--shell-safe-bottom)` to the `.adaptive-shell-root`.

*Rationale:* This ensures that even when running in desktop mode on a mobile tablet, the application layout clears the system navigation bar at the bottom.

## Risks / Trade-offs

- **[Risk] Touch conflict with browser behaviors** → *Mitigation:* Set `style={{ touchAction: "none" }}` on the canvas to prevent browser gestures like scrolling or pull-to-refresh.
- **[Risk] Jittery multi-touch transitions** → *Mitigation:* Clear `lastPinchDist` and `lastPinchCenter` on pointer-up/pointer-down transitions to prevent sudden jumps when fingers are added/removed.
