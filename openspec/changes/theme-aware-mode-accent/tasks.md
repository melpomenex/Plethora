## 1. Theme Layer: Color Utility And Resolver

- [x] 1.1 Create `src/themes/color.ts`: dependency-free sRGB ⇄ OKLCH conversion, WCAG relative luminance/contrast ratio, hex/rgb/rgba parsing, alpha flattening over a base color, and readable-color clamping helpers; extract/reuse the `makeOpaque` logic from ThemeContext rather than duplicating it.
- [x] 1.2 Add table-driven unit tests for the color utility (known hex↔OKLCH fixtures, alpha parsing, contrast ratios, round-trip stability).
- [x] 1.3 Create `src/themes/modeAccent.ts` exporting `resolveModeAccent(theme)` implementing the design's precedence chain (explicit → best palette candidate → synthesized hue rotation → global default), monochrome neutral path, scoring thresholds (hue sep ≥ 60°, contrast ≥ 3.0, chroma 0.025–0.33), and the legibility clamp loop; emit hex/rgb strings only.
- [x] 1.4 Add `modeAccent?: string` to `ThemeColors` in `src/types/theme.ts` with a doc comment; verify `exportTheme`/`importTheme` round-trip it without new validation logic.
- [x] 1.5 Write the catalog-wide resolver test: iterate all `builtInThemes` (modern + legacy, 169 themes) asserting parseable output, contrast ≥ 3:1 vs surface and vs the 12% tint blend, foreground ≥ 4.5:1 vs solid accent, and hue separation ≥ 60° or the monochrome neutral path; assert determinism across repeated runs.

## 2. CSS Variable Exposure

- [x] 2.1 Add `--color-mode-accent` and `--color-mode-accent-foreground` defaults to the `@theme` block in `src/index.css` (stage-4 global defaults from design.md).
- [x] 2.2 In `ThemeContext.applyThemeToDOM`, resolve and set `--color-mode-accent` / `--color-mode-accent-foreground` on the document root so preview, commit, and restart paths all update the tokens.

## 3. Scroll Mode Launcher Migration

- [x] 3.1 Create the shared prominent-state class contract (e.g. `src/components/queue/scrollModeEntry.ts`) using only `mode-accent` token utilities (tinted bg, accent border, accent text) plus the existing disabled classes.
- [x] 3.2 Migrate the desktop launcher in `src/components/review/ReviewQueueView.tsx` (lines ~1080-1095) to the shared classes, preserving layout, two-line label, icon, tooltip, min-height, and default focus outline.
- [x] 3.3 Migrate the mobile launcher in `src/components/mobile/MobileQueueView.tsx` (lines ~719-728) to the shared classes, preserving icon-only layout, `disabled` gating, `active:scale-95`, and tooltip.
- [x] 3.4 Remove every hard-coded pink/purple style from both launchers; grep-verify no `from-purple-500`, `to-pink-500`, or literal pink/purple hex remains in Scroll Mode UI code.

## 4. Component And Regression Tests

- [x] 4.1 Component test (desktop): enabled launcher renders with mode-accent classes; hover/disabled/focus classes intact; tooltip key present; activation callback unchanged.
- [x] 4.2 Component test (mobile): enabled launcher uses the same token classes; disabled state renders ordinary disabled styling when the queue is empty.
- [x] 4.3 Regression test: existing Scroll Mode suites (`QueueScrollPage.rebuild.test.tsx`, `ReviewQueueView.test.tsx`, `QueueTab.test.tsx`) pass unmodified; theme switching behavior in ThemeContext tests unaffected.
- [x] 4.4 Source audit test or check: no theme-name/id conditionals and no literal accent colors in Scroll Mode component sources.

## 5. Visual QA Matrix

- [ ] 5.1 Manually verify the launcher (inactive → enabled → hover → keyboard focus → activate → exit) on representative themes spanning: dark (biolume-abyss), light (snow), warm/sepia (espresso-roast, macchiato-cream), high-contrast (high-contrast-dark/light), monochrome (focus, windows-95), OLED-black legacy (abyss), pink/purple (rose-quartz, material-you, velvet-twilight), blue (modern-dark), low-saturation (espresso-roast), and a liquid-glass alpha theme.
- [ ] 5.2 While the enabled launcher is visible, switch themes, hover-preview themes in the picker, and rapidly cycle themes; confirm the accent updates immediately with no reload and no stale pink.
- [ ] 5.3 Restart the app on a persisted theme and on a persisted custom theme imported before this change; confirm derived accent and normal loading.
- [ ] 5.4 Record any theme where the derived accent is poor; add explicit `modeAccent` values only inside those theme definitions (never in component code), re-run the catalog test, and note the exceptions in the change's design.md decisions if any.
- [ ] 5.5 Capture before/after screenshots for the QA themes if the review workflow supports it (`src/visual` Playwright lane is available but not required).

## 6. Validation And Docs

- [ ] 6.1 Run `npm run test` (or the repo's targeted vitest invocation) plus lint/typecheck; ensure no regressions.
- [ ] 6.2 Update user-facing docs/help content only if it references the pink Scroll Mode button (help index mentions scroll mode entry; verify no color claims exist — stale `customAccentColor` help text is out of scope).
- [ ] 6.3 Confirm no benchmark impact (resolver runs once per theme application; no new bench required) and that `npm run bench:check` still passes if run.
