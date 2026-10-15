## Why

The Knowledge Universe home view targets the world origin, but its deterministic cluster layout is not guaranteed to be visually balanced around that point. On tablets and other viewport shapes this can leave the galaxy concentrated in a corner, as in the reported landscape-tablet view, instead of centered in the available canvas.

## What Changes

- Derive the universe home center and framing bounds from the actual rendered layout rather than assuming `{ x: 0, y: 0, z: 0 }` is its visual center.
- Use that measured center for initial load, reset/home navigation, and universe-level refocus on every viewport size and orientation.
- Recompute the responsive framing when the layout or viewport changes while preserving intentional user pan/focus state.
- Keep selected-node detail-panel framing centered in the unobscured canvas area without applying a stale offset after the panel closes or the presentation mode changes.
- Add deterministic layout/camera tests covering asymmetric datasets and portrait, landscape, tablet, and desktop aspect ratios.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `knowledge-universe-mobile`: strengthen viewport centering so the universe is visually centered at home on every screen size, with responsive centering in the usable area when overlays change.

## Impact

- `src/components/graph/universe/layout.ts` and `types.ts`: expose a deterministic visual center and centered bounds for the generated universe.
- `src/components/graph/universe/engine.ts` and `cameraFit.ts`: target and frame the measured layout center across load, reset, resize, and projection-offset changes.
- `src/components/graph/KnowledgeUniverse.tsx`: synchronize viewport-offset state with the actual visible detail panel and presentation mode.
- `src/components/graph/universe/__tests__/`: add regression coverage for asymmetric layouts and responsive camera centering.
- No backend, storage, schema, dependency, or public API changes.
