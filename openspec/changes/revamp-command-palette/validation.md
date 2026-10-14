# Validation — revamp-command-palette

Evidence recorded while implementing the change. Reproduce with the commands in
each section.

## Visual fixture and captures (10.1, 10.2)

Deterministic fixture: `src/visual/commandPaletteHarness.tsx` (mounted by
`public/command-palette-harness.html`) with a fixed clock (relative times are
literal strings), a pinned fixture font stack, fixed inline-SVG cover, and
synthetic candidate data that never touches production stores. The fixture
applies real themes through `ThemeProvider` (default `biolume-abyss`, the app
default) and exposes `paletteHarness.setTheme(id)`; the palette's material is
derived from the active theme, so captures are taken per theme.

Run:

```bash
npm run dev -- --port 5199   # or let Playwright start it
npx playwright test src/visual/command-palette.visual.spec.ts
```

Measured geometry at the reference viewport (1586 × 992), overlay only
(targets from `design.md`; tolerance 4 CSS px — all pass):

| Region | Reference | Measured | Δ |
| --- | --- | --- | --- |
| Overlay panel | x 376, y 120; 838 × 738 | x 374, y 120; 838 × 738 | 2, 0 |
| Search field | x 389, y 132; 812 × 61 | x 388, y 133; 810 × 60 | 1, 1 |
| All scope pill | x 395, y 212; h 32 | x 393, y 213; h 32 | 2, 1 |
| Tile row | x 394, y 299–444; 802 wide | x 393, y 301; 800 × 145 | 1, 2 |
| Resume card | x 394, y 495; 802 × 190 | x 393, y 498; 800 × 191 | 1, 3 |
| Cover | x 414, y 512; 106 × 156 | x 414, y 515; 106 × 156 | 0, 3 |
| Last-position inset | x 949, y 511; 233 × 157 | x 949, y 515; 233 × 157 | 0, 4 |
| Prompt grid | 2 × 2, y 743 / 795, h ≈ 42 | 2 × 2, y 745 / 795, h 42 | 2 |

Captures (`.playwright/results/`; the starred files also carry committed
snapshot baselines in `src/visual/__snapshots__/`):

- `command-palette-default-1586.png` * (composition under the app default
  theme, Biolume Abyss)
- `command-palette-theme-obsidian.png` and `command-palette-obsidian-1586.png` *
  (the preserved reference's black-and-gold material; compared region-by-region
  against `openspec/changes/revamp-command-palette/reference/command-palette-target.png`)
- `command-palette-theme-default.png`, `command-palette-theme-snow.png`,
  `command-palette-theme-golden-hour.png` (theme-adoption captures)
- `command-palette-phone.png` * (390 × 844 sheet)
- `command-palette-1440x900.png`, `command-palette-1280x800.png`,
  `command-palette-short-desktop.png`, `command-palette-768x1024.png`,
  `command-palette-phone-keyboard.png` (390 × 520 keyboard-height viewport),
  `command-palette-zoom200.png` (793 × 496 ≈ 200 % zoom)
- `command-palette-search-results.png`, `command-palette-view-all.png`,
  `command-palette-note.png`, `command-palette-first-run.png`,
  `command-palette-caught-up.png`, `command-palette-assistant-unavailable.png`,
  `command-palette-resume-loading.png`, `command-palette-search-error.png`,
  `command-palette-contextual.png`, `command-palette-url-import.png`

Batch protocol: one --update-snapshots run wrote the baselines and all
captures; one further full run confirmed all 22 tests pass without updates
(bounds assertions + snapshot comparisons).

### Theme adoption (material follows the user's chosen theme)

The palette's semantic roles are bound to the active theme's tokens; the
visual spec asserts this in a real browser:

- Default theme (Biolume Abyss): the selected scope pill computes to the
  theme primary `rgb(6, 182, 212)`, the panel uses the theme's deep-sea
  surfaces, and the root theme attributes (`data-theme-animation=bioglow`,
  `color-scheme: dark`, background `rgb(2, 11, 20)`) are untouched by opening
  the palette.
- Obsidian Noir: the same composition renders in the reference's
  black-and-gold material (panel luminance < 40 at ~#111318, accent
  `rgb(232, 168, 64)`).
- Snow (light): the panel is a light surface (mean channel > 200) with dark
  text (mean channel < 120) — readable contrast on a light theme.
- Golden Hour (light gold): accent `rgb(212, 145, 62)` over light surfaces.

### Side-by-side inspection notes (reference vs capture)

- Same region order, proportions, and alignment under every theme: outlined
  field with leading sparkle and trailing platform shortcut; six scope pills
  with the accent-selected All pill; six Quick Action tiles with the
  accent-outlined selected tile and the `1 due` badge; three-part resume card;
  “Ask Plethora” heading with helper and two-column prompt grid.
