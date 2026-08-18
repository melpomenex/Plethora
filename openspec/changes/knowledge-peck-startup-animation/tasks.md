# Tasks — Knowledge Peck Startup Animation

Reference `specs/startup-animation-lifecycle/spec.md` and `specs/startup-animation-presentation/spec.md` for normative behavior; `design.md` for the how (decisions D1–D14, timing tables, state machine).

## 1. Confirm integration points (read-only grounding)

- [x] 1.1 Re-verify the exact current shape of the boot path before editing: `index.html` (`#root`, `#error-display`, SW-unregister IIFE), `src/main.tsx` (`PageLoader` at ~158, provider tree/`HashRouter` at ~369–407, `data-plethora-mounted` at ~411), `src/stores/startupStore.ts` (`ensureStartup` signature/status union), `src/components/layout/MainLayout.tsx` mount effect (~208–255), `src/contexts/PresentationContext.tsx` (`reducedMotion`, `isEinkMode`), and `src/lib/displayMode.ts` — adjust line references in later tasks if the working tree has drifted.
- [x] 1.2 Confirm how `interface.*` settings are added end-to-end by reading the existing `animationsEnabled` and `interface.companion` additions in `src/stores/settingsStore.ts` (schema ~296, defaults ~689, persist merge/migration ~1040–1230) and their `SettingsPage.tsx` + locale key wiring; replicate that pattern in group 7.

## 2. Pure lifecycle modules (`src/lib/startupAnimation/`)

- [x] 2.1 Create `src/lib/startupAnimation/types.ts`: `KPVariantId`, `FormFactor` (reuse presentation form factor), `Phase`, `PhaseScript`, `Timeline`, `KP_GEOMETRY` constants (mascot px size desktop/phone, container max width 480, boot surface `#0A0A0A`, e-ink surface `#fff`), and stage/event unions (`Stage`, `KPEvent`) with the transition table from design D3 encoded in `machine.ts` (not types).
- [x] 2.2 Implement `src/lib/startupAnimation/machine.ts`: pure `transition(stage, event) -> stage` covering `MOUNTED/APP_READY/APP_ERROR/WATCHDOG/SETTINGS_OFF/FORCE_EXIT` per the D3 table; export `WATCHDOG_MS = 15_000`, terminal stages, and stage→animation-mode mapping (`full | reduced-motion | eink | none`). No timers, no DOM.
- [x] 2.3 Implement `src/lib/startupAnimation/variants.ts`: `KP_VARIANTS` registry with the single `knowledge-peck` entry holding desktop (3 fragments/3 pecks) and phone (2 fragments/2 pecks) phase scripts matching the D5 tables exactly (phase names, ms offsets).
- [x] 2.4 Implement `src/lib/startupAnimation/timeline.ts`: pure `buildTimeline(variant, formFactor)`, `sampleTimeline(timeline, t) -> ElementState[]` (per-element `transform`/`opacity` only), and `accelerationPlan(elapsedAtReady, timeline)` implementing D4 (finish current beat ≤ 180 ms, warp to consolidation, consolidation+resolve compressed ≤ 350 ms; idle-ready path plays resolve at 1×). Export budget constants (`REVEAL_START_BUDGET_MS = 600`, `UNMOUNT_BUDGET_MS = 900`).
- [x] 2.5 Implement `src/lib/startupAnimation/store.ts`: zustand store (companion-store pattern) holding `stage`, `mode`, `dataReady`, `routePainted`, derived `appReady`, actions (`markDataReady/Error`, `markRoutePainted`, `setStage`, `forceExit`), plus the module-level once-per-runtime guard (`claimLaunch()` returns `false` on second call) and `shouldArmForRoute(hash)` skipping `#/screenshot-overlay` and `#/auth/callback`.

## 3. Unit tests for pure modules

- [x] 3.1 `src/lib/startupAnimation/__tests__/machine.test.ts`: every transition row of D3 (normal, early-ready, idle→ready, error, watchdog, kill switch, terminal idempotence).
- [x] 3.2 `__tests__/timeline.test.ts`: desktop timeline branded span lands in 1200–1800 ms (wordmark at 1520); phone span 700–1200 ms (1080); phases strictly ordered; `sampleTimeline` returns transform/opacity only and is stable (same input → same output); flashing limit — no element's opacity oscillates more than 3 times per second across sampled frames.
- [x] 3.3 `__tests__/acceleration.test.ts`: ready-at-200 ms / mid-peck / at-idle / before-mount all produce plans within the 600/900 ms budgets and never negative or backwards clocks.
- [x] 3.4 `__tests__/store.test.ts`: once-per-runtime guard (second `claimLaunch` false), route gating hash cases, `appReady` conjunction semantics, force-exit.

