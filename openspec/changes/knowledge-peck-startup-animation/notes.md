# Change notes — knowledge-peck-startup-animation

Implementation record: verification results, deviations, and pending manual
steps. Task numbers refer to tasks.md.

## Amendment (post-review): complete-metaphor playback on fast starts

**Problem observed by the user:** on a fast (dev/warm) start the app reaches
readiness ~45 ms into the choreography, so the original D4 acceleration
(warp past un-played pecks to consolidation) skipped the pecks entirely —
the branded metaphor never played.

**Amended policy** (design D4 rewritten, lifecycle spec requirement updated):

- `APP_READY` before idle now compresses the *remaining* choreography — every
  un-played beat, pecks included — at a single elevated `timeScale`
  (desktop ≈ 1.7×, phone ≈ 1.5×) inside a fast-play budget
  (`FAST_PLAY_BUDGET_MS` 900 desktop / 700 phone).
- Budgets amended: reveal start ≤ 900 ms after readiness (was 600), full
  unmount ≤ 1150 ms (was 900). Pointer-events still release at reveal start,
  so a ready app is interactive in < 1 s worst case.
- Idle → ready still resolves at 1× via a visually continuous virtual
  restart at converge.start (`startVirtualMs`).
- Tests updated: `acceleration.test.ts` (rewritten semantics: no skipping,
  monotonic mapping, new budgets), `StartupExperience.test.tsx` (budgets +
  a new assertion that fragment-1 visibly becomes a card — a peck landed —
  on an instant-ready launch).

## Feature location (task 12.3 — for the release changelog)

No README brand/startup section exists, so the location note lives here:

- Static pre-React frame: `index.html` (`#boot-frame` + `#kp-static-style`)
- Overlay: `src/components/startup/` (StartupExperience / StartupBird /
  KnowledgeFragments / knowledge-peck.css)
- Pure lifecycle: `src/lib/startupAnimation/` (machine, timeline, variants,
  store, types)
- Mount point: `src/main.tsx` (last child inside `HashRouter`, wrapped in a
  null-fallback `StartupExperienceBoundary`)
- Route-ready marker: `src/components/layout/MainLayout.tsx` mount effect
- Kill switch: Settings → Appearance → Startup (`interface.startupAnimationEnabled`),
  keys `settings.interface.startupAnimation*` in all six locales
- Android splash: `src-tauri/gen/android/app/src/main/res/values{,-night,-v31}/themes.xml`
  (hand-edit inventory updated in `docs/android-build-notes.md`)

## Gate results (task 12.1)

- `npm run test:run` — **3792 passed, 1 skipped** (145 of them in the new
  startup-animation suites: 70 pure-module + static-frame, 14 component,
  61 brandInventory incl. the new mascot/splash guards).
- `npm run test:scripts` — 109 pass, 0 fail.
- `npm run lint` — 0 errors / 0 warnings in every file touched by this
  change (the 5 repo errors are pre-existing in other files).
- `npx tsc --noEmit` — no new errors (the two errors in the untracked
  in-progress `ItemCategoryEditor` files predate this change).
- `npm run bench:check` — PASS; three new baselines recorded
  (`kp-timeline/build` 0.0103, `sample-sweep-desktop` 0.1521,
  `sample-sweep-phone` 0.0776). The `tabs-dom/mount-12-tab-workspace`
  stale-baseline WARN predates this change.
- `npm run test:visual` — 8/8 KP specs pass against committed baselines.

## Performance record (tasks 11.2–11.4)

- Baselines added to `scripts/perf-baselines.json` with reasons referencing
  this change (same-PR protocol).
- Bundle: entry chunk **2600 KB (prior recorded actual) → 2644 KB** with the
  statically imported overlay (+44 KB raw ≈ SVG + timeline + CSS), inside the
  unchanged 3,000,000-byte `entryChunkBytes` budget. `scripts/bundle-budgets.json`
  was NOT edited.
- Real-launch smoke (headless Chromium over the dev server, task 11.4):
  `mount-effect +4246ms → choreography +4247 → APP_READY +4291 → reveal
  +4694 → done +4945` (ready→reveal 403 ms ≤ 600; ready→gone 654 ms ≤ 900);
  `data-plethora-mounted` fired at +3980 ms — before the overlay's own mount
  effect — confirming the overlay renders *during* boot; overlay and
  `#boot-frame` fully removed afterwards. Idle-CPU/rAF-leak coverage is
  asserted by the component cleanup test (no pending timers/rAF after
  unmount).

