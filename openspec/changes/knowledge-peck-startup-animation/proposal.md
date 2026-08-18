# Knowledge Peck — Branded Startup Animation

## Why

Plethora's first impression is a generic spinner: the webview paints an empty `#root`, then `PageLoader` (`src/main.tsx:158`) — a dark full-screen circle spinner — covers boot while the Rust backend opens the database, runs migrations, and hydrates stores. The product already has a mascot ("Friendly Chirp", the purple P-bird of `assets/brand/plethora-icon-master.svg`, animated in-app by `CompanionBird.tsx`) that carries the brand personality, yet the startup moment — the one experience every user has on every launch — communicates nothing about what Plethora does.

Knowledge Peck replaces the generic boot surface with a ~1.5 s mascot choreography that mimes Plethora's core promise — **information → selection → connection → memory** — the bird notices floating knowledge fragments, pecks the important ones into cards, the cards connect into structure, and the structure resolves into the brand mark as the real UI is revealed underneath. It must be readiness-driven (never a fixed blocking delay), restrained enough to keep Plethora feeling like a serious learning tool, and free on slow/fast/error startups.

## What Changes

- **Static pre-React first frame** in `index.html`: an inline-SVG mascot on the same fixed dark surface the current `PageLoader` uses, so the webview paints a branded frame before any JS executes. This replaces "empty root + spinner" as the earliest painted content.
- **New `StartupExperience` overlay** (new `src/components/startup/`), statically imported and mounted in `src/main.tsx` beside the existing hosts: plays the Knowledge Peck choreography above the lazy-loading app, then crossfades to reveal the already-rendered UI. The top-level Suspense fallback stops being the primary branded surface.
- **Readiness-driven lifecycle** (new `src/lib/startupAnimation/`): an explicit state machine (`handoff → choreography → idle-await → resolve → reveal → done`, plus `exit-fast`/`aborted`) coordinated with real readiness — `useStartupStore.ensureStartup("startup")` reaching `ready` plus the main route having painted. Fast startups compress the remaining beats (time-scale, capped); slow startups settle into a stable idle pose (no re-pecking loop); startup errors exit the overlay to the existing error UI; a watchdog guarantees the overlay can never conceal a hang.
- **Platform choreographies**: desktop canonical sequence (3 fragments, glance, 3 pecks, connect, consolidate; ~1.2–1.8 s design range, 1500 ms default) and a deliberately simpler mobile composition (2 fragments, 2 pecks; ~700–1200 ms, 950 ms default) — selected via the existing form-factor/presentation utilities, not by shrinking the desktop scene.
- **Reduced-motion & e-ink variants**: `prefers-reduced-motion` (via the existing presentation context) gets a static mark + single crossfade; true e-ink mode (`useIsEink()`) gets 3 crisp stepped stills with no fades or continuous repaints.
- **Replay policy**: plays exactly once per webview/JS runtime (genuine app start or reload), only for the main window route — never for `#/screenshot-overlay` / `#/auth/callback`, internal tab navigation, or mobile resume without an actual runtime restart.
- **Mascot & brand reuse**: a new articulable inline SVG (`StartupBird`) redrawn from the canonical master with identical brand hexes (#8B5CF6/#7C3AED/#5B21B6 gradient, amber beak) — head/beak/eye groups pivoting for the peck. No mascot redesign, no new animation dependency (rAF + transforms/opacity + existing CSS-keyframe idioms), no sound, fully offline.
- **Android splash continuity**: tint the Android 12+ splash background (and pre-31 window background) to match the boot surface so native splash → static frame → animation read as one continuous dark branded launch. iOS needs no repo change until its scaffold is checked out.
- **Settings kill switch**: `interface.startupAnimationEnabled` (default on, all platforms) with i18n labels in all six locales.
- **Gates & tests**: unit tests for timeline math and lifecycle (fast/slow/error/replay), component tests per stage/platform/variant, a Playwright visual spec over frozen deterministic stages, a micro-benchmark + `scripts/perf-baselines.json` baseline, and bundle-budget verification. No new npm/Rust dependencies.

## Capabilities

### New Capabilities

- `startup-animation-lifecycle`: readiness coordination (backend/store/route-paint signals), adaptive timing (accelerate/hold), replay policy (once per runtime, main route only, no replay on resume/navigation), error and watchdog exits, and the "never delay a ready app" contract.
- `startup-animation-presentation`: the Knowledge Peck choreography itself — phase structure and metaphor beats, desktop vs mobile compositions, static pre-React frame and native splash continuity, brand-asset reuse, reduced-motion/e-ink/theme behavior, performance constraints, and the future variant registry.

### Modified Capabilities

- None. (Existing specs are untouched; `PageLoader` remains as a non-branded fallback for utility routes and Suspense boundaries inside the app.)

## Impact

- **Frontend**: `index.html` (static frame), `src/main.tsx` (mount overlay, Suspense fallback role), new `src/components/startup/*` + `src/lib/startupAnimation/*` + one small store, `src/components/layout/MainLayout.tsx` (route-painted marker), `src/stores/settingsStore.ts` + `src/components/settings/SettingsPage.tsx` (kill switch), `src/lib/i18n/locales/*.ts` ×6, `src/index.css` or a component-local stylesheet (keyframes), `src/__tests__/brandInventory.test.ts` (guard the new SVG's brand colors).
- **Android**: `src-tauri/gen/android/app/src/main/res/values*/themes.xml` splash tint only (hand-edit inventory in `docs/android-build-notes.md` must be updated). No Rust code changes, no new crates, no new npm packages.
- **Performance**: overlay is statically imported into the entry chunk (must render before lazy routes resolve) — size verified against `scripts/bundle-budgets.json`; rAF runs only while choreography is active; idle state uses a cheap CSS keyframe; new baseline entry in `scripts/perf-baselines.json`.
- **Not affected**: companion feature (shares brand idioms, no code coupling), database/sync/Rust startup order, existing loading components used elsewhere in the app.
