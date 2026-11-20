## Context

`scripts/bundle-budgets.json` caps `entryChunkBytes <= 3,000,000` (currently ~2.67 MB) and `totalDistBytes <= 31,450,000` (currently ~31.28 MB). `DESIGN.md` enforces MD3 tokens (`var(--color-*)`, no in-flow shadows, no color-only states). `docs/settings-search.md` requires catalog entries + coverage tests for every Settings control.

## Goals / Non-Goals

- **Goals:**
  - Keep `entryChunkBytes` unchanged by lazy-loading `LearningInsightsTab` and `HealthWearablesSettings` and avoiding any new external chart dependencies.
  - Render smooth multi-month Sleep Chart timelines (Canvas/virtualized SVG) that remain accessible (keyboard row navigation + `sr-only` semantic table) and E-Ink safe (color + hatch pattern + text labels).
  - Honor native `<dialog>` patterns (`showModal()`, `overscroll-behavior: contain`, safe `autofocus` on Cancel for destructive deletes).
- **Non-Goals:**
  - Displaying fabricated placeholder chart curves when no sleep data exists (unless user explicitly clicks "Load Synthetic Demo Dataset").
  - Adding automatic rescheduling buttons or blocking Study Plan progression.

## Decisions

### Hybrid Canvas Timeline + Recharts Analytical Panels
Use an interactive high-DPI `<canvas>` (or lightweight SVG timeline with row virtualization) + keyboard-navigable day inspector for the multi-day Sleep Chart (handles 365+ nights smoothly without 10,000 DOM nodes) paired with `recharts` (`charts-vendor`) wrapped in `<figure>` + `<table className="sr-only">` (`isAnimationActive={!reducedMotion}`) for trend, residual, latency, and alertness curves.

### Settings Placement & Navigation
Surface **Learning Insights** as a top-level workspace tab in `Toolbar.tsx` and `MobileNavigation.tsx` ("More" sheet + Command Palette) so learners never enter Settings to inspect sleep or correlations; place **Health & Wearables** under **Settings → Integrations** with search targets and reveal hooks.
