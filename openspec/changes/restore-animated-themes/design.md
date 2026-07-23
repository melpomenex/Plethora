## Context

Incrementum has two independent animation systems, both currently suppressed for performance:

1. **Canvas backdrop engine** — `src/components/common/ThemeBackdrop.tsx`. A registry of ~40 self-contained renderers (`_ANIM`) driven by `requestAnimationFrame` at 30fps. Used by ~10 scenic themes (`rain`, `aurora`, `sunbeams`, `cherryblossom`, `cyberhighway`, `cosmicdust`, `bioglow`, `dandelions`, `rainywindow`, …). Selected via `theme.effects?.backgroundAnimation`. Mounted in `MainLayout.tsx` for all three toolbar layouts.
2. **CSS keyframe blobs** — inline `@keyframes liquid-blob-flow` in each Liquid Glass theme's `customCSS` (`src/themes/builtin.ts`). Used by `liquid-glass`, `amber-liquid-glass`, `rose-liquid-glass`. Not driven by the canvas engine (the `liquid-glow` value has no `_ANIM` entry; it's CSS-only).

Three separate de-animation mechanisms were introduced by the mobile heating sweep (commit `e4b8e092`):

- **Idle pause** (`ThemeBackdrop.tsx:1432-1435`, `IDLE_PAUSE_MS = 10_000`): after 10s of no `pointermove`/`pointerdown`/`keydown`/`scroll`/`touchstart`, `isIdle` flips true and the canvas effect bails out. Applies on **all** platforms, so desktop themes freeze while the user reads. This is the most visible "de-animation."
- **Native mobile skip** (`ThemeBackdrop.tsx:1358-1360`): `if (isNativeMobile()) return null;` unconditionally renders nothing on Android. No setting overrides it.
- **Vibrancy blob suppression** (`builtin.ts:3596-3603` + amber/rosé equivalents): when `apply_platform_vibrancy` succeeds on macOS/Windows, `data-vibrancy-active="true"` is set on `:root` and the Liquid Glass `customCSS` does `display: none !important` on the animated `::before`/`::after` blobs. On Linux/web vibrancy fails, so blobs animate.

A prior change (`openspec/changes/fix-animated-themes`, committed in `dd317bff`) fixed a **different** problem: the blobs were invisible because opaque layout wrappers (`.app-shell`, `.bg-cream`) covered them. That fix made the layout transparent so blobs *can* show — but the three mechanisms above still suppress them on macOS/Windows and freeze the canvas on idle.

There is also a **dead setting**: `animationsEnabled: boolean` is declared in `InterfaceSettings` (`settingsStore.ts:251`) and defaulted to `true` (`settingsStore.ts:535`), but no code reads it. The Settings → "Animated Backdrop" section (`SettingsPage.tsx:944`) only exposes `animationFrequency` (density) and `animationBrightness`.

Constraints:
- The mobile heating was real (RenderThread ~57%, sustained). We can't just delete the gates; we need the toggle to carry the performance escape hatch on mobile.
- Existing density/brightness controls and the battery density reduction (`effectiveDensity = onBattery ? density * 0.5 : density`) must be preserved.
- `prefers-reduced-motion` is currently not respected anywhere — adding it is cheap insurance.

## Goals / Non-Goals

**Goals:**
- Animated built-in themes render continuously while the app is foregrounded on desktop, by default.
- Users can fully disable theme animations via a setting (the real performance escape hatch), replacing the blunt idle-pause proxy.
- Native mobile users can opt into animated themes (no longer hardcoded off).
- Liquid Glass blob animations show on macOS/Windows, not only Linux/web.
- Respect `prefers-reduced-motion` automatically.
- No new dependencies; no backend/Rust API changes required.

**Non-Goals:**
- Adding new animated themes or new canvas renderers (e.g., a real `liquid-glow` canvas renderer). We restore the existing ones only.
- Reworking the canvas engine architecture, the `_ANIM` registry, or the 30fps throttle.
- Changing native vibrancy behavior itself (it stays as an orthogonal translucency layer; we only stop letting it *hide* the CSS blobs).
- Touching the legacy `ThemeSystem.tsx` parallel theme system.
- Removing the visibility/focus gates (tab hidden / window unfocused) — those remain, since animation is genuinely pointless when the app isn't visible.

## Decisions

### Decision 1: Replace the idle pause with an `animationsEnabled` toggle (default on, desktop)

**Choice:** Remove the `isIdle` gate from the canvas effect's run condition (`ThemeBackdrop.tsx:1432-1435` and the `IDLE_PAUSE_MS` activity tracker) and instead gate the whole component on `settings.interface.animationsEnabled`.

**Rationale:** The idle pause was a proxy for "don't burn CPU when the user doesn't care." A named toggle expresses user intent more directly and doesn't freeze the background 10s into reading — which is precisely when a calming animated theme is most valuable. The toggle already exists in the store; we just wire it.

**Alternatives considered:**
- *Keep idle pause but raise the timeout (e.g. 60s/∞).* Rejected — still freezes mid-read; doesn't help mobile (which skips entirely) and leaves the "why is my theme static?" mystery intact.
- *Make idle pause a separate toggle from the master switch.* Rejected as scope creep; one master toggle is enough. (Open to revisiting — see Open Questions.)

### Decision 2: Native mobile default off, toggleable

