## Why

Incrementum ships an entire catalog of animated themes — three "Liquid Glass" themes with flowing CSS gradient blobs, plus ~10 scenic themes (rain, aurora, deep space, sunbeams, cherry blossom, etc.) driven by a full-screen `<canvas>` renderer. These animations were turned off for performance reasons in the mobile heating sweep (commit `e4b8e092`), but the de-animation was applied blanket-style and also kneecaps the **desktop** experience: every canvas theme freezes after 10 seconds of no input, native mobile gets no animation at all, and the Liquid Glass blobs are hidden behind native window vibrancy on macOS/Windows. The result is that the "animated themes" users selected look static most of the time, defeating the feature. We want animated themes back — the existing ones we already shipped — with the performance gates turned into opt-in controls rather than hardcoded kill switches.

## What Changes

- **Restore continuous desktop animation.** Remove the unconditional 10-second idle pause (`IDLE_PAUSE_MS` gate at `ThemeBackdrop.tsx:1432-1435`) so canvas-animated themes keep moving while the app is foregrounded. Keep the legitimate visibility/focus gates (tab hidden, window unfocused) which pause animation only when the app is truly not visible.
- **Add an `animationsEnabled` toggle and wire it.** The setting already exists (`settingsStore.ts:251`, default `true`) but is dead code — nothing reads it. Wire it into `ThemeBackdrop` and the Settings → "Animated Backdrop" section so users can turn animations fully off (the performance escape hatch the idle gate was a blunt proxy for).
- **Restore animations on native mobile behind the toggle.** Replace the unconditional `isNativeMobile()` skip (`ThemeBackdrop.tsx:1358-1360`) with a setting-respecting gate so the Android build can use animated themes again when the user opts in. Default respects the mobile perf reality (see design) but is no longer hardcoded off.
- **Restore Liquid Glass blob animations on macOS/Windows.** The `customCSS` hides the animated `::before`/`::after` blobs when `data-vibrancy-active="true"` (builtin.ts:3596-3603 + amber/rosé equivalents). Make the animated blobs the default again by removing/gating that CSS suppression so the flowing gradient shows through regardless of native vibrancy, while keeping vibrancy as an orthogonal translucency layer.
- Expose the new toggle and any related options (e.g. idle-pause behavior) in the existing Settings → "Animated Backdrop" section alongside particle density and brightness.

## Capabilities

### New Capabilities
- `animated-themes-restoration`: Restore continuously animating built-in themes across desktop and mobile, governed by a user-facing enable/disable setting instead of hardcoded performance kill switches; keep the canvas renderer's existing density/brightness controls.

### Modified Capabilities
<!-- None — `animated-themes-visibility` (from the prior fix-animated-themes change) covered CSS-blob visibility through layout wrappers; this change addresses the separate performance de-animation, not that capability's requirements. -->

## Impact

- **Frontend**
  - `src/components/common/ThemeBackdrop.tsx` — remove/rework the idle pause and native-mobile skip; read `animationsEnabled`; keep visibility/focus gates.
  - `src/stores/settingsStore.ts` — `animationsEnabled` already declared/defaulted; confirm defaults and any migration (no schema change needed).
  - `src/components/settings/SettingsPage.tsx` — add an "Enable animations" toggle in the "Animated Backdrop" section (~line 944).
  - `src/themes/builtin.ts` — remove or gate the `[data-vibrancy-active="true"]` blob-suppression CSS in the three Liquid Glass themes (lines ~3596-3603, 3862-3869, 4128-4135) so the animated blobs render on macOS/Windows.
  - `src/components/layout/MainLayout.tsx` — confirm `ThemeBackdrop` still mounts in all three toolbar layouts (no change expected).
- **Native (Rust/Tauri):** No required changes. `apply_platform_vibrancy` (`src-tauri/src/lib.rs`) can stay as-is; vibrancy remains an orthogonal layer. (Optional, design-dependent: expose a theme-level "prefer vibrancy over blob animation" hint.)
- **Dependencies:** None added.
- **Risk:** Reintroducing sustained canvas animation can reheat phones / raise CPU on low-end devices. Mitigated by: the toggle (off-by-default on native mobile, per design), the preserved visibility/focus gates, the existing battery density reduction, and `prefers-reduced-motion` respect (added in design).
