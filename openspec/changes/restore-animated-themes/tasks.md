## 1. ThemeBackdrop — wire the master toggle and remove the idle pause

- [x] 1.1 In `src/components/common/ThemeBackdrop.tsx`, read `settings.interface.animationsEnabled` (already destructured from `useSettingsStore`) and use it as the primary gate: if `!animationsEnabled`, render `null` (like the current `suspended`/`!animation` early return at line 1497).
- [x] 1.2 Remove the idle-pause mechanism: delete the `IDLE_PAUSE_MS` constant (lines 14-20), the `isIdle` state (line 1346), the activity-tracker `useEffect` (lines 1365-1389), and the `isIdle` term from the canvas effect's run condition (line 1435) and dependency array (line 1495). Remove the now-dead "idle" comments at lines 1432-1435.
- [x] 1.3 Keep the visibility/focus gates (`isVisible` via `visibilitychange` + Tauri `onFocusChanged`) intact so animation still pauses when the app is hidden/unfocused.
- [x] 1.4 Add a `prefers-reduced-motion` guard: compute `const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;` reactively (listen to the media query via `matchMedia(...).addEventListener('change')`) and include it in the gate so animations don't run when reduced motion is requested.

## 2. ThemeBackdrop — make native mobile opt-in instead of hardcoded off

- [x] 2.1 Replace the unconditional `if (isNativeMobile()) return null;` (line 1360) so native mobile renders the backdrop only when the user has explicitly enabled animations. Implement via the one-time mobile default in section 4 (so `animationsEnabled` is authoritative): on native mobile the effective gate becomes `if (isNativeMobile() && !animationsEnabled) return null;`, which is already covered by the master gate from 1.1 once the mobile default is `false`.
- [x] 2.2 Verify the battery density reduction (`effectiveDensity = onBattery ? density * 0.5 : density`, line 1352) is unchanged and still applies when animations run on mobile.

## 3. Liquid Glass themes — restore blobs on macOS/Windows

- [x] 3.1 In `src/themes/builtin.ts`, remove the blob-suppression CSS block from `liquidGlassTheme` (the `:root[data-theme-id="liquid-glass"][data-vibrancy-active="true"]::before/::after { display: none !important; }` rules around lines 3596-3603).
- [x] 3.2 Remove the equivalent vibrancy-suppression CSS block from `amberLiquidGlassTheme` (~lines 3862-3869).
- [x] 3.3 Remove the equivalent vibrancy-suppression CSS block from `roseLiquidGlassTheme` (~lines 4128-4135).
- [x] 3.4 Add a `@media (prefers-reduced-motion: reduce)` rule to each Liquid Glass theme's `customCSS` that pauses/disables the `liquid-blob-flow` keyframe animation (so reduced-motion disables CSS blobs too). Define once and reuse across the three themes.

## 4. Settings store — authoritative `animationsEnabled` default

- [x] 4.1 Confirm `animationsEnabled` is declared in `InterfaceSettings` (`src/stores/settingsStore.ts:251`) and defaulted to `true` (`src/stores/settingsStore.ts:535`) — no schema change needed.
- [x] 4.2 Add a one-time native-mobile default: on first run when `isNativeMobile()` is true, persist `animationsEnabled: false` (e.g. in the store's initialization/migration path) so mobile keeps the current no-animation behavior unless the user opts in. Ensure this doesn't override an existing explicit user choice.

## 5. Settings UI — expose the toggle

- [x] 5.1 In `src/components/settings/SettingsPage.tsx`, add an "Enable animated themes" Switch as the first row of the "Animated Backdrop" section (before the "Particle Density" row at line 948), bound to `settings.interface.animationsEnabled` via `updateSettingsCategory("interface", { animationsEnabled })`.
- [x] 5.2 Give the toggle a short description noting the performance/battery trade-off (especially on mobile/laptops).
- [x] 5.3 When `animationsEnabled` is false, disable (grey out) the "Particle Density" and "Brightness" rows so they visibly have no effect.

## 6. Verification

- [x] 6.1 App builds and type-checks with no new TypeScript/lint errors (`npm run build` / `npm run lint` as appropriate).
- [ ] 6.2 On desktop (Linux/web): select each animated canvas theme (rain, aurora, sunbeams, cherryblossom, cyberhighway, cosmicdust, bioglow, dandelions, rainywindow) and confirm it animates continuously past 10s of inactivity while the window is focused.
- [ ] 6.3 On desktop: select each Liquid Glass theme and confirm the gradient blobs animate (including on macOS/Windows where vibrancy is active — verify via the web build or by toggling vibrancy if needed).
- [ ] 6.4 Toggle "Enable animated themes" off → all animation stops; density/brightness rows disable. Toggle on → animation resumes.
- [ ] 6.5 Enable OS reduced-motion → animation stops regardless of the toggle; disable reduced-motion → animation resumes (if toggle is on).
- [ ] 6.6 On Android: fresh launch shows no animation by default; opting in via the toggle enables animated themes; battery density reduction still applies.
- [ ] 6.7 Minimize/blur the window or switch tabs → animation pauses; restore → animation resumes.