## 4. Visual assets

- [x] 4.1 Create `src/components/startup/StartupBird.tsx`: inline SVG redrawn from `assets/brand/plethora-icon-master.svg` proportions with part groups (`kp-bird-head` wrapping beak+eye as the pivoting subgroup, body, wing, tuft, feet), brand hexes `#8B5CF6/#7C3AED/#5B21B6`, beak `#F59E0B`, pupil `#1E1B4B`; `aria-hidden`, decorative role; sized from `KP_GEOMETRY`. No changes to `CompanionBird.tsx`, the master SVG, or icon pipeline.
- [x] 4.2 Create `src/components/startup/KnowledgeFragments.tsx`: abstract language-neutral token cards (two rounded text-bars + dot, dark-glass card, purple accent edge) and connector line elements, positioned from `KP_GEOMETRY`/phase state; no text words.
- [x] 4.3 Create `src/components/startup/knowledge-peck.css`: keyframes for `kp-breathe` (3 s, scale 1↔1.02) and `kp-blink` (~4 s cadence), reduced-motion and e-ink overrides (`[data-display-mode="eink"]` no transitions), reveal crossfade class; imported by the component (PDFViewer.css precedent).
- [x] 4.4 Extend `src/__tests__/brandInventory.test.ts`: assert `StartupBird.tsx` (and the `index.html` static frame copy) contain the canonical gradient hexes and beak color; assert neither file introduces a divergent mascot palette.

## 5. Static pre-React frame (`index.html`)

- [x] 5.1 Add the static frame inside `#root`: `#boot-frame` div with the mascot rest-pose SVG (rest-pose copy of `StartupBird`) centered on `#0A0A0A`, inline `<style>` using the same `KP_GEOMETRY` values with a phone media query; must not interfere with the SW-unregister IIFE, `#error-display`, or the early error handlers.
- [x] 5.2 Add a parity unit test (`src/lib/startupAnimation/__tests__/staticFrame.test.ts` or extend brandInventory) reading `index.html` and asserting its geometry values match the exported `KP_GEOMETRY` constants and that it contains no `http(s)://` external references (offline guarantee for the frame).

## 6. Overlay component and mount

- [x] 6.1 Create `src/components/startup/StartupExperience.tsx`: fixed `inset-0` overlay, `z-index: 9000` (below `#error-display` 99999), container `pointer-events: none` with an active-stage shield; renders `StartupBird` + `KnowledgeFragments` + wordmark ("Plethora", `var(--font-family)`); sets `data-kp-stage` on the root for tests/visual hooks.
- [x] 6.2 Implement the driver in the component: one rAF loop while `stage ∈ {choreography, resolve, reveal}` sampling `sampleTimeline` with an injectable clock (test seam `__kpTestClock`), inline transform/opacity writes, `transform-box: fill-box` origins on SVG groups; cancel the loop on every exit path (idle, abort, done, unmount).
- [x] 6.3 Wire lifecycle in `useEffect`: `claimLaunch()`/`shouldArmForRoute(window.location.hash)` arming, `ensureStartup("startup")` kickoff + status subscription (`ready`→`markDataReady`, `error`→`APP_ERROR`), watchdog timer, kill-switch check, acceleration on `APP_READY`, reveal-start releases pointer events, unmount cleanup (rAF + timers + store reset).
- [x] 6.4 Mount `<StartupExperience />` in `src/main.tsx` inside `HashRouter` as the last child (after global hosts), statically imported, wrapped in a small local error boundary whose fallback is `null`; leave the existing Suspense `PageLoader` fallback in place for utility routes.
- [x] 6.5 Add the route-painted marker: in `MainLayout.tsx`'s mount effect (initTabs area), after first paint via `requestAnimationFrame`, call `useStartupExperienceStore.getState().markRoutePainted()` — only MainLayout (catch-all) triggers it.

## 7. Settings, i18n, and variant gating

- [x] 7.1 Add `startupAnimationEnabled: boolean` (default `true`) to `settingsStore` interface settings following the `animationsEnabled` pattern (schema field, default, persist merge so absent-flag merges to `true`; bump persist version only if the existing pattern requires it). Do NOT gate on `animationsEnabled` (rationale: design D8).
- [x] 7.2 Add the settings row in `SettingsPage.tsx` (Interface/Appearance area beside companion rows) with label/help text from new `settings.interface.startupAnimation*` keys added to all six locales in `src/lib/i18n/locales/` (en, de, es, fr, ja, zh).
- [x] 7.3 Implement gating precedence in `StartupExperience` (D8): kill switch → none; `isEinkMode` → 3-step white stills via plain timeouts (~450 ms/step, no fades); `reducedMotion` → static mark + single card opacity step + ≤ 250 ms crossfade on ready; else full choreography. E-ink must reuse the existing mode detection, not re-detect.

