## Why

The Knowledge Universe reached mobile in `add-knowledge-universe-to-mobile` (basic pinch-zoom and two-finger pan), but on a phone it still does not navigate like a universe should. The dominant complaint: **you cannot zoom all the way out**. The camera's zoom-out limit (`maxDist = bounds × 2.6`) and home framing (`homeDist = coreBounds × 2.2`) are calibrated against the camera's *vertical* field of view (55°), which only works in landscape. In portrait the horizontal FOV is ~28°, so the distance clamp stops the pinch while most of the galaxy disc is still off-screen — the universe never fits the view. Beyond that, the gesture vocabulary is incomplete compared to what people expect from navigating a map/universe on a phone: pinch zoom does not anchor to the fingers, there is no double-tap or two-finger-tap zoom, no twist-to-rotate, and lifting fingers after a pinch can misfire as a tap that pops the focus level or clears the selection.

## What Changes

- **Aspect-aware camera range**: compute zoom limits and home/reset framing from both FOV axes (vertical FOV × viewport aspect), so the entire universe fits on screen at max zoom-out on any device orientation. Recompute and re-clamp on resize/orientation change.
- **Focal-point pinch zoom**: pinch zoom anchors the world point under the gesture center (the spot between your fingers stays put), instead of zooming toward the orbit target only.
- **Tap zoom gestures**: double-tap empty space → animated zoom-in toward the tapped point; two-finger tap → animated zoom-out one step. Double-tap on a node keeps its current behavior (open node).
- **Two-finger twist rotation**: rotating two fingers orbits the camera heading (theta), alongside pinch-zoom and two-finger pan in the same gesture.
- **Zoom momentum**: releasing a pinch with velocity continues the zoom with decaying momentum (mirrors the existing rotate inertia; disabled under reduced motion).
- **Gesture/tap isolation**: ending any multi-touch gesture never registers as a tap (no accidental level pop / selection clear); on touch, the empty-space single-tap action is briefly deferred so it can be cancelled by a double-tap.
- **Mobile chrome cleanup**: on the mobile shell, the top bar (title, search, info) and breadcrumb no longer overlap on narrow screens (search collapses to an expandable icon), and the floating zoom/reset controls respect safe-area insets so they stay reachable.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `knowledge-universe-mobile`: adds requirements for full zoom-out range on any aspect ratio, aspect-aware home framing, focal-point pinch zoom, tap zoom gestures, twist rotation, zoom momentum, gesture/tap isolation, and non-overlapping touch-reachable chrome. Existing requirements from `add-knowledge-universe-to-mobile` are unchanged.

## Impact

- `src/components/graph/universe/engine.ts`: fit-distance math for `homeDist`/`maxDist` (recomputed in `resize()`), focal anchoring in pinch and tap zooms, twist rotation, zoom inertia, two-finger-tap detection, gesture-end click suppression.
- `src/components/graph/KnowledgeUniverse.tsx`: empty-space double-tap zoom wiring, deferred empty-space tap on touch pointers, compact mobile top bar/breadcrumb, safe-area-aware floating controls.
- `src/components/graph/universe/__tests__/`: new unit tests for fit-distance/clamping math and gesture state transitions (vitest).
- No changes to desktop mouse behavior (wheel, right-click pan), `ObsidianSphere` fallback, `NodeDetailPanel`, or Rust backend.
