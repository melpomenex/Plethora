## 1. Global Styles & Layout Padding

- [x] 1.1 Update `src/index.css` to define safe area custom properties (`--shell-safe-top`, etc.) for android and ios platforms unconditionally, independent of presentation mode.
- [x] 1.2 Add padding rules in `src/index.css` for android and ios platform hosts in desktop presentation mode to apply bottom padding equal to `--shell-safe-bottom`.

## 2. WebGL Engine Interaction (Pinch Gestures & Panning)

- [x] 2.1 Add fields in `UniverseEngine` (`src/components/graph/universe/engine.ts`) to track active pointers (`activePointers` map), viewport offset (`viewportOffset`), and pinch tracking variables (`lastPinchDist`, `lastPinchCenter`, `isPanningMode`).
- [x] 2.2 Implement `panCameraTarget(dx, dy)` in `UniverseEngine` to calculate camera right/up vectors and scale camera target displacement proportionally to distance.
- [x] 2.3 Update `handlePointerDown` to track touch pointers in the map and detect right-click or modifier drag panning.
- [x] 2.4 Update `handlePointerMove` to compute two-finger pinch-to-zoom and pan when two pointers are active, and pointer panning/rotation when one pointer is active.
- [x] 2.5 Update `handlePointerUp` to release pointers from map, reset pinch tracking, and handle single-pointer continuation.
- [x] 2.6 Add `setViewportOffset(offset)` and `updateProjection()` to `UniverseEngine` using Three.js `setViewOffset` to support shifting the optical center of the camera.

## 3. React Canvas Integration

- [x] 3.1 Update `KnowledgeUniverseProps` interface in `src/components/graph/universe/types.ts` to include optional `selectedNodeId?: string | null`.
- [x] 3.2 Add `touch-action: none` (via CSS style or class) on the `<canvas>` element in `src/components/graph/KnowledgeUniverse.tsx` to prevent default touchscreen gestures.
- [x] 3.3 Synchronize `selectedNodeId` inside `KnowledgeUniverse.tsx` with `props.selectedNodeId` using a `useEffect`.
- [x] 3.4 In `KnowledgeUniverse.tsx`, add a `useEffect` that updates the WebGL engine's viewport offset based on whether a node is selected (e.g. 180px offset in desktop/tablet mode, 0 in phone/portrait mode).
- [x] 3.5 Update `KnowledgeGraphPage.tsx` to pass the page-level `selectedNode` state as `selectedNodeId` prop to `KnowledgeUniverseLazy`.

## 4. Mobile Navigation

- [x] 4.1 Update `allNavItems` in `src/components/mobile/MobileNavigation.tsx` to include the `"knowledge-sphere"` tab entry (title, icon, type, content, closable).
