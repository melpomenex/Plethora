## Context

`computeUniverseLayout()` places category clusters on a deterministic golden-angle spiral and returns scalar `bounds`/`coreBounds` measured from the world origin. The distribution is stable but not symmetric: with a small or uneven set of clusters, the midpoint of the visible placements can be far from `{0, 0, 0}`. `UniverseEngine` nevertheless hard-codes that origin as the orbit target when data loads, when the focus returns to the universe, and when reset is activated. `computeCameraRange()` can therefore choose a correct distance for the nominal radius while the actual galaxy remains visually concentrated toward an edge or corner.

The canvas already resizes through `ResizeObserver`, and aspect-aware fit distances are in place. The missing input is a deterministic layout center and bounds measured around it. Selected-node details add a second centering rule: the focused target belongs in the center of the unobscured portion of the canvas, not necessarily the physical canvas center.

## Goals / Non-Goals

**Goals:**
- Center the visible Knowledge Universe at initial/home view for asymmetric as well as symmetric datasets.
- Keep that centering correct on phones, tablets, desktops, split views, and orientation changes.
- Center selected/focused content in the unobscured viewport when the detail panel is visible.
- Preserve deliberate pan and node/system focus when a resize occurs.
- Keep layout and camera calculations deterministic and unit-testable without WebGL.

**Non-Goals:**
- Redesign the galaxy distribution, controls, detail panel, or fallback `ObsidianSphere`.
- Disable panning or automatically pull a user-modified camera back to home.
- Change touch/mouse gesture semantics, node selection behavior, or backend data.
- Add a new rendering or geometry dependency.

## Decisions

### 1. Store a measured visual envelope on `UniverseLayout`

Add a pure envelope calculation that walks the final, non-paged visible placements and relevant cluster extents. It returns a 3D axis-aligned midpoint (`center`) and the maximum radial extent (`bounds`) measured from that midpoint. `coreBounds` is likewise measured around the same center before outer halo/belt content is included. Empty layouts fall back to center `{0, 0, 0}` and the current minimum radius.

The midpoint of min/max extents is preferable to the arithmetic mean: a dense flashcard system must not pull the camera target away from the geometric midpoint merely because it contains more nodes. Measuring the radius from the resulting center preserves the existing spherical fit-distance API and guarantees every measured extent fits.

Alternative considered: translate every placement so the envelope center becomes the origin. Rejected because it mutates otherwise stable world coordinates and makes the layout change broader than the camera-framing defect requires.

Alternative considered: use the centroid of all placements. Rejected because the result is weighted by node count; a document with many flashcards would bias the visual center.

### 2. Use the layout center as the canonical universe-level camera target

`UniverseEngine` stores the latest layout center as `homeTarget`. Data load at universe focus, reset/home, and transitions back from system/node focus target `homeTarget` rather than a new zero vector. Camera-range calculation continues to use `coreBounds` and `bounds`, now measured around that target.

Data changes while already at universe home update the target and distance to the new envelope. Data changes while the user is focused into a system/node retain the focused target. A resize recomputes projection and distance limits, but it does not rewrite `orbit.target`; this preserves deliberate pan and focus. Consequently a universe already at home remains centered because its target is already `homeTarget`, while user navigation is not unexpectedly discarded.

Alternative considered: call reset on every `ResizeObserver` notification. Rejected because browser chrome, keyboard appearance, split-view resizing, and rotation would erase intentional navigation.

### 3. Treat physical and usable viewport centers as separate projection states

With no obscuring detail panel, `setViewportOffset(0)` clears Three.js view offsets so `homeTarget` projects to the exact canvas center. When the right-side detail panel is rendered in a non-overlay presentation, React supplies half of its actual occupied width as the projection offset, placing the camera target at the midpoint of the remaining canvas. When the panel closes or the presentation switches to an overlay/mobile treatment, the offset is synchronously cleared.

The offset is derived from the rendered panel/container geometry (or a shared panel-width constant), not an unrelated viewport breakpoint. Reapplying it after `resize()` keeps the projection centered as dimensions change.

Alternative considered: shift `orbit.target` to compensate for the panel. Rejected because that changes the rotation/pan pivot and confuses the meaning of home.

### 4. Verify the math with pure tests and the integration with viewport checks

Layout tests use intentionally asymmetric categories and node counts to assert that the returned center is the geometric envelope midpoint and that all placements lie within the returned centered bounds. Camera-fit tests cover common phone, tablet, and desktop aspects and assert that the measured bounds fit around the same home target. Component/engine coverage verifies projection offset is zero without a panel and is cleared after panel/presentation changes. Manual verification uses portrait and landscape tablet sizes and exercises initial load, reset, rotation, and panel open/close.

## Risks / Trade-offs

- **[Cluster nebula and label extents differ from node coordinates]** → Include cluster radii in the core envelope and retain a fit margin so decorative geometry does not appear clipped.
- **[A few very distant halo nodes can make the home view feel too small]** → Keep the existing distinction between `coreBounds` for home and full `bounds` for maximum zoom-out; only their shared center changes.
- **[Layout updates could move the home center while the user is navigating]** → Retarget only when the engine is at universe home; preserve focused and intentionally panned targets.
- **[A stale panel width can shift the target after responsive mode changes]** → Drive the offset from visible panel state and current geometry, and clear it whenever the panel is absent or overlays the canvas.
