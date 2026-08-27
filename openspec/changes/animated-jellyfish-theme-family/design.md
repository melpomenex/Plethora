## Context

`ThemeBackdrop.tsx` hosts ~40 Canvas 2D `_ANIM` renderers at 30fps with visibility/focus/battery gates. `biolume-abyss` and `abyssal-depths` use `bioglow` (rising spores) — not jellyfish anatomy. Prior OpenSpec `restore-animated-themes` avoided new renderers; this change adds one shared renderer justified by a distinct visual product (organic bell/tentacle jellyfish family).

## Goals / Non-Goals

**Goals:**
- One shared jellyfish renderer parameterized by four palettes.
- One prominent centered jellyfish that remains visually legible through scenic glass surfaces.
- Slow organic motion (4–7s pulse, 15–30s drift).
- Static intentional frame for reduced motion / animations off.
- Tiered glass surfaces preserving reader legibility.
- Pass existing `modeAccent` and `readerThemeTokens` catalog tests.

**Non-Goals:**
- WebGL/Three.js, new npm dependencies, generalized graphics engine.
- Redesigning Settings navigation.
- Per-theme renderer duplication.
- Pointer parallax (deferred; optional future).

## Decisions

### 1. Canvas 2D shared renderer (not WebGL/SVG)

**Decision:** New module `jellyfishRenderer.ts` registered as `_ANIM['jellyfish']`.

**Rationale:** Matches all existing backdrops; proven on Tauri WebViews; `bioglow`/`lavalamp`/`underwater` precedents.

**Alternatives rejected:** WebGL (battery/overhead), animated SVG (WebKit filter cost), CSS blur blobs (mobile heating).

### 2. Palette via `ambientPaletteId` on `ThemeEffects`

```ts
effects: {
  backgroundAnimation: 'jellyfish',
  ambientPaletteId: 'deep-ocean-glow',
}
```

Renderer looks up `JELLYFISH_PALETTES[id]` for colors. Single animation key, four palette entries.

### 3. Static vs animated modes

| Condition | Behavior |
|-----------|----------|
| `animationsEnabled` false OR `prefers-reduced-motion` | Draw one static frame; no RAF |
| Foreground + motion allowed | RAF loop at 30fps cap |
| Hidden/unfocused | Effect cleanup; no RAF |
| E-ink | CSS hides `.theme-backdrop` (unchanged) |

Fix effect deps to include `animationsEnabled` and `prefersReducedMotion` (known leak when toggling).

### 4. Composition

- Normalized jellyfish position (nx, ny) with resize remap.
- Desktop: horizontally centered hero (nx = 0.5, ny ~0.28) with the bell spanning roughly one quarter of the short viewport edge and long arms centering the full silhouette vertically.
- Phone (`cv.width < 600`): horizontally centered with a smaller scale and ny ~0.24.
- Animated drift stays close to the centerline while the bell pulse and flowing arms make the swimming motion perceptible.
- One primary jellyfish; particle count scales with `density` (base ~12).

### 5. Glass customCSS factory

`createJellyfishScenicCSS(themeId, accentHex)` — copies biolume-abyss tiered transparency pattern; forces solid `bg-popover`.

### 6. Deterministic test mode

`window.__plethoraJellyfishFreeze = { time: number, seed: number }` for visual tests and unit snapshot of draw path.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| ThemeBackdrop monolith growth | Renderer in separate file; ~200 lines |
| Mobile heating | Inherit gates; default mobile animations off |
| Contrast on translucent surfaces | Opaque reading overrides in customCSS; catalog tests |
| RAF leak on toggle | Effect dependency fix |

## Migration Plan

No migration. New theme IDs; invalid stored ids fall back to default via existing `ThemeContext` logic.

## Open Questions

- Ambient intensity by route (reader attenuation) — defer; use opaque reader surfaces in customCSS for v1.
