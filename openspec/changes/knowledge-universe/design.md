# Knowledge Universe — Design

## Context

The Sphere view ([src/components/graph/ObsidianSphere.tsx](../../../src/components/graph/ObsidianSphere.tsx)) is a Canvas 2D renderer: every animated frame it re-projects, re-sorts, and re-draws every node and edge in JavaScript on the main thread. It already has good battery hygiene (on-demand rAF loop, stops when idle or `document.hidden`) — that behavior is the floor for this change, not the ceiling. Node positions are a Fibonacci sphere: pure decoration, encoding nothing about the collection's structure.

Data comes from `KnowledgeSphereTab`, which builds `GraphNode[]` / `GraphEdge[]` (documents → extracts → flashcards) from `get_documents`, `get_extracts`, `get_all_learning_items`. `KnowledgeGraphPage` hosts a Graph | Sphere toggle with filters. `three` ^0.182 is declared in package.json but never imported anywhere.

Constraints: Tauri v2 WebViews (WKWebView on macOS — real but not desktop-class GPU throughput), React 19, no new dependencies, must not regress idle CPU/battery, existing i18n across six locales.

## Goals / Non-Goals

**Goals:**
- A visually stunning galaxy in which *position means something*: category constellations → document stars → orbiting extract planets → flashcard moons.
- Fluid click-through navigation: fly into any star system, inspect and open any node, fly back out.
- Idle cost of exactly zero rendered frames; interaction cost below the current Canvas 2D implementation (GPU instancing instead of per-node JS).
- Prop-compatible drop-in for `ObsidianSphere` so tab wiring (open/edit/delete/context-menu callbacks) is unchanged.

**Non-Goals:**
- No physics/force simulation (continuous CPU burn, unstable layouts).
- No post-processing pipeline (bloom/EffectComposer render targets) — glow is faked cheaply in sprites/shaders.
- No changes to Rust commands, data model, or the 2D Graph view and its filters.
- No semantic-similarity layout (embeddings) in this change — layout is structural only.
- Not deleting `ObsidianSphere` (it becomes the no-WebGL fallback).

## Decisions

### D1: Plain three.js, no react-three-fiber
R3F/drei are not installed and "no new dependencies" is a hard constraint. Plain three inside one React component also gives *explicit* ownership of the frame loop, which is the whole performance story here. The scene is managed imperatively in a `UniverseEngine` class (created in a `useEffect`, disposed on unmount); React owns only UI chrome (panels, breadcrumbs, labels).

### D2: Render-on-demand ("invalidate") frame loop
There is no free-running loop. A single `invalidate()` entry point schedules a rAF only if one isn't pending; a frame renders and, if any *animation source* is still active (camera tween, focus transition, warp effect, ambient drift), schedules the next. Otherwise the loop dies and the last frame persists on screen.

Animation sources: pointer drag/inertia, camera tweens, hover fade-ins, selection pulses, ambient drift. Ambient drift (a barely-perceptible parallax rotation + node twinkle) runs at a capped 30 fps, auto-pauses after 30 s without interaction, and is disabled entirely by `prefers-reduced-motion`. `visibilitychange` hard-stops everything; regaining visibility just calls `invalidate()` once. This is a strict superset of the battery behavior the Sphere already has.

*Alternative considered*: continuous 60 fps loop with dynamic resolution — rejected; any always-on loop loses to "zero frames" on battery.

### D3: Instanced GPU rendering — bounded draw calls at any collection size
- **Nodes**: one `THREE.Points` cloud with a custom `ShaderMaterial`. Per-vertex attributes: position, color, base size, node-class id, and a `state` float (normal/hover/selected/dimmed). Glow, soft edge, and twinkle are computed in the fragment shader from a radial falloff — no textures per node, no bloom pass. Hover/selection/dimming updates write a few floats into one buffer attribute (`needsUpdate` on a sub-range), not per-node objects.
- **Edges**: one `LineSegments` geometry with per-vertex alpha (depth fade, focus highlight).
- **Backdrop**: one static seeded starfield `Points` (never updates) plus ≤ 8 nebula billboard sprites (radial-gradient canvas textures, additive blending) tinting each category cluster.
- **Orbit rings** (system view): one shared ring geometry drawn with a thin shader line, instanced per visible orbit.

Total: ~5 draw calls regardless of node count. The GPU does projection/culling; per-frame JS is camera math only.

