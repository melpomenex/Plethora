# Tasks: add-material-3-design-system

## 1. Token foundation

- [x] 1.1 Create `src/themes/materialRoles.ts` with `deriveMaterialRoles(colors, variant)` producing the full M3 role set from existing `ThemeColors` (container ramps, secondary/tertiary derivation, inverse roles, contrast clamping via `themes/color.ts`) — verified by unit tests over representative light/dark/high-saturation fixtures
- [x] 1.2 Wire derivation into `ThemeContext.applyThemeToDOM()` and register new roles + shape/type/motion/state/z tokens in `src/index.css` `@theme`/`:root` — verified by `npm run test:run` and a DOM test asserting `--color-surface-container-high` etc. resolve for a legacy theme
- [x] 1.3 Add state-layer utility classes, `.md-typescale-*` typography classes, and motion-token transitions gated by reduced-motion/animationsEnabled in `index.css` — verified by class-presence tests and visual inspection
- [x] 1.4 Extend the E-Ink block in `index.css` to project all new roles to monochrome with borders-not-shadows — verified by token-resolution test under `data-display-mode="eink"`
- [x] 1.5 Add `generateSchemeFromSeed(seed)` in `src/themes/materialRoles.ts` (light+dark, all roles, AA-checked) — verified by unit test
- [x] 1.6 Sweep all 175 built-in themes through derivation in a unit test: container monotonicity, `on-X`/`X` AA pass for text pairs, legacy alias parity — `vitest run src/themes/__tests__/materialRoles.test.ts`

## 2. Primitive library (`src/components/md3/`)

- [x] 2.1 `Button` + `ActionButton` compatibility re-export (filled/tonal/outlined/text/destructive × default/compact/large/icon, state layers, 40px targets) — verified by component + snapshot-contract tests and existing `UI.test.tsx` passing unchanged
- [x] 2.2 `IconButton`, `Fab` — verified by component tests (aria-label requirement, touch target)
- [x] 2.3 `Chip` (assist/filter/input, checkmark+`aria-pressed` on selected) and `SegmentedButton` (roving arrows, checkmark) — verified by keyboard tests
- [x] 2.4 `MenuItem`/`Menu` (portal, Escape/arrows/typeahead, destructive) and `ListItem`/`Divider` — verified by keyboard nav tests
- [x] 2.5 `TextField`/`SearchField` (label/error/disabled, error not color-alone), `Slider`, `Checkbox`, `Radio`; re-export existing `Switch` — verified by component + a11y tests
- [x] 2.6 `LinearProgress`/`CircularProgress`, `Tooltip` (focus-triggered), adopt `Skeleton` — verified by component tests
- [x] 2.7 `Dialog` core (focus trap/restore, scrim, elevation) rendered through by `Modal.tsx`, `ConfirmDialog.tsx`, `ResponsiveDialogSheet` — verified by existing Modal/ConfirmDialog tests passing plus new focus-management tests
- [x] 2.8 Snackbar evolution of `Toast.tsx` renderer (bottom placement, action, pause-on-hover, aria-live) with unchanged `useToast()` API — verified by existing Toast tests passing unchanged

## 3. Shell migration

- [x] 3.1 Restyle desktop `Toolbar` rail + `TabBar` + `WorkspaceSwitcher` onto tokens/state layers/active-pill indicators with zero behavior change — verified by Tabs test suite + rail behavior smoke test
- [x] 3.2 Restyle `MobileNavigation` bottom nav + More sheet onto tokens with active pills, badges, safe areas preserved — verified by mobile.css contract tests
- [x] 3.3 Replace arbitrary z-index values in migrated shell/chrome components with the `--md-z-*` scale, keeping stacking contracts — verified by a layering test (selection toolbar above dialog, toasts above nav)

## 4. Screen migrations

- [x] 4.1 Settings: replace raw inputs/`window.prompt`/emoji tabs with md3 primitives (Switch, SegmentedButton, TextField, Dialog) across `SettingsPage` and `settings/*` panels — verified by Settings rendering tests + keyboard walkthrough
- [x] 4.2 Review: `RatingButtons` 4-scale as M3 button group + `Show Answer` as filled button, preserving labels, interval previews, `data-review-rating`, `aria-keyshortcuts`, 1–4/Ctrl+1–4 keys, and 6-grade mode — verified by review interaction tests passing unchanged
- [x] 4.3 Reader chrome: desktop/mobile toolbars, minimap, dictionary card, settings panels onto tokens/tonal elevation — verified by viewer tests + attribute-contract test (`data-extract-button`, `data-chrome-control`)
- [x] 4.4 TTS player: idle↔playback morph using motion tokens with instant swap under reduced motion/E-Ink, preserving `ReaderTTSHandle` API and all controls — verified by ReaderTTSControls tests + reduced-motion test
- [x] 4.5 Selection toolbar: primary actions visible + overflow menu on desktop, sheet on touch; all actions preserved — verified by selectionInteraction tests + action-inventory test vs pre-migration list
- [x] 4.6 Library: `DocumentsView` header/bulk bar/rows, `ContinueReadingPage` hardcoded colors → tokens — verified by documents tests + no-hex lint on migrated files
- [x] 4.7 Import surfaces: `ImportDialog` body, `WebArticleImportDialog`, `AudiobookImportDialog`, `DragDropUpload` overlay onto `ResponsiveDialogSheet`+md3 primitives with drop-target state — verified by import dialog tests
- [x] 4.8 Search/palette: `GlobalSearch`/`CommandCenter` panel + `SearchPage` filter chips onto tokens/md3 chips — verified by search tests

## 5. Enforcement, docs, audit

- [x] 5.1 Write `docs/design-system.md` (tokens, primitives, adding components/themes, Dialog-vs-Sheet-vs-Menu table, motion rules, legacy list) — verified by `npm run docs:validate`
- [x] 5.2 ESLint rule flagging hex-in-className and the primary-button recipe in migrated paths with `md3-allow` suppression — verified by `npm run lint` and rule unit fixtures
- [x] 5.3 Adversarial pass: theme × width × input matrix on core screens (light/dark/custom/E-Ink × phone/tablet/desktop × keyboard), fix findings — verified by recorded findings + fixes
- [x] 5.4 Full gate: `npm run build:check`, `npm run test:run`, `npm run lint`, `npm run bench:check` — all green or baselines updated with justification
