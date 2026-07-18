# Knowledge Universe — Tasks

## 1. Scaffolding & layout engine

- [x] 1.1 Create `src/components/graph/universe/` module: `types.ts` (focus state machine, engine options mirroring `ObsidianSphereProps`) and `layout.ts` — deterministic galaxy layout (seeded id hashes: golden-angle category clusters, Fibonacci-disc document scatter, orbit rings for extracts, moon orbits for flashcards) with unit tests asserting position stability across runs
- [x] 1.2 Create `UniverseEngine` class (`engine.ts`): three.js renderer/scene/camera setup, DPR cap at 2, WebGL2→WebGL1 probe that throws a typed error when unavailable, and full `dispose()` (renderer, geometries, materials, textures, `forceContextLoss`)
- [x] 1.3 Implement the render-on-demand loop: single `invalidate()` entry, animation-source registry (tweens, drag inertia, ambient drift), 30 fps-capped ambient drift with 30 s auto-pause, `visibilitychange` hard stop, `prefers-reduced-motion` gate

## 2. GPU scene

- [x] 2.1 Node Points cloud with custom ShaderMaterial: per-vertex position/color/size/class/state attributes; fragment-shader glow, soft edge, and twinkle; buffer-attribute state updates for hover/selected/dimmed (no per-node objects)
- [x] 2.2 Edges as a single `LineSegments` geometry with per-vertex alpha (depth fade + focus highlight)
- [x] 2.3 Backdrop: static seeded starfield Points + ≤ 8 nebula billboard sprites (radial-gradient canvas textures) tinting category clusters; theme-aware palettes (dark deep-space additive path, light "paper cosmos" normal-blend path) driven by `useTheme()` tokens
- [x] 2.4 System-view orbit rings via a shared instanced ring geometry, with ring pagination for documents with many extracts ("+N more" ring)

## 3. Navigation & interaction

- [x] 3.1 Camera system: minimal orbit/drag controls with inertia, wheel zoom, and a tween helper (600 ms cubic ease; instant cut under reduced motion) driven by the demand loop
- [x] 3.2 Focus state machine (universe → system → node): camera tweens + per-instance dim/brighten/expand passes; Esc, click-empty, and breadcrumb pop one level
- [x] 3.3 Event-driven picking: throttled pointermove/click/contextmenu raycasts against focus-visible instances with screen-calibrated threshold; wire hover state + cursor
- [x] 3.4 HTML overlay layer: projected anchors (updated only on rendered frames) for cluster labels, orbit labels, hovered/selected node label; breadcrumb trail component
- [x] 3.5 Wire the full `ObsidianSphereProps` callback contract: click/select detail panel (reusing the Sphere's panel content, edit form, save/delete flows), double-click open, context menu
- [x] 3.6 Search box with live label matching, match pulsing via state attribute, and warp tween (FOV kick + starfield streak in vertex shader) to the chosen result
- [x] 3.7 Keyboard travel: Arrow/Tab sibling cycling at the current focus level, Enter opens, Esc zooms out

## 4. Integration

- [x] 4.1 `KnowledgeUniverse.tsx` component: `React.lazy` chunk, engine lifecycle in effects, WebGL-failure and context-loss fallback rendering `ObsidianSphere` with identical props
- [x] 4.2 Swap `KnowledgeSphereTab` to render `KnowledgeUniverse` (data loading and callbacks untouched); update `KnowledgeGraphPage` toggle Graph | Universe and `src/components/graph/index.ts` exports
- [x] 4.3 Add all new strings ("Universe" naming, breadcrumbs, search placeholder, controls, info panel) to all six locales (en, es, zh, de, ja, fr); remove hardcoded English from new components

## 5. Verification

- [ ] 5.1 Performance proof: with the app idle in Universe view, verify zero rAF activity and baseline CPU (Instruments/Activity Monitor + a debug frame counter); verify hidden-window halt and resume; verify constant draw-call count at 100 vs 1000+ nodes (renderer.info)
- [ ] 5.2 Interaction pass on a real collection: fly-in/out, breadcrumbs, hover/select/edit/save/delete, double-click open flows (document, extract → extracts view, flashcard → review), context menu, search warp, keyboard travel, reduced-motion behavior, light + dark themes
- [x] 5.3 Fallback pass: force WebGL failure and confirm `ObsidianSphere` renders with working interactions; run typecheck, lint, and existing test suite
  - Browser without WebGL rendered the Sphere fallback; search/select, open-to-review, delete, and linked document→extract→flashcard data refreshes were exercised.
  - Lint and production build pass. Targeted Universe/linkage tests pass (18/18). The repository-wide suite passes 1,296/1,298 tests after rerunning the four loopback-WebSocket tests outside the sandbox; the two remaining failures and two typecheck errors are pre-existing outside this change.
