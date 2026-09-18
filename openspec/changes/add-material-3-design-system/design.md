# Design: add-material-3-design-system

## Context

The frontend is React 19 + Tailwind CSS v4 with `@theme` tokens in `src/index.css` (2,737 lines), `ThemeContext.applyThemeToDOM()` writing `--color-*` variables from `Theme` objects (`src/types/theme.ts`), and OKLCH color math already present in `src/themes/color.ts`. 175 built-in themes (54 modern literal themes, 121 compact legacy defs expanded by `createLegacyTheme()`, jellyfish/animated variants) rely on the flat `ThemeColors` map; shadcn-style aliases are derived at apply time so nothing in a theme file needs rewriting. A width-based presentation layer (`src/lib/presentation.ts`: phone <600 / tablet <1024 / desktop ≥1024 / compact-desktop) and adaptive primitives (`ResponsiveDialogSheet`, `AdaptiveInspector`) already exist. Shared primitives (`ActionButton` in `common/UI.tsx`, `Switch`, `Modal`/`useModal`, `ConfirmDialog`, `Toast`/`useToast`, `ContextMenu`, `Skeleton`, `EmptyState`) exist but have ~2% adoption; 2,644 raw buttons and 49 ad-hoc dialogs dominate. E-Ink mode overrides tokens under `:root[data-display-mode="eink"]`. The reader styles document content inside iframes/canvases via imperative injection — global CSS never reaches it, which conveniently isolates document content from any chrome restyle.

Constraints that shape this design: no new runtime dependencies; all 175 themes, animated backdrops, novelty themes, E-Ink, keyboard/vimium workflows, tab/pane model, and the `useToast`/`useModal` APIs (100+ call sites) must survive; the app must build and pass tests at every stage; marketing capture depends on DOM attributes (`data-showcase-action`, `data-review-rating`, `data-extract-button`) that must not move.

## Goals / Non-Goals

**Goals:**
- One derivation path: every theme → complete M3 role set, emitted as CSS vars next to the existing ones.
- A primitive library that the highest-traffic surfaces actually use, with `ActionButton`/`Switch`/`Toast` as compatibility seams so unmigrated code keeps working.
- Migration order that keeps the app shippable at each step (foundation → primitives → shell → screens).
- Enforcement that makes regression into ad-hoc styling visible in CI.

**Non-Goals:**
- No rewrite of document rendering, tab/pane engine, review scheduling, or backend.
- No Material component framework adoption (MUI, Material Web) — bundle size, WebView perf on Android, and custom-theme control rule it out; internal primitives on cva cover Plethora's needs without reinventing difficult ARIA (we adopt/extend the existing accessible Switch/Modal/ContextMenu rather than starting from scratch).
- No Android Monet/system-palette bridge in this change — dynamic color is seed-based generation (client-side OKLCH). A native system-accent bridge can layer on later without touching tokens.
- Not migrating all 49 ad-hoc dialogs in one pass — converge the shared dialog primitive + the highest-traffic dialogs; the long tail migrates opportunistically (tracked in tasks).

## Decisions

### D1: Derive M3 roles at theme-apply time, not in theme files