### D4: Deterministic structural layout (computed once per data change)
No simulation. All positions derive from stable id hashes, so the universe looks identical across sessions:
- Category clusters sit on a golden-angle spiral disc (galaxy silhouette), cluster radius ∝ √(document count).
- Documents scatter inside their cluster via a seeded Fibonacci disc with mild vertical jitter (disc, not sphere — reads as a galaxy, and keeps labels legible).
- Extracts sit on orbit rings around their parent star (ring index = extract index); flashcards on tight orbits around their extract. In universe view these collapse into the star (LOD); they expand when the system gains focus.
Layout runs in a `useMemo` over nodes/edges (< a few ms for thousands of nodes) and writes straight into the instanced buffers.

### D5: Semantic zoom as a focus state machine
`focus: { level: "universe" } | { level: "system", docId } | { level: "node", nodeId }`. Transitions drive (a) a camera tween (600 ms cubic ease; instant under reduced motion) and (b) a per-instance `state`-attribute pass (focused system brightens and expands its orbits; everything else dims toward backdrop). Esc / click-empty / breadcrumb pops one level. Double-click and context-menu semantics are identical to the Sphere and reuse the exact `ObsidianSphereProps` callback signatures.

### D6: Picking = event-driven raycast, never per-frame
Raycasting runs only on discrete pointer events (throttled `pointermove`, `click`, `contextmenu`) using three's `Raycaster` against the Points cloud with a screen-calibrated threshold, testing only instances visible at the current focus level. Hover work when the pointer is idle: zero.

*Alternative considered*: GPU id-buffer picking — an extra render target per pick; overkill at this scale.

### D7: Labels and panels are HTML, not WebGL text
3D text atlases are expensive and fight the app's typography. Instead, a `position: absolute` overlay projects a *bounded* set of anchors to screen space (only on rendered frames): cluster names at universe level, orbit labels in system view, hovered/selected node label. Detail panel, breadcrumb, search, and controls are ordinary React components styled like the existing Sphere panels (`bg-card/95 backdrop-blur`, same edit/delete/save flows).

### D8: Search & warp
The search box filters node labels in JS (data is already client-side). Matches pulse via the `state` attribute; choosing a result triggers a camera "warp" tween (slight FOV kick, streak-stretched starfield in the vertex shader during the tween — costs nothing extra, it's the same frame loop). Reduced motion ⇒ instant cut.

### D9: Lazy chunk + WebGL fallback
`KnowledgeUniverse` is loaded via `React.lazy(() => import(...))` so three.js lives in an async chunk and startup cost is unchanged. Before mounting the engine we probe `canvas.getContext("webgl2") ?? getContext("webgl")`; on failure (or context-loss without recovery) we render `ObsidianSphere` with the same props. Unmount disposes renderer, geometries, materials, and textures (`renderer.dispose()`, `forceContextLoss()`).

### D10: Theme-aware palette
Node colors keep the established type palette (doc `#3b82f6`, extract `#22c55e`, card `#a855f7`, category `#f59e0b`, tag `#06b6d4`). Dark theme: deep-space background (`#050810` family) with additive glow. Light theme: "paper cosmos" — the theme's light background, nodes as saturated ink-and-glow marks with normal blending and soft dark edges (additive blending washes out on white). Both derive the backdrop from `useTheme()` tokens like the Sphere does.

## Risks / Trade-offs

- [three.js chunk (~150 KB gzip) enters the bundle] → Lazy `import()`; loaded only when the Universe tab is opened; startup unaffected.
- [WKWebView GPU throughput varies across machines] → DPR capped at 2 (dropped to 1 during drag if a frame exceeds ~20 ms twice in a row); draw-call count is constant; degrade path is fewer nebula sprites, never a lower frame budget.
- [Raycast on very large collections could stutter on pointermove] → Throttle to ~30 Hz, test only focus-visible instances, spatial early-out via bounding spheres per cluster.
- [Additive-glow aesthetic collapses in light theme] → Explicit light-theme material path (D10) rather than one shared look.
- [Orbit expansion could overwhelm systems with hundreds of extracts] → Ring pagination: show nearest N orbits with a "+42 more" ring; full list remains available in the detail panel.
- [Regression risk to existing flows (open/edit/delete)] → Same props contract as `ObsidianSphere`; `KnowledgeSphereTab` callbacks untouched; fallback keeps old renderer alive.

## Migration Plan

1. Land `KnowledgeUniverse` behind the existing view toggle (renamed Sphere → Universe); `ObsidianSphere` stays in-tree as fallback.
2. `KnowledgeSphereTab` swaps the rendered component only; data loading and callbacks unchanged.
3. Rollback = point the toggle/tab back at `ObsidianSphere` (one-line revert); no data or backend migration exists.

## Open Questions

- None blocking. (Ambient drift defaults ON with 30 s auto-pause; revisit default only if battery telemetry/user feedback says otherwise.)
