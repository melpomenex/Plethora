## Context

`UniverseEngine` (src/components/graph/universe/engine.ts) owns an orbit camera: `orbit.dist` is clamped to `[minDist, maxDist]`, where `setData()` computes `homeDist = max(coreBounds × 2.2, 140)` and `maxDist = max(bounds × 2.6, homeDist × 1.6)`. The three.js `PerspectiveCamera` FOV (55°) is *vertical*; those ×2.2/×2.6 factors implicitly assume a landscape aspect where the horizontal FOV is wider. On a portrait phone (aspect ≈ 0.5) the horizontal FOV shrinks to ~28°, so at `maxDist` the visible half-width is ~0.7 × `bounds` — the pinch hits the clamp while the galaxy disc still overflows the screen. Neither value is recomputed on resize/orientation change.

Touch input (from `add-knowledge-universe-to-mobile`) supports pinch-zoom (distance-ratio to `orbit.dist`) and two-finger pan via `panCameraTarget`. Missing versus platform conventions: zoom is not anchored to the pinch focal point, there is no double-tap / two-finger-tap zoom, no twist rotation, and no zoom momentum. `suppressClick` is only set after a single-pointer drag, so the synthesized click after a multi-touch gesture can reach `handleCanvasClick` and pop a focus level or clear the selection. In `KnowledgeUniverse.tsx`, the top bar (title + 224px search input + info button) and the absolutely-centered breadcrumb overlap on narrow screens, and the bottom-right floating controls ignore safe-area insets.

## Goals / Non-Goals

**Goals:**
- The whole universe fits on screen at maximum zoom-out on any viewport aspect; limits re-derive on resize/orientation change.
- Pinch zoom anchors to the gesture center; double-tap and two-finger-tap provide stepped zoom; twist rotates the heading; pinch release carries momentum.
- A multi-touch gesture can never end as an accidental tap.
- Mobile chrome (top bar, breadcrumb, floating controls) is non-overlapping and safe-area aware.
- Camera-range and gesture math is extracted into pure, unit-testable helpers.

**Non-Goals:**
- No changes to desktop mouse behavior (wheel zoom, right/modifier-click pan) or keyboard navigation.
- No gesture library dependency (Hammer.js, use-gesture) — stays on native PointerEvents per the prior change's decision.
- No redesign of `NodeDetailPanel`, the `ObsidianSphere` fallback, or the universe layout algorithm.
- No haptics or platform-native gesture APIs.

## Decisions

### 1. Aspect-aware fit distance replaces fixed multipliers

Add a pure helper module `src/components/graph/universe/cameraFit.ts`:

- `fitDistance(radius, fovDeg, aspect)` = `radius / tan(min(halfV, halfH))` where `halfV = fovDeg/2` in radians and `halfH = atan(tan(halfV) × aspect)` — the distance at which a sphere of `radius` fits both FOV axes.
- `computeCameraRange(bounds, coreBounds, fovDeg, aspect)` returns `{ homeDist, maxDist }`:
  - `maxDist = max(fitDistance(bounds) × 1.25, bounds × 2.6)` — the `bounds × 2.6` floor preserves today's landscape/desktop range exactly; the fit term only kicks in when the aspect is narrow.
  - `homeDist = clamp(fitDistance(coreBounds) × 1.1, 140, maxDist)` — on landscape this evaluates to ≈ `coreBounds × 2.1`, matching current behavior; on portrait it backs off so the core fits.

The engine stores `bounds`/`coreBounds` from the last `setData()` and calls `computeCameraRange` from both `setData()` and `resize()` (aspect changes on rotation and split-screen), then re-clamps `orbit.dist`. `minDist` is unchanged. Sanity check: the starfield sphere scales at `bounds × 5 + 800`, which stays outside the new portrait `maxDist` (≈ `bounds × 4.8` worst case at aspect 0.5), so the camera never exits the star shell.

*Alternative considered:* just raise `maxDist` to a large constant. Rejected — arbitrary, lets landscape users zoom into empty black, and still frames the home view wrong on portrait.

### 2. Focal-point zoom via target shift on the view plane

`zoomToward(clientX, clientY, factor)`: intersect the pointer ray with the plane through `orbit.target` perpendicular to the camera's view direction to get an `anchor` point, scale `orbit.dist` by `factor` (clamped), then shift `orbit.target += (anchor − target) × (1 − dist_new/dist_old)`. The world point under the fingers stays visually fixed. Pinch uses the gesture center each move; double-tap uses the tap point with a tween. The math lives in `cameraFit.ts` (`anchorShift`) so it is unit-testable without a renderer.