**Choice:** Replace `if (isNativeMobile()) return null;` with `if (isNativeMobile() && !animationsEnabled) return null;` — i.e. on Android, animations are off by default (preserving current perf/battery behavior) but the user can enable them from settings. `animationsEnabled` default stays `true` in the store; the *effective* mobile default comes from combining `isNativeMobile()` (true on Android) with the store default — so we instead compute a derived `animationsActive` that is `animationsEnabled && !(isNativeMobile() && !userExplicitlyEnabled)`.

Simpler implementation: keep store default `true`, but on first run on native mobile, set the persisted default to `false`. This avoids re-deriving every render and keeps the toggle authoritative. See tasks for the exact wiring (persist a one-time mobile default).

**Rationale:** Honors the original perf finding (sustained GPU on phones heats them) while removing the hardcoded kill switch the user is asking us to remove. Users who want the eye candy can opt in.

**Alternatives considered:**
- *Animations on by default on mobile too.* Rejected — reintroduces the heating regression out of the box.
- *Per-theme animation enablement.* Rejected as scope creep; one global toggle is what the store already models.

### Decision 3: Restore Liquid Glass blobs on macOS/Windows; keep vibrancy as a separate layer

**Choice:** Remove the `[data-vibrancy-active="true"]` blob-suppression CSS blocks from the three Liquid Glass themes (`builtin.ts:3596-3603`, and the amber/rosé equivalents ~3862-3869 / ~4128-4135). Native vibrancy continues to apply (it just provides window translucency behind everything); the animated blobs render on top of/within that as they already do on Linux.

**Rationale:** The blobs are the defining feature of these "premium" themes. Hiding them on the platforms where native translucency *also* works makes the theme look static exactly where most users are. The two effects compose (translucent window + animated gradient blobs), they don't conflict.

**Alternatives considered:**
- *Add a per-theme `preferVibrancyOverBlobs` flag.* Rejected for now — adds model surface for marginal benefit. Can revisit if any theme looks bad with both. (Open Question.)
- *Disable vibrancy entirely for Liquid Glass themes.* Rejected — vibrancy is a nice complement; we only stop *suppressing* the CSS animation.

### Decision 4: Respect `prefers-reduced-motion`

**Choice:** Treat the canvas animation as disabled when `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, in addition to the `animationsEnabled` toggle. The CSS blob animations already honor `@media (prefers-reduced-motion: reduce)` via an added rule in each Liquid Glass theme's `customCSS`.

**Rationale:** Free accessibility win, near-zero cost, and aligns the "should this animate?" decision with OS-level user intent.

### Decision 5: Settings UI placement

**Choice:** Add an "Enable animated themes" toggle (Switch) at the top of the existing Settings → "Animated Backdrop" section (`SettingsPage.tsx:944`), above particle density and brightness. When disabled, grey out / disable the density and brightness rows (they have no effect when animations are off).

**Rationale:** Co-locates all animation controls; the existing section header and description already fit. Disabling dependent rows signals state clearly.

## Risks / Trade-offs

- **[Mobile heating regression if users enable it]** → Mitigated by off-by-default on native mobile (Decision 2) and preserved battery density reduction. Document the trade-off in the setting's description text.
- **[Increased desktop CPU/GPU on low-end machines]** → Mitigated by the master toggle (default on, but trivially off) and `prefers-reduced-motion` (Decision 4). The 30fps cap and existing density/brightness controls remain.
- **[Visual clash: vibrancy + blobs on macOS/Windows]** → Acceptable per Decision 3; if a theme looks bad with both, follow up with a per-theme flag (Open Question). Low risk since the blobs are already designed to render behind translucent content.
- **[Dead-setting migration]** → `animationsEnabled` already defaults `true` everywhere, so existing desktop users see no regression. Only risk is mobile users who previously had it "implicitly off" — handled by the one-time mobile-default-false (Decision 2).
- **[Removing idle pause reintroduces background CPU while reading]** → This is the explicit goal ("animated themes back"). The master toggle and reduced-motion respect give users the controls the idle gate was standing in for.

## Migration Plan

1. Wire `animationsEnabled` into `ThemeBackdrop` (gate) and `SettingsPage` (toggle) — no store schema change (field already exists, default `true`).
2. Remove the `isIdle`/`IDLE_PAUSE_MS` activity tracker from `ThemeBackdrop`.
3. Add the one-time native-mobile persisted default (`false`) so existing+new mobile installs keep current behavior unless opted in.
4. Remove the vibrancy blob-suppression CSS from the three Liquid Glass themes.
5. Add `prefers-reduced-motion` guards (JS matchMedia gate in `ThemeBackdrop`; `@media` rule in each Liquid Glass `customCSS`).
6. Build & smoke-test on desktop (Linux/web) and Android.

**Rollback:** All changes are frontend-only and individually reversible. Reverting the `ThemeBackdrop` gate restores the idle pause behavior (the toggle then behaves as always-on when true). Re-adding the CSS suppression restores macOS/Windows blob hiding. No data migration to undo.

## Open Questions

- Should the idle pause be offered as a *separate* "Pause when idle" toggle (battery-saver mode) rather than removed outright? Default in design: remove it. If the user wants finer control we can add it back as an opt-in.
- Should individual Liquid Glass themes get a `preferVibrancyOverBlobs` hint, or is "both" always fine? Default in design: always both.
