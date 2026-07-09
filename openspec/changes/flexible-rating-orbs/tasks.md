## 1. Settings Store and Types

- [x] 1.1 Add `ratingOrbsPosition` field to `ScrollQueueSettings` interface and `defaultSettings.scrollQueue` inside `src/stores/settingsStore.ts`.

## 2. ScrollOverlayControls Component Update

- [x] 2.1 Update `ScrollOverlayControlsProps` to accept `ratingOrbsPosition` and an update callback.
- [x] 2.2 Implement custom drag event handlers (mouse and touch) for the rating panel to support real-time dragging.
- [x] 2.3 Add viewport edge distance snapping logic on drag release to determine the nearest edge (left, right, top, bottom) and call update callback.
- [x] 2.4 Style the rating dock container as a floating glassmorphic panel with drag handle and active quick-snap direction buttons.
- [x] 2.5 Style the rating buttons as glowing glass orbs using radial gradients, outer glows, and white top reflex highlights.
- [x] 2.6 Dynamically adjust tooltip animations and orientation based on the active snap-dock position.

## 3. Settings Modal Integration

- [x] 3.1 Update `ScrollQueueSettings.tsx` to include an option to choose the default Rating Orbs Position.

## 4. Page Integration

- [x] 4.1 Pass setting state and update handler from shallow settings store to `ScrollOverlayControls` in `src/pages/QueueScrollPage.tsx`.

## 5. Verification & Testing

- [x] 5.1 Verify drag-and-snap coordinates and visual snappy transitions across all edges.
- [x] 5.2 Validate settings persistence when opening/reloading queue pages.
- [x] 5.3 Verify that rating submissions and keyboard shortcuts continue to work correctly.
