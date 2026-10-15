## 1. Centered Layout Envelope

- [x] 1.1 Extend `UniverseLayout` with a deterministic visual center and add a pure helper that measures axis extents and radial bounds without weighting the result by node count.
- [x] 1.2 Update `computeUniverseLayout()` to calculate core and full envelopes from visible placements plus cluster radii, with stable empty-layout fallbacks.
- [x] 1.3 Add asymmetric-layout unit tests that verify the reported center is the envelope midpoint and every included placement fits within the centered bounds.

## 2. Canonical Home Camera Target

- [x] 2.1 Store the layout center as `UniverseEngine.homeTarget` and use it for initial universe framing, reset/home, and transitions back from system or node focus.
- [x] 2.2 Update data-refresh handling so an engine at universe home follows a changed layout center while focused or deliberately panned camera targets are preserved.
- [x] 2.3 Keep resize/orientation handling limited to projection, centered camera ranges, and distance clamping so it does not discard the active navigation target.
- [x] 2.4 Add camera/layout regression tests for portrait phone, landscape tablet, compact desktop, and wide desktop aspect ratios.

## 3. Usable-Viewport Projection

- [x] 3.1 Derive the selected-node projection offset from the visible detail panel's occupied width and apply it only when the panel consumes canvas space.
- [x] 3.2 Clear and recompute the projection offset when the panel closes, becomes an overlay, or the viewport/presentation mode changes.
- [x] 3.3 Add coverage that verifies zero offset for the full canvas and correct target placement in the remaining unobscured area when the right detail panel is open.

## 4. Verification

- [x] 4.1 Run the Knowledge Universe layout/camera unit suites and the frontend typecheck, fixing any regressions.
- [x] 4.2 Manually verify initial load, reset, rotation/resize, deliberate pan preservation, and detail-panel open/close at portrait phone, portrait tablet, landscape tablet, and desktop viewport sizes.