- Under Obsidian Noir (the reference-matching theme) the material reproduces
  the preserved reference; under the app default theme the identical
  composition renders in the theme's own colors, and light themes render
  light surfaces with dark text.
- Intentional accessibility adjustments (allowed by the spec and design):
  - A Close control inside the field (the reference has none) — keyboard
    reachable and always visible on coarse pointers.
  - The palette material is theme-derived rather than a fixed black-and-gold
    skin (user-directed correction): the reference governs composition and
    geometry, and its exact appearance is reproduced when a gold-on-black
    theme (Obsidian Noir) is active; every other theme gets its own material.
  - Muted text is lighter than the sampled raster to hold ≥ 4.5:1 contrast.
  - The resume timestamp reads “Last updated” (a modification time) rather
    than the reference's “Last read”, because no genuine reading timestamp is
    persisted; the fixture shows the honest label.
  - Coarse pointers expand pills/buttons to ≥ 44 px effective height.
- The surrounding dashboard is a neutral backdrop in the fixture; it is not
  part of the chrome comparison, and no dashboard/global theme style changed
  (asserted by the “reference chrome stays local” test).

## Interaction and regression tests (10.3)

```bash
npx vitest run src/commandPalette/__tests__ src/components/search/__tests__ \
  src/utils/__tests__/commandPaletteShortcut.test.ts \
  src/utils/__tests__/commandPaletteEvents.test.ts \
  src/components/common/__tests__/CommandPalette.savedQueues.test.tsx \
  src/utils/__tests__/cardSourceNavigation.test.ts \
  src/utils/__tests__/cardSourceReturnContract.test.ts \
  src/utils/__tests__/openCaptureDocument.test.ts \
  src/lib/__tests__/importRouting.test.ts
```

Result: 16 files / 123 tests pass (includes `GlobalSearch.test.tsx` legacy
search behaviour, new `GlobalSearchHub.test.tsx` hub interactions, selector
tests for home/facets/recent-opens/note-draft/note-saver/contracts, shared-
command and shortcut regressions, exact-hit/`openDocumentAtLocation`
navigation, and card source jumps).

Palette-focused re-run after the verification additions (note saver, ask
handoff, suggestion routing, out-of-order responses, URL Escape):
`src/commandPalette/__tests__` + `src/components/search/__tests__` →
12 files / 81 tests pass. This includes `CommandCenter.hub.test.tsx`, which
mounts the real controller with the document store populated (and with an
empty library) and asserts the hub renders the actual derived home model.

That smoke test exposed a pre-existing retry loop in `CommandCenter`'s
auto-load effect: with an empty library, each completed `loadDocuments()`
re-triggered the effect. The effect now additionally requires
`hasCompletedFirstLoad === false`, so an empty library loads once instead of
looping — a minimal guard, no behavior change for populated libraries.

Also run while implementing: `DocumentsView` + `src/components/viewer` suites
(55 files / 381 tests) and `SelectionActionsSheet` + `MainLayout` suites
(3 files / 26 tests) — all pass.

## Performance and bundle (10.4, 10.5)

```bash
npm run bench:check
npm run build:check
```

- New deterministic benchmarks (`src/commandPalette/palette.bench.ts`, seeded
  `seededRandom`, 3,000-document fixture, void bodies, consumed sink):
  `commandPalette/resume-selection-3000-docs` (cost 0.208),
  `commandPalette/recent-selection-3000-docs` (0.1539),
  `commandPalette/scope-filter-2000-results` (0.1677). Baselines added to
  `scripts/perf-baselines.json` with reasons; `bench:check` reports
  `OK — 53 benchmark(s) compared` plus pre-existing stale-baseline warnings
  for unrelated suites (noted below).
- Bundle budget: `[bundle-budget] OK — entry 5 KB, 1 PDF worker, total 24.4 MB`.
- `tsc` passes; targeted ESLint on all new/changed files reports 0 errors.

## `openspec validate`

```bash
openspec validate revamp-command-palette --type change --strict --no-interactive
# → Change 'revamp-command-palette' is valid
```

## Unrelated pre-existing failures (documented separately, not caused here)

- `scripts/docs-validate.mjs` fails on `docs/product/features/platform/apple-core-ai-packaging.md`
  (missing frontmatter delimiter) and `ios-capabilities.md` (missing fields +
  broken cross-reference). Both files are untouched by this change.
- `npm run test:scripts`: `applyIosProjectOverrides consumes
  share-extension.target.json when present` and `verify-frontend-build metadata`
  fail (the latter only when `dist/` was produced by a non-Tauri `vite build`,
  which is how this check was run). Neither exercises palette code.
- `bench:check` prints “stale baseline” warnings for several pre-existing
  suites (point/anchor round trips, article-import, tabs-dom, ambient rain,
  smart-tagging) on this machine; no tolerance was relaxed.
