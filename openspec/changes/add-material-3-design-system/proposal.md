# Proposal: add-material-3-design-system

## Why

Plethora's UI is a collection of individually styled surfaces: 2,644 hand-classed `<button>` elements vs 7 files using the shared `ActionButton`, 385 copy-pasted "primary button" Tailwind recipes, 49 ad-hoc `role="dialog"` implementations, 10 menu implementations, 11 hand-rolled toggles, 3 confirm dialogs, 430 hardcoded hex colors, and a 653-instance shadow type scale of arbitrary pixel font sizes. The token layer (`@theme` + `ThemeContext`) and an adaptive presentation system already exist and are healthy, but they are Material-3-shaped only by accident (the `ThemeColors` map already carries `primary/onPrimary/primaryContainer/surfaceVariant/outline/errorContainer`) and are missing surface-container hierarchy, tertiary, container-variant, and inverse roles. Nothing enforces semantic usage, so every new feature reintroduces bespoke styling. Adopting Material 3 as the underlying grammar — semantic roles, shape/typography/elevation/state/motion scales, adaptive layout rules, and a real primitive library — makes Plethora feel like one product across Android and desktop instead of 669 files of local decisions, without rewriting features or abandoning the 175-theme system, E-Ink mode, or animated backdrops.

## What Changes

- **Complete the semantic token system**: extend the existing `--color-*` CSS variable layer with the full Material 3 role set (`primary-container` family, `secondary`/`secondary-container`, `tertiary`/`tertiary-container`, `surface-container-lowest…highest`, `surface-dim/bright`, `on-surface-variant`, `inverse-*`, `scrim`), derived automatically from every existing theme via the repo's OKLCH color math — no theme definitions are rewritten by hand.
- **Add non-color token scales**: Material shape scale (mapped onto the existing `--radius-*`), M3 typography roles layered over the current text utilities, a tonal elevation model (surface-container steps instead of shadow stacking), standard state layers (hover/focus/pressed/selected/disabled via `color-mix` on `on-*` roles), a motion token set (`--md-duration-*`, `--md-easing-*`), and a z-index scale.
- **Build a Material 3 primitive library** (`src/components/md3/`) on the existing cva/clsx stack — no new runtime dependencies: Button (filled/tonal/outlined/text), IconButton, FAB, Chip (assist/filter/input), SegmentedButton, Switch (adopt the existing one), Checkbox, Slider, TextField/SearchField, MenuItem/Menu, ListItem, Divider, Progress, Snackbar (evolved Toast), Dialog consolidation (converge `useModal` + `ConfirmDialog` + ad-hoc dialogs onto one contract), Tooltip. Existing `ActionButton` becomes a compatibility alias.
- **Migrate the shell and principal screens**: desktop Toolbar rail and mobile bottom nav restyled onto tokens + state layers; Library (DocumentsView/ContinueReading); reader chrome (toolbars, TTS player with idle→playback morph, selection action bar) while leaving document content untouched; FSRS rating control as a Material segmented group (labels + intervals preserved, keyboard shortcuts unchanged); Settings page off raw native inputs; import dialogs; command palette surfaces.
- **Enforce**: documentation (`docs/design-system.md`) + a lint rule discouraging new ad-hoc primary-button recipes and raw hex in `className` for migrated areas, plus updated component tests.
- **Preserve explicitly**: all 175 themes (now projected onto the full role set), animated WebGL/Canvas backdrops, E-Ink mode (monochrome projection gets the same roles), novelty themes (Windows 95 etc. keep their overrides), all keyboard/vimium workflows, tab/pane model, and backend behavior.

## Capabilities

### New Capabilities

- `material-tokens`: Semantic design-token layer — full M3 color role set (plus shape, type, elevation, state-layer, motion, spacing, z-index scales) emitted as CSS variables from every existing theme, with light/dark derivation, E-Ink projection, and seed-based palette generation for dynamic color.
- `material-components`: The Material 3 primitive library — variants, states (hover/focus/pressed/selected/disabled/dragged), minimum touch targets, keyboard behavior, and adoption rules (when to use Button vs IconButton vs MenuItem; Dialog vs Sheet vs Menu vs Snackbar).
- `material-adaptive-shell`: Material 3 application shell — desktop navigation rail/toolbar, mobile bottom navigation, adaptive dialog/sheet routing, and feedback-surface rules (snackbar vs dialog) across compact/medium/expanded widths.
- `material-reader-chrome`: Material 3 treatment of reader-adjacent chrome — toolbars, floating TTS player (idle↔playback morph), selection toolbar, and reader setting surfaces — with the explicit constraint that document content styling is out of scope and must not be affected.

### Modified Capabilities

<!-- No existing spec-level behavior changes: reader, review, search, settings, and toast
     behaviors keep their contracts; this change restyles and consolidates their UI. -->

## Impact

- **Frontend styling core**: `src/index.css` (token definitions, state layers, motion, E-Ink projection), `src/contexts/ThemeContext.tsx` + `src/themes/color.ts` (role derivation), `src/types/theme.ts` (optional new color keys remain backward compatible).
- **Components**: new `src/components/md3/` library; migrations in `src/components/{common,layout,mobile,viewer,review,documents,settings,import,search,queue}`; convergence of `Modal.tsx`/`ConfirmDialog.tsx` onto the shared dialog primitive; `ReaderTTSControls`, `RatingButtons`, `SettingsPage`, `DocumentsView`, `SelectionActionBar`, import dialogs restyled.
- **Tests**: new component tests for md3 primitives and token derivation; existing tests updated only where class names/DOM structure they assert legitimately change.
- **Dependencies**: none added (cva, clsx, tailwind-merge, @phosphor-icons already present).
- **Docs/tooling**: `docs/design-system.md`; eslint guidance rule.
- **Non-goals**: no backend/Rust changes (except reading an Android system accent if a bridge already exposes one), no document rendering engine changes, no removal of themes/E-Ink/animated backdrops, no mobile-patterns-on-desktop, no rewriting of working workflows for aesthetics.
