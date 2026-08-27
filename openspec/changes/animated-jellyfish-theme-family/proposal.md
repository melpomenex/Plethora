## Why

Plethora already ships ~44 animated themes via `ThemeBackdrop` canvas renderers, but there is no cohesive underwater jellyfish family with organic bell/tentacle motion, shared palette-driven renderer, or intentional static reduced-motion fallbacks. Users want atmospheric deep-ocean themes suitable for long reading sessions without generic neon cyberpunk aesthetics.

## What Changes

- Add four selectable dark animated themes sharing one `jellyfish` canvas renderer: **Deep Ocean Glow**, **Bioluminescent Flow**, **Deep Sea Neon**, **Abyssal Dream**.
- Introduce `src/themes/jellyfishPalettes.ts` for palette configs and `src/components/common/ambient/jellyfishRenderer.ts` for shared procedural rendering (gradient ocean, caustics, bell, tentacles, sparse particles).
- Extend `ThemeEffects` with optional `ambientPaletteId` to select palette variant while using `backgroundAnimation: 'jellyfish'`.
- Add tiered glass `customCSS` per theme (nav translucent, reading surfaces opaque, popovers solid).
- Fix `ThemeBackdrop` lifecycle: include `animationsEnabled` and `prefersReducedMotion` in effect dependencies; render **static** underwater frame when motion is reduced or animations disabled (instead of empty background).
- Add unit tests for palette registration, renderer lifecycle, and theme catalog gates; optional visual harness freeze hook for screenshots.

## Capabilities

### New Capabilities
- `jellyfish-ambient-themes`: Four palette-driven jellyfish themes, shared renderer, static fallback, responsive composition.

### Modified Capabilities
- `animated-themes-restoration`: Jellyfish renderer inherits existing gates (30fps, visibility/focus pause, battery density halving, e-ink hide).

## Impact

- **Frontend:** `ThemeBackdrop.tsx`, new ambient renderer module, `builtin.ts`, `types/theme.ts`, `ThemeGallery.tsx` (optional Animated section).
- **Tests:** `jellyfishPalettes.test.ts`, `jellyfishRenderer.test.ts`, extend `modeAccent`/`ThemePicker` counts.
- **Dependencies:** None.
- **Risk:** Canvas cost — mitigated by single jellyfish entity, capped particles, existing performance gates, static mode without RAF.
