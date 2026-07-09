## Why

The rating interface in Scroll Mode / Optimal Queue is static and locked to the right side of the screen. This causes suboptimal UX as it can block content, is inconvenient for left-handed users or tablet users, and lacks modern design elements. Enabling users to drag or snap the rating panel to any side of the device (top, bottom, left, or right) provides a more flexible, ergonomic, and stunning user experience.

## What Changes

- **Flexible Rating Panel Position**: Introduce a relocatable rating control dock that can snap to any side of the screen (Left, Right, Top, or Bottom).
- **Interactive Drag-to-Snap & Quick Controls**: Users can drag the rating dock to snap it to the nearest edge, or use quick directional click controls to move it immediately.
- **Stunning Glassmorphic Visuals**: Redesign the rating buttons as glowing glass orbs (with rich gradients, outer shadows, light reflections, hover expansions, and active click animations).
- **Settings Persistence**: Persist the selected rating orb position in user settings so that it remains in the same position across sessions.

## Capabilities

### New Capabilities

*(None)*

### Modified Capabilities

- `document-rating`: The document rating controls in Scroll Mode SHALL support relocatable positioning (Left, Right, Top, or Bottom edges of the screen) which snaps to the nearest edge when dragged or repositioned, and this preference is persisted.

## Impact

- `src/stores/settingsStore.ts`: Add `ratingOrbsPosition` setting to `ScrollQueueSettings` and defaults.
- `src/components/queue/ScrollOverlayControls.tsx`: Update the desktop side-rating controls into a relocatable, draggable glassmorphic dock with layout adaptability based on the active side (vertical on left/right, horizontal on top/bottom).
- `src/components/queue/ScrollQueueSettings.tsx`: Add a dropdown/position selector in the Queue Settings modal as an alternative configuration.
- `src/pages/QueueScrollPage.tsx`: Connect settings to `ScrollOverlayControls`.