*Alternative considered:* raycasting into the node cloud for anchor depth. Rejected — expensive per move-event, and unstable when no nodes sit under the gesture (common in space).

### 3. Gesture recognition stays inline in the engine's pointer map

Extend the existing `activePointers` handling — no state-machine framework:

- **Twist**: per move-frame, the angle of the vector between the two pointers; `orbit.theta += Δangle` (applied together with pinch-zoom and pan from the same frame delta, the way map apps compose all three).
- **Two-finger tap**: both pointers down ≤ 250 ms with cumulative movement < 12 px → tweened `zoomBy(1.9)`.
- **Zoom momentum**: keep an EMA of the per-frame zoom factor during pinch; on release, if it deviates from 1 beyond a small epsilon, continue applying it in the existing inertia branch of `frame()` with 0.92 decay (skipped when `reducedMotion`, same as rotate inertia).
- **Gesture/tap isolation**: track `gestureHadMultiTouch` per pointer-session; on final pointer-up set `suppressClick = true` whenever it is set, so the synthesized click is consumed by the existing `consumeClickSuppression()` path.

*Alternative considered:* Hammer.js / @use-gesture. Rejected — prior change deliberately avoided a dependency; the engine owns the rAF lifecycle and needs frame-level integration anyway.

### 4. Double-tap zoom and deferred empty-space taps are touch-only, wired in React

`KnowledgeUniverse.tsx` records the `pointerType` of the last `pointerdown` on the canvas. In `handleCanvasClick`:

- **Touch + empty space** (pick returns null): defer the current action (clear selection / pop level) by ~275 ms. A second tap inside the window cancels the timer and calls `engine.zoomToward(x, y, 0.55, { animated: true })`. This is the standard map-app disambiguation; node taps stay immediate because tapping a node is idempotent with double-tap-open.
- **Mouse**: behavior unchanged — immediate empty-space pop, no double-click zoom (a desktop double-click would otherwise pop a level *and* zoom, which feels broken; desktop already has the wheel).
- Double-tap **on a node** keeps flowing through the existing React `onDoubleClick` → `onNodeDoubleClick` (open), so the engine only zooms when the pick is null.

### 5. Mobile chrome: collapse, restack, and inset

When `useMobileShell()` is true:

- Search collapses to an icon button matching the info button; tapping expands a full-width input row; the title block is hidden (the tab chrome already names the view).
- The breadcrumb renders as a second row under the top bar (not absolutely centered), horizontally scrollable with truncated crumbs.
- The floating control column uses `bottom: calc(1.5rem + env(safe-area-inset-bottom))` so it clears gesture bars; it already sits inside the shell's padded root for the nav bar.

Desktop rendering is untouched (same JSX branch as today).

### 6. Testing strategy: pure math modules, not engine simulation

`UniverseEngine` needs a real WebGL context, so jsdom-driven PointerEvent simulation would mock away everything of value. Instead the testable surface is extracted: `cameraFit.ts` (fit distances, range computation, anchor shift, clamping) and a small `gestureMath.ts` (pinch factor, twist delta, two-finger-tap classification from pointer samples) get vitest suites alongside the existing `layout.test.ts`. Engine wiring is verified manually in the browser preview at portrait/landscape viewports.

## Risks / Trade-offs

- **[Deferred empty-space tap adds ~275 ms latency to touch back-navigation]** → Applies only to empty-space taps on touch pointers; node selection stays instant. 275 ms matches platform double-tap windows.
- **[Simultaneous pinch+pan+twist can feel jittery on cheap digitizers]** → All three deltas derive from the same two-pointer frame sample (no competing recognizers); twist applies a small angular dead-zone before engaging.
- **[Nodes become sub-pixel at the larger portrait maxDist]** → Distance attenuation already floors point sizes in the shader; the ×1.25 fit margin bounds how far past "everything visible" you can pull.
- **[Orientation change mid-gesture]** → `resize()` re-clamps `orbit.dist`; pinch tracking already resets on `pointercancel`/pointer-count change.
- **[Two-finger tap misread as short pinch]** → Movement threshold (12 px cumulative) and 250 ms ceiling; a misread produces a small stepped zoom-out, which is benign and reversible.

## Migration Plan

No persisted state, schema, or API changes. Ships as a normal frontend change; rollback is a revert of the commit.

## Open Questions

None blocking — gesture thresholds (275 ms tap window, 12 px movement, 1.9×/0.55× step factors) are implementation defaults to tune during verification on a real device.
