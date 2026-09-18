# Plethora Design System (Material 3)

Plethora's UI grammar is Material 3 projected through Plethora's theme system:
**Material You underneath, Plethora on top.** This document is the contract
for anyone adding or changing UI. The OpenSpec change
`openspec/changes/add-material-3-design-system/` is the source of record for
the migration; this file is the ongoing guide.

## Principles

1. **Semantic tokens only** for application chrome — no hex colors, no
   arbitrary radii/durations/z-indexes in `className`. Feature-specific
   values (brand logos, extract highlight palettes, injected reader HTML)
   are the sanctioned exceptions.
2. **Material is the grammar, not the product.** Desktop stays desktop
   (rail + tabs + panes + keyboard); mobile stays ergonomic (bottom nav,
   sheets, safe areas). Never stretch one onto the other.
3. **Reading content is off-limits.** Document rendering, `--reading-*`
   typography, and reader font settings never consume chrome tokens.
4. **Reuse before reinvent.** If `src/components/md3` has a primitive, use
   it. Don't fork a `FancyButton`.

## Tokens

Defined in `src/index.css` (`@theme` + `:root`) and emitted per theme by
`ThemeContext.applyThemeToDOM` + `src/themes/materialRoles.ts`.

- **Color roles** — full M3 set: `primary`/`on-primary`/`primary-container`,
  `secondary`(-container), `tertiary`(-container), `error`(-container),
  `surface` + `on-surface`/`on-surface-variant`, the container hierarchy
  (`surface-container-lowest/low/(base)/high/highest`), `surface-dim/bright`,
  `outline`/`outline-variant`, `inverse-*`, `scrim`, `surface-tint`, plus the
  legacy shadcn aliases (`background`, `foreground`, `card`, `popover`,
  `muted`, `border`, `destructive`) that predate the migration.
  Themes may pin any role via optional `ThemeColors` keys; everything else is
  derived (OKLCH ramps + WCAG clamping).
- **Shape** — the `--radius-*` scale (`sm…xl`, `full`). M3 mapping:
  chips/fields = `rounded-lg`, menus = `rounded-lg`, dialogs/sheets =
  `rounded-[1.75rem]` (extra-large), buttons/pills = `rounded-full`.
- **Typography** — `.md-display-*`, `.md-headline-*`, `.md-title-*`,
  `.md-body-*`, `.md-label-*` classes (rem-based; chrome only).
- **Elevation** — tonal first: step through surface-container roles. Shadows
  are reserved for floating layers (menus, dialogs, FABs, floating players).
- **State layers** — add the `md-state` class to any interactive surface:
  hover/focus/press/selected overlays of the content color at M3 opacities.
  Disabled = `disabled:opacity-40` + `disabled:pointer-events-none`.
- **Motion** — `--md-duration-short/medium/long` + `--md-easing-*`; collapse
  to 0ms under `prefers-reduced-motion` and `data-reduced-motion="true"`.
  Existing animation settings (`interface.animationsEnabled`) still gate
  ambient effects.
- **Z scale** — `--md-z-{nav:30, overlay:40, dialog:50, menu:60, snackbar:70,
  tooltip:80, critical:9998}`. `critical` hosts the anchored reader selection
  toolbar (above the marketing-capture chrome at 9997).

## Primitives (`src/components/md3/`)

`Button` (filled/tonal/outlined/text/destructive), `IconButton`, `Fab`,
`Chip` (assist/filter/input), `SegmentedButton`, `Menu`/`MenuItem`,
`ListItem`/`Divider`, `TextField`/`SearchField`, `Checkbox`/`Radio`,
`Switch` (adopted from `common/Switch`), `Slider`, `LinearProgress`/
`CircularProgress`, `Tooltip`, `Dialog`.

Legacy shims: `common/UI.tsx`'s `ActionButton` maps onto `Button`
(primary→filled, secondary→tonal, tertiary→text) — new code should import
from `components/md3` directly. `Modal`/`ConfirmDialog`/
`ResponsiveDialogSheet` render through the shared Material dialog surface
contract (`dialogSurface` / `adaptive-dialog-*` classes).

### Adding a component

1. Check `src/components/md3/` first; extend a variant before adding a file.
2. Consume tokens only; add `md-state` + a visible focus treatment.
3. 40px minimum interactive target; label associations (`htmlFor`/`id` or
   `aria-label`).
4. Colocate tests in `src/components/md3/__tests__/`.
5. Export from the barrel.

## Surfaces: Dialog vs Sheet vs Menu vs Snackbar

| Surface | Use when |
| --- | --- |
| Dialog (`md3/Dialog`, `useModal`) | Focused decisions, destructive confirmations, deliberate forms |
| Bottom sheet (`ResponsiveDialogSheet` presentation="sheet") | Compact/mobile contextual action sets |
| Side sheet / inspector (`AdaptiveInspector`) | Wide layouts where detail coexists with content |
| Menu (`md3/Menu`, `ContextMenu`) | Short lists of immediate commands |
| Snackbar (`useToast`) | Transient feedback (max one action); never the only surface for errors needing intervention |

## Adding a theme

Themes are `Theme` objects (`src/types/theme.ts`). Only the classic fields
are required; the extended M3 roles are derived automatically from them.
Provide optional keys (`tertiary`, `surfaceContainerHigh`, …) to pin a role.
`generateSchemeFromSeed(seed)` in `src/themes/materialRoles.ts` produces a
complete AA-checked light+dark scheme from one color.

## Enforcement

`eslint` flags hardcoded hex colors inside `className`/`style` string
literals and the legacy copy-pasted primary-button recipe in migrated paths
(`scripts/eslint-rules/no-hardcoded-chrome-colors.js`). Suppress legitimately
with `// md3-allow: <reason>` on the line above.

## Legacy / deprecated

- `ActionButton` + `actionVariants` (compat shim — do not extend)
- `src/components/common/ThemeSystem.tsx` (vestigial; only FocusTheme types)
- Ad-hoc `fixed inset-0` dialogs outside `useModal`/`Dialog`/`ResponsiveDialogSheet`
  (long tail; migrate opportunistically)
- Raw `peer-checked` toggle markup (use `Switch`)
