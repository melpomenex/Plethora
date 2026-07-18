# Knowledge Universe

## Why

The current Knowledge Sphere renders every node as an undifferentiated dot pinned to the surface of a single globe — visually flat, structurally meaningless (position encodes nothing), and it gives users no way to *travel* through their collection. The app already ships three.js as a dependency without using it, so we can deliver a dramatically more striking, GPU-accelerated "Knowledge Universe" — where structure (document → extract → flashcard, categories, tags) becomes spatial meaning users can fly through — while *lowering* per-frame cost versus today's CPU-bound Canvas 2D loop (which re-sorts and re-projects every node on the main thread each frame).

## What Changes

- Replace the "Sphere" view with a new **Knowledge Universe**: a WebGL (three.js) galaxy where each document is a star, its extracts orbit as planets, flashcards as moons, and documents cluster into category "constellations" wrapped in subtle nebula fields.
- **Semantic zoom navigation**: Universe (all clusters + stars) → Star System (one document centered, its extracts/cards orbiting) → Node focus (detail panel). Click a star to fly in with an eased camera animation; Esc / click-empty / breadcrumb to fly back out. Full click-through of every document and node.
- **Interaction parity with the Sphere**: hover highlight + labels, click to select with detail panel, double-click to open document/extract/review, right-click context menu, inline edit/save and delete — the Universe accepts the same callback props so `KnowledgeSphereTab` wiring is preserved.
- **Search & keyboard travel**: type-to-find with matching stars pulsing and a "warp" fly-to on select; arrow/Tab sibling cycling, Enter to open, Esc to zoom out.
- **Strict resource budget** (better than today): render-on-demand frame loop that draws *zero* frames when idle, instanced rendering (a few draw calls total, no per-node JS in the hot path), capped device-pixel-ratio, full pause when the tab is hidden or unmounted, GPU resource disposal on unmount, `prefers-reduced-motion` support, and an optional ambient-drift mode that auto-pauses.
- **Graceful fallback**: if a WebGL context cannot be created, the existing Canvas 2D `ObsidianSphere` renders instead (component is retained).
- UI renames ("Sphere" → "Universe") with i18n strings added across all six locales.

## Capabilities

### New Capabilities

- `knowledge-universe`: The Knowledge Universe visualization — galaxy layout semantics (star/planet/moon/constellation mapping), semantic-zoom navigation and click-through, node interactions (select, open, edit, delete, context menu), search/warp, and the hard performance/battery budget the renderer must satisfy.

### Modified Capabilities

<!-- None — no existing spec in openspec/specs/ covers the Sphere/graph views; this is net-new spec territory. -->

## Impact

- **Affected code**:
  - New: `src/components/graph/KnowledgeUniverse.tsx` (+ supporting modules under `src/components/graph/universe/` for layout, renderer, and camera logic).
  - Modified: `src/components/tabs/knowledge/KnowledgeSphereTab.tsx` (render Universe, keep existing data loading + callbacks), `src/pages/KnowledgeGraphPage.tsx` (Graph | Universe toggle), `src/lib/i18n/locales/*.ts` (new strings), `src/components/graph/index.ts`.
  - Retained: `src/components/graph/ObsidianSphere.tsx` as the no-WebGL fallback.
- **Dependencies**: none added — `three` / `@types/three` ^0.182 are already declared (currently unused). Bundle grows by three.js actually being imported; mitigated via lazy `import()` of the Universe chunk.
- **Systems**: no backend/Tauri command changes; consumes the same `get_documents` / `get_extracts` / `get_all_learning_items` data already used by the Sphere.
- **Performance**: idle CPU/GPU ≈ 0 (no frame loop when nothing animates); interaction frames move projection/culling work off the main JS thread onto the GPU via instancing — strictly better than the current per-frame JS re-projection of every node.
