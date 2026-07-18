## 1. Camera Fit Math (pure helpers)

- [x] 1.1 Create `src/components/graph/universe/cameraFit.ts` with `fitDistance(radius, fovDeg, aspect)` (fit a sphere within both FOV axes) and `computeCameraRange(bounds, coreBounds, fovDeg, aspect)` returning `{ homeDist, maxDist }` with the landscape-preserving floors from design.md.
- [x] 1.2 Add `anchorShift(anchor, target, distOld, distNew)` (focal-point zoom target displacement) to `cameraFit.ts`.
- [x] 1.3 Add `src/components/graph/universe/__tests__/cameraFit.test.ts`: portrait aspect yields larger `maxDist` than landscape; landscape values match current `×2.2/×2.6` behavior within tolerance; whole-universe visibility at `maxDist` for aspects 0.45–2.0; clamping and anchor-shift invariants (anchor point stays fixed under projection).

## 2. Engine: Aspect-Aware Zoom Range

- [x] 2.1 In `engine.ts`, store `bounds`/`coreBounds` from `setData()` and replace the fixed `homeDist`/`maxDist` formulas with `computeCameraRange(...)` using `camera.fov` and `camera.aspect`.
- [x] 2.2 Recompute the range and re-clamp `orbit.dist` in `resize()` so orientation changes take effect immediately; keep `setFocus`/`resetView` using the recomputed `homeDist`.
- [x] 2.3 Verify the starfield radius (`bounds × 5 + 800`) still exceeds the new portrait `maxDist` and add a defensive `Math.min` guard if a degenerate aspect could violate it.

## 3. Engine: Universe Gestures

- [x] 3.1 Implement `zoomToward(clientX, clientY, factor, opts?)` in `engine.ts` using the view-plane anchor from `cameraFit.anchorShift`, with optional tweened animation; route pinch zoom through it using the gesture center so pinch is focal-point anchored.
- [x] 3.2 Add two-finger twist rotation: accumulate the inter-pointer angle delta per move frame (with a small engage dead-zone) and apply it to `orbit.theta` alongside pinch zoom and pan.
- [x] 3.3 Add two-finger-tap detection (≤250 ms, <12 px cumulative movement) that triggers a tweened zoom-out step (`zoomBy(1.9)`).
- [x] 3.4 Add pinch zoom momentum: track an EMA zoom factor during pinch, continue it with 0.92/frame decay in the `frame()` inertia branch after release, clamp at limits, and skip entirely under `reducedMotion`.
- [x] 3.5 Track `gestureHadMultiTouch` per pointer session and set `suppressClick = true` on the final pointer-up of any multi-touch gesture so the synthesized click is consumed by `consumeClickSuppression()`.

## 4. React: Tap Semantics and Double-Tap Zoom

- [x] 4.1 In `KnowledgeUniverse.tsx`, record the last canvas `pointerdown` pointer type; in `handleCanvasClick`, defer the empty-space action (clear selection / pop level) by ~275 ms for touch pointers only.
- [x] 4.2 Cancel the deferred action when a second empty-space tap arrives in the window and call `engine.zoomToward(x, y, 0.55, { animated: true })`; keep node taps immediate and mouse behavior unchanged.
- [x] 4.3 Ensure double-tap on a node still routes through `onDoubleClick` → `onNodeDoubleClick` (engine zooms only when the pick is null), and clean up the deferral timer on unmount.

## 5. Mobile Chrome Layout

- [x] 5.1 In `KnowledgeUniverse.tsx` under `useMobileShell()`: hide the title block, collapse search into an icon button that expands to a full-width input row, and keep the info toggle as an icon.
- [x] 5.2 Render the breadcrumb as its own horizontally-scrollable row below the top bar on mobile instead of the absolutely-centered pill.
- [x] 5.3 Offset the floating control column with `bottom: calc(1.5rem + env(safe-area-inset-bottom))` on mobile so zoom/reset controls clear gesture bars.

## 6. Verification

- [x] 6.1 Run `pnpm test` (new `cameraFit` suite plus existing `layout.test.ts` and component tests) and `pnpm typecheck`/lint per repo scripts.
- [x] 6.2 In the browser preview at a mobile viewport (375×812, portrait): confirm pinch/zoom buttons reach a distance where the whole universe is visible, reset frames the core, and chrome does not overlap; re-check after switching to landscape (812×375) that limits re-clamp.
- [x] 6.3 Verify gesture semantics in the preview: simulated multi-touch end does not pop the focus level, double-tap empty space zooms in toward the point, double-tap on a node still opens it, and desktop mouse behavior (wheel, drag, right-click pan, immediate empty-space click) is unchanged.
