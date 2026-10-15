## Context

The queue review page allows users to read documents, RSS items, flashcards, etc., and rate their familiarity. The current desktop rating buttons are locked to the right side of the screen. Users have requested the ability to move the rating panel to any edge of the screen (top, bottom, left, or right) to accommodate different devices, orientations, and left/right-handed usage.

## Goals / Non-Goals

**Goals:**
- Implement a draggable glassmorphic rating dock that snap-docks to the closest edge of the viewport (left, right, top, bottom).
- Provide quick layout relocation buttons (mini directional arrows or settings) on the dock for click-to-move convenience.
- Enhance the rating buttons to look like glowing, reflective glass orbs with sleek micro-animations.
- Save and persist the dock position in user settings.

**Non-Goals:**
- Changing the FSRS scheduler, the rating submission endpoints, or keybind-based rating logic.
- Changing mobile rating controls (which use a fixed bottom action bar).

## Decisions

### 1. Relocation Mechanic: Absolute Drag-to-Snap + Quick Directional Buttons
- **Drag-to-Snap**: We track standard mouse/touch events (`onMouseDown`, `onMouseMove`, `onMouseUp` & touch equivalents) directly on a drag handle. During drag, the dock follows the cursor as an absolutely positioned element. Upon release, it calculates the closest viewport edge:
  - `distLeft = x`
  - `distRight = viewportWidth - x`
  - `distTop = y`
  - `distBottom = viewportHeight - y`
  - Snaps to the minimum distance edge.
- **Directional Buttons**: A small positioning gear icon reveals directional placement arrows (left, right, top, bottom) so users can immediately snap the dock with a single click.

### 2. Glassmorphic Orb Visuals & Dynamic Layouts
- Depending on the snap-dock edge:
  - **Left/Right**: Vertical flexbox layouts. Tooltip labels slide out horizontally.
  - **Top/Bottom**: Horizontal flexbox layouts. Tooltip labels slide out vertically.
- **Glowing Glass Orbs**: Buttons styled using radial background gradients, outer glowing dropshadows corresponding to rating intensity (Again = Red, Hard = Orange, Good = Blue, Easy = Green), and a semi-transparent white top highlight reflex (`after:absolute after:top-1 after:w-2/3 after:h-[30%] after:bg-gradient-to-b after:from-white/30 after:to-transparent`) to mimic reflective glass.

### 3. Setting Schema Integration
- Add `ratingOrbsPosition` (values: `"left" | "right" | "top" | "bottom"`) under the `scrollQueue` category of `useSettingsStore` (Zustand).

## Risks / Trade-offs

- **[Risk: Dock overlaps document text or controls]** -> *Mitigation*: The dock is styled with glassmorphism (translucency + backdrop blur), and users can instantly drag or click it to another side of the screen if it gets in the way.
- **[Risk: Performance of dragging in rich Webviews]** -> *Mitigation*: Use requestAnimationFrame or standard React component state throttling to ensure rendering is smooth and does not lag document viewing.