## 8. Lifecycle integration tests

- [x] 8.1 Component tests `src/components/startup/__tests__/StartupExperience.test.tsx` using fake timers (`requestAnimationFrame` faked) and the established `vi.hoisted`/module-mock patterns for `ensureStartup` and presentation context: stage progression via `data-kp-stage`; desktop vs phone script selection; reduced-motion and e-ink variants; kill switch bypass; error path unmounts to reveal error UI; watchdog fires.
- [x] 8.2 Adaptive-budget tests: fake-clock scenarios asserting pointer-events released ≤ 600 ms after `appReady` and overlay unmounted ≤ 900 ms (fast path); slow path reaches `idle`, does not restart on further ticks, and resolves once ready; ready-before-mount plays only the epilogue.
- [x] 8.3 Replay/lifecycle tests: second mount in the same module context does not arm (once-per-runtime); `#/screenshot-overlay` and `#/auth/callback` hashes never arm; unmount leaves no pending rAF/timers (spy on cancellation).
- [x] 8.4 Offline test: static-source check that the startup component modules reference no remote URLs (extend 5.2's checker to cover `src/components/startup/*`).

## 9. Android native splash continuity

- [x] 9.1 Add `src-tauri/gen/android/app/src/main/res/values-v31/themes.xml` with `android:windowSplashScreenBackground` = `#0A0A0A` (icon remains the launcher mascot); add solid `#0A0A0A` `android:windowBackground` to the base and night `Theme.plethora_tauri` for API 24–30 continuity.
- [x] 9.2 Update `docs/android-build-notes.md` hand-edit inventory with the new res files (so a `tauri android init` re-run re-applies them), and add a unit test (node:test or vitest, file-content assertion) pinning the splash color to `#0A0A0A`.
- [ ] 9.3 Manual smoke via the android-build skill on a connected device: cold launch shows native dark splash w/ mascot → static frame → animation with no white flash or discontinuity; record result in the change notes.

## 10. Visual regression coverage

- [x] 10.1 Add the DEV-only freeze hook to `StartupExperience`: `?kp-stage=<handoff|fragments|notice|peck-1|peck-2|peck-3|consolidate|resolve|idle>&kp-freeze=1` (guarded by `import.meta.env.DEV`) pins the machine/scene to a deterministic stage.
- [x] 10.2 Create `src/visual/knowledgePeck.visual.spec.ts` following the existing harness conventions: screenshots of {fragments, connected (peck-2/3), resolve/idle} × {1280×800, 390×844}, a reduced-motion frame (`page.emulateMedia({ reducedMotion: "reduce" })`), and an e-ink still (seed `plethora-display-mode` localStorage); commit Playwright baselines.

## 11. Performance gates

- [x] 11.1 Add `src/lib/startupAnimation/timeline.bench.ts`: bench `buildTimeline` + a full canonical-desktop `sampleTimeline` sweep with deterministic inputs, folding results into a module-level sink, returning `void` (no PRNG/clock/network needed).
- [x] 11.2 Run `npm run bench` and paste the printed baseline JSON line into `scripts/perf-baselines.json` (with a `reason` referencing this change), per the AGENTS.md same-PR protocol.
- [x] 11.3 Run `npm run check:bundle` and confirm the entry chunk stays within `scripts/bundle-budgets.json` without edits; record before/after entry sizes in the change notes. If a budget must change, update `scripts/bundle-budgets.json` with justification in the same PR.
- [x] 11.4 Manual smoke on desktop dev cold runs: compare `data-plethora-mounted` timing before/after (expect no measurable regression; overlay renders during boot), verify idle CPU with the overlay gone (no rAF leak), and verify light-theme reveal crossfade.

## 12. Final validation and documentation

- [x] 12.1 Full local gates: `npm run test:run` (all new suites green, no regressions), `npm run test:scripts`, `npm run lint`, `npx tsc --noEmit`, `npm run bench:check`, `npm run test:visual` (baselines stable).
- [x] 12.2 Verify acceptance criteria 1–20 from the change request against the implementation (spec scenarios map 1:1); note any deliberate deviation with rationale in the change notes.
- [x] 12.3 Update `docs/android-build-notes.md` (done in 9.2) and add a short launch-experience note to the README brand/startup section if one exists; otherwise note the feature location in the change notes for the release changelog.