`ThemeContext.applyThemeToDOM()` gains a `deriveMaterialRoles(colors, variant)` step (new module `src/themes/materialRoles.ts`) that computes the missing roles from existing fields via `themes/color.ts` OKLCH primitives and writes them alongside current vars. Themes MAY override any derived role via new optional `ThemeColors` keys (`tertiary`, `secondaryContainer`, `surfaceContainerHigh`, …); absent keys are derived. Legacy themes and jellyfish themes get the full set for free.
*Alternatives*: rewriting 175 theme definitions (rejected: hand-unsupportable, risks breaking novelty themes); a runtime HCT-tone generator port of Material color utilities (rejected: ~30KB of code to do what targeted OKLCH lightness ramps already do for container tiers; we don't need dynamic-source tonal palettes because our sources are fixed theme colors).

Derivation rules (tone ramps keyed on variant): containers = OKLCH lightness steps of the background/surface family; `secondary` = primary desaturated toward neutral; `tertiary` = primary hue-rotated ~60° with reduced chroma (or `modeAccent` when a theme defines one — reuses the existing resolver's hue-separation logic); inverse roles = `on-surface`/`surface` swap with `primary` as `inverse-primary`. Every `on-X` is validated against its `X` with the existing WCAG contrast function; pairs that fail get a lightness clamp. Output is hex (repo convention — no `oklch()`/`color-mix()` in emitted *theme* values, keeping the browser-sync `/api/theme` endpoint and iframe injection working).

### D2: Tokens as Tailwind `@theme` entries + utility classes for state layers

New roles are registered in `@theme` (`--color-surface-container-high` etc.) so Tailwind emits `bg-surface-container-high`-style utilities with zero per-component CSS. State layers are exposed as utility classes (`.md-state`, `.md-state-hover`… using `color-mix(in srgb, var(--md-state-color, currentColor) N%, transparent)` with `@property`-free graceful degradation) that primitives apply; opacities follow M3 (hover 8%, focus 10%, press 10%, selected 16%, dragged 16%). Motion tokens (`--md-duration-*`, `--md-easing-*`) and a z-scale (`--md-z-{nav,overlay,dialog,menu,snackbar,tooltip,critical}`) land in `@theme` + `:root`. Typography roles are CSS vars (`--md-typescale-*`) consumed by a small set of utility classes (`.md-title-large` etc.) — chrome only, `--reading-*` untouched.
*Alternative*: CSS-in-JS or a headless UI kit — rejected (Tailwind v4 var registration already gives utility coverage with no runtime cost).

### D3: Primitives live in `src/components/md3/`, built on cva + existing behavior cores

`Button` (filled/tonal/outlined/text/destructive × default/compact/large/icon) is a variant-extension of the existing `actionVariants` cva — `ActionButton` becomes a re-export shim so its 7 call sites and tests keep passing. `IconButton`, `Fab`, `Chip`, `SegmentedButton`, `MenuItem`/`Menu` (portal + keyboard nav, converging `ActionMenu`), `ListItem`, `TextField`, `SearchField`, `Slider`, `Checkbox`, `Radio`, `LinearProgress`/`CircularProgress`, `Tooltip`, `Divider`, `Snackbar` (evolved `Toast.tsx` renderer — store and `useToast()` API untouched), `Dialog` (visual core that `Modal.tsx`, `ConfirmDialog.tsx`, and `ResponsiveDialogSheet` render through). Switch stays where it is; md3 re-exports it. Barrel `src/components/md3/index.ts` + colocaled `__tests__`.
*Alternative*: one god-file like `UI.tsx` — rejected (tree-shaking and review ergonomics); parallel design system with adapters — rejected (two sources of truth).

### D4: Migration order = foundation → primitives → shell → screens, with compatibility seams at each step

1. Tokens + derivation (invisible until consumed; E-Ink projection extended to new roles in the same `data-display-mode="eink"` block).
2. Primitives + tests; `ActionButton`/`Toast`/`Modal` re-pointed at them internally.
3. Shell: `Toolbar` rail, `TabBar`, `MobileNavigation` bottom nav, `CollectionSwitcher` — token restyle only; no behavior edits (rail widths, hover-expand timings, drag regions untouched).
4. Screens in traffic order: Settings (raw inputs → primitives; biggest a11y win), Review rating control + Show Answer (M3 segmented group; `data-review-rating`, `aria-keyshortcuts`, interval labels, 1–4/Ctrl+1–4 keys preserved), Reader chrome + TTS player morph + selection toolbar (attribute contracts pinned by tests), Library header/bulk-bar/rows, import dialogs, palette surfaces.
5. Cleanup + enforcement: docs, lint rule, dead CSS removal where provably unused.

Each step compiles and passes `npm run test:run`; z-contract test asserts the selection toolbar stays above dialogs.

### D5: Enforcement via documentation + a scoped lint rule

`docs/design-system.md` (tokens, primitives, adding components/themes, Dialog-vs-Sheet-vs-Menu decision table, motion rules, legacy list). A custom ESLint rule (`scripts/eslint-rules/`, wired into `eslint.config.js`) flags hex literals and the known primary-button recipe inside `className` only for files under migrated paths (config list), with `// md3-allow:` suppression — keeping feature-specific exceptions possible without watering the rule into noise.

### D6: E-Ink and novelty themes as first-class projections, not afterthoughts

The E-Ink block in `index.css` gains the new roles (monochrome ramp mirrors container ordering); novelty overrides (`windows-95`, `minecraft`) already force radii/colors with `!important` over tokens, which keeps working because primitives consume the same var names. Animated backdrops: chrome sits on token surfaces exactly as today — contrast rules already guarantee text-on-backdrop via theme text colors; the derivation adds no translucency.

## Risks / Trade-offs

- [Derived-role contrast regressions in extreme themes (high-saturation legacy themes)] → every derived `on-X`/`X` pair is contrast-checked at derivation and clamped; a unit test iterates all 175 built-ins asserting AA for body-text pairs and monotone container ordering.
- [State-layer `color-mix` unsupported in old WebViews] → opacities degrade to no overlay (progressive enhancement); hover/focus also change border/fill tokens so states remain perceivable. Focus rings never rely on `color-mix`.
- [Restyle breaks imperative DOM contracts (selection toolbar, word highlighter, marketing capture)] → attributes/classes are enumerated in tests (`data-review-rating`, `data-extract-button`, `[data-document-scroll-container]`, `.viewer-content-area`, showcase anchors) and asserted before/after.
- [Dialog consolidation regressions across 49 call sites] → converge visuals behind the existing components first (`Modal`, `ConfirmDialog`, `ResponsiveDialogSheet` share the `Dialog` core); migrate ad-hoc call sites only in high-traffic surfaces, leaving the long tail functional on legacy classes.
- [Linux WebView animation cost from new transitions] → transitions are token-gated (off under reduced-motion/animationsEnabled, already default-off on native mobile); no new `backdrop-filter` is introduced — net shadow/blur usage decreases.
- [Bundle growth from primitives] → primitives are small cva components in one barrel with tree-shakeable exports; bundle budget check gates the change.
- [Scope creep into reader content] → non-goal enforced by spec `material-reader-chrome` requirement "Document content isolation" and by keeping all edits outside iframes/`--reading-*`.

## Migration Plan

Staged per D4; every stage is independently shippable and revertible (tokens are additive; primitives are new files; restyles are per-component commits). Rollback = revert the stage commit; no data migrations, no persisted-setting changes (theme selection, E-Ink prefs, and animation settings keep their existing keys and semantics).

## Open Questions

None blocking — dynamic-color system-accent bridging on Android is explicitly deferred (see Non-Goals) and does not affect token shape.