## Deliberate deviations (task 12.2)

1. **Idle transition at end of consolidation, not wordmark end.** The D5
   timing table's `hold/idle` row sits at 1520 ms (after resolve), but the
   normative lifecycle spec ("slow startup settles into a stable idle state —
   mascot resting beside the completed knowledge structure … readiness later
   resolves into the mark") and design D5's own "Idle state visual" note both
   require the card trio + connectors to remain visible at idle with resolve
   playing only on readiness. Implemented `idleAt = consolidate.end`
   (desktop 1260 ms, phone 880 ms); the post-idleAt phases remain the
   canonical resolve/reveal timing table used by the acceleration plan.
2. **Static-frame phone media query is `max-width: 1023px`**, matching the
   presentation layer's mobile-shell boundary (phone + tablet get the phone
   script), not the raw 599px phone-only threshold. Pre-JS classification is
   approximate by nature; parity is pinned to the numbers, and the frame is
   replaced within one frame in any case.
3. **StartupSurface union gained `"startup"`** (`src/types/startup.ts`).
   Design D2 names `ensureStartup("startup")`; the surface label is a
   client-side dedupe key only — it never crosses into Rust args — so the
   union extension is safe and additive.

## Acceptance-criteria verification (task 12.2)

Every scenario in both spec deltas maps to a passing test:

| Spec scenario | Verification |
| --- | --- |
| Normal cold startup / readiness coordination | `StartupExperience.test.tsx` "normal cold startup"; store `appReady` conjunction tests |
| Ready early (budgets 600/900 ms, pointer release) | "adaptive budgets" test + `acceleration.test.ts` budget sweep |
| Ready before mount (epilogue only) | "ready before the choreography begins" + acceleration epilogue tests |
| Slow startup → stable idle, no loop, resolve once | "slow startup reaches idle…" + machine idle tests |
| Snapshot+fallback fail → aborted | "startup error aborts…" component test; machine APP_ERROR rows |
| Hang → watchdog at 15 s | "watchdog force-exits…" + `WATCHDOG_MS` pin |
| Once per runtime / no replay on navigation/resume | `claimLaunch` unit tests + "second mount" component test |
| Utility routes excluded | `shouldArmForRoute` cases + "utility routes never arm" |
| Kill switch: no branded layer, no added delay | "kill switch renders nothing…"; `resolveAnimationMode` precedence tests |
| Offline launch (static source check) | `staticFrame.test.ts` remote-URL scan of frame + components + lib |
| Pre-JS paint branded / geometry parity | static frame in `index.html` + `staticFrame.test.ts` KP_GEOMETRY parity |
| Metaphor beats, peck transforms target | `sampleTimeline` peck/snap/connector tests; visual baselines |
| Desktop timing 1200–1800 (1520) | `timeline.test.ts` canonical table assertions |
| Mobile 700–1200 (1080), 2/2 | phone script table tests + phone component test |
| Brand fidelity (hexes, no divergent palette) | `brandInventory.test.ts` Knowledge Peck guards (component + frame) |
| Reduced-motion variant | component "static variant and crossfades" + mode precedence tests |
| E-ink variant (3 stills, white, no fades) | component e-ink test + e-ink CSS overrides |
| Theme determinism / silence / compositor-only / flashing limit | `timeline.test.ts` transform/opacity-only + flashing sweep; CSS |
| Android splash = #0A0A0A | `brandInventory.test.ts` Android splash pins (v31 + base + night) |
| No leaked rAF / gates green | cleanup test; bench:check + check:bundle results above |
| Registry-driven choreography | `KP_VARIANTS` registry; timeline resolves phases from it |

## Pending manual steps

- **Task 9.3 (Android device smoke):** not run — no connected device in this
  session. Checklist: cold launch shows native dark splash (#0A0A0A) with the
  mascot icon → static frame → animation, no white flash or discontinuity.
  Everything automatable is pinned (theme contents test); the device run
  remains on the human launch checklist.
