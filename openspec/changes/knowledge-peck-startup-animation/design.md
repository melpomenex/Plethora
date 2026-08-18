# Design — Knowledge Peck Startup Animation

## Context

Plethora's launch path today (verified against the repo):

- `index.html` paints an **empty `#root`** (line 58); the earliest React paint is the top-level `Suspense` fallback `PageLoader` (`src/main.tsx:158–172`) — a hardcoded `#0a0a0a` full-screen spinner. Per-tab loads use `TabLoader` (`src/components/common/Tabs/TabContent.tsx:75`).
- Readiness is already explicitly modeled:
  - Rust: `BackendReadyState` with `wait_for_backend_ready` (`src-tauri/src/lib.rs:96–117, 363–367`), `mark_ready()` at the end of `.setup()` (lib.rs:1449) — after DB open/recover, migrations, and state management.
  - TS bridge: `awaitBackendReadyWithRetry` (`src/lib/tauri.ts:52–72`, 5 attempts for ~30 s Android JavaBridge stalls) gates every `invoke`.
  - Data: `useStartupStore.ensureStartup(surface)` (`src/stores/startupStore.ts:60–151`) fetches `get_startup_snapshot`, hydrates collection/document/queue stores, and settles `status: "idle" | "loading" | "ready" | "error"` (8 s snapshot timeout, legacy fallback before error).
  - Routes: HashRouter with `/auth/callback`, `/screenshot-overlay`, and catch-all `MainLayout` (`src/main.tsx:379–385`). Internal navigation is tab-based SPA state (`useTabsStore`) — no document reloads. `data-plethora-mounted` is set on `#root` after mount (main.tsx:411–413).
- The mascot is **"Friendly Chirp"**, the purple P-shaped bird canonically defined by `assets/brand/plethora-icon-master.svg` (gradient `#8B5CF6 → #7C3AED → #5B21B6`). The in-app animated variant is the hand-drawn inline SVG `CompanionBird.tsx` (separate `companion-head/-beak/-eye/-wing/-body/-feet` groups) animated purely with CSS keyframes in `src/index.css:2427–2703` driven by a `data-companion-state` attribute, plus rAF only during flights (`CompanionHost.tsx:191–272`). Brand assets are guarded by `src/__tests__/brandInventory.test.ts`.
- Presentation/a11y infrastructure exists: `PresentationContext` exposes `reducedMotion` (OS `prefers-reduced-motion`, live-updated) and `isEinkMode`; e-ink mode (`src/lib/displayMode.ts`, `data-display-mode="eink"`) globally kills animation/transitions and **forces `reducedMotion = true`**; `interface.animationsEnabled` (settingsStore:296, default `true`) is **forced `false` on fresh native-mobile installs** (settingsStore:1208–1223) and gates ambient/decorative animation (the companion treats `!animationsEnabled` as reduced motion).
- Android (`src-tauri/gen/android`) is a stock Tauri v2 scaffold: **no splash setup of any kind** — Android 12+ shows the default launcher-icon-on-windowBackground splash; `themes.xml`/`values-night/themes.xml` define only `Theme.plethora_tauri` (DayNight NoActionBar, transparent system bars). No iOS scaffold is checked out.
- No JS animation library exists (no framer-motion/gsap/lottie); the codebase idiom is CSS keyframes + short-lived rAF with transforms, with a documented "no persistent rAF loop" discipline. Hand-offs like `runAfterFirstPaint` exist in main.tsx:266.
- Gates: `bench:check` (perf baselines + bundle budgets, `scripts/perf-baselines.json` / `scripts/bundle-budgets.json`), vitest + Testing Library with established Tauri-mocking patterns (`src/test/setup.ts`, `src/test/utils.tsx`), Playwright visual harness (`src/visual/`, deterministic fixture + `toHaveScreenshot`, `maxDiffPixelRatio: 0.02`).

## Goals / Non-Goals

**Goals:**

- A branded, readiness-driven startup animation ("Knowledge Peck") that mimes **information → selection → connection → memory** and resolves into the Plethora mark as the real UI is revealed.
- Never delays a ready app (adaptive acceleration; pointer-events released at reveal start), never freezes awkwardly on slow startup (stable idle), never conceals errors (error exits + watchdog).
- Distinct desktop (~1.5 s branded span) and mobile (~1.0 s) compositions; reduced-motion and e-ink variants; theme-independent deterministic boot surface; full offline operation.
- Reuses the canonical mascot and brand hexes; zero new runtime dependencies; passes existing perf/bundle/test gates.

**Non-Goals:**

- No mascot redesign, no changes to icon pipelines, `CompanionBird`, or the companion feature.
- No general-purpose animation engine; no variant system beyond a registry seam (Highlight/Flashcard/Connection/Card-Stack variants are future work).
- No sound; no network resources; no changes to Rust startup order, DB, or sync.
- No replacement of in-app loading states (`TabLoader`, skeletons) — utility routes keep the existing `PageLoader`.
- No replay on internal navigation, mobile resume, window focus, or account/tab switches.

## Decisions

### D1 — Three-layer launch surface (static frame → overlay → app)

**Decision:** The branded launch is built from three layers with hand-offs designed for visual continuity:

1. **Static pre-React frame** — markup inside `<div id="root">` in `index.html`: the mascot SVG (inline copy of `StartupBird`'s static pose, no articulation) centered on `#0A0A0A`, sized by a small inline `<style>` with a phone media query. Paints as soon as HTML+CSS parse, before any JS. `createRoot(...).render()` wipes it on mount.
2. **`StartupExperience` React overlay** — statically imported in `src/main.tsx`, mounted inside `HashRouter` as a sibling after `Routes` (inside `ThemeContext`/`PresentationContext`/root `ErrorBoundary`). Its first painted frame matches the static frame (same mascot size/position/colors), so the takeover is invisible. Fixed `inset-0`, `z-index: 9000` (above app, below the pre-React `#error-display` at 99999), full-screen **`pointer-events: none`** on the container with a `pointer-events: auto` transparent shield only while the choreography is active (released at reveal start).
3. **The app itself**, already rendering beneath the overlay while chunks load and stores hydrate; revealed by a 250 ms overlay fade.

**Alternatives:** React-only animation (rejected: the empty-`#root` gap between webview paint and React mount would flash whatever the platform paints — exactly what the static frame fixes); pure static splash + fade (rejected: no choreography, fails the core concept); separate Tauri splash window (rejected: window-state/localhost-server interactions, mobile doesn't support it, and the webview already paints early enough).

**Why `#0A0A0A` fixed, not `var(--background)`:** the static frame and Android native splash render **before** the persisted theme is known; today's `PageLoader` already hardcodes `#0a0a0a`, so this preserves current behavior, guarantees the native→static→overlay chain matches, and avoids a wrong-theme flash across the ~40 themes. The reveal crossfade handles the transition into the themed app (same as today). E-ink switches its layers to white (`#fff`) as soon as JS can detect it (D9).

### D2 — Readiness contract: what "app ready" means

**Decision:** The overlay's `appReady` is the conjunction of two observable flags, stored in a new `src/lib/startupAnimation/store.ts` (zustand, companion-store pattern):

- **`dataReady`** — the overlay itself calls `ensureStartup("startup")` once on mount (surface label joins the existing dedupe/inflight map; tabs calling `ensureStartup("dashboard"|"queue"|…)` share the same snapshot). `dataReady := startupStatus === "ready"` (which transitively implies backend-ready, since the snapshot `invoke` is gated by `awaitBackendReadyWithRetry`). `startupStatus === "error"` raises the error exit (D10).
- **`routePainted`** — `MainLayout` (the catch-all route; it never renders for `/auth/callback` or `/screenshot-overlay`) sets it in its existing mount effect (`MainLayout.tsx:208–255` area) inside a `requestAnimationFrame` after tab initialization, i.e., after the real UI has painted at least one frame.

`appReady := dataReady && routePainted`. Nothing else is waited on: noncritical work already defers via `runAfterFirstPaint` (main.tsx:266–367), and the brief forbids waiting on network.

**Alternatives:** wait only for `wait_for_backend_ready` (rejected: UI code may still be chunk-loading; the reveal would show `PageLoader` — a visual disconnect); wait for full first-tab data of the default view (rejected: the startup snapshot already hydrates the queue/document stores that the default views read; adding per-view waits lengthens the splash for no visible benefit).

### D3 — Explicit state machine; no wall-clock `setTimeout` choreography

**Decision:** A pure module `src/lib/startupAnimation/machine.ts` defines:

```
Stage := handoff | choreography | idle | resolve | reveal | done | aborted
Event := MOUNTED | APP_READY | APP_ERROR | WATCHDOG | SETTINGS_OFF | FORCE_EXIT
```

Transitions (normative):

| From | Event | To | Notes |
|---|---|---|---|
| — | MOUNTED | handoff | overlay paints static-parity frame |
| handoff | (first rAF) | choreography | unless reduced-motion/e-ink/kill-switch variants chosen (D8) |
| choreography | APP_READY | resolve *via acceleration plan* | beat-finish + warp to consolidation (D4) |
| choreography | timeline exhausted, no APP_READY | idle | stable waiting pose; rAF stops |
| idle | APP_READY | resolve | immediate |
| resolve | timeline end | reveal | pointer-events released at reveal **start** |
| reveal | timeline end (250 ms) | done | overlay unmounts |
| any | APP_ERROR / WATCHDOG (15 s) / FORCE_EXIT | aborted | 150 ms fade, unmount |
| handoff | SETTINGS_OFF | aborted | kill switch: overlay hides immediately; reveal waits only for `appReady` via a bare 150 ms fade (never blocks) |

A watchdog (`WATCHDOG_MS = 15_000` from mount) is the hard backstop: the overlay can never outlive 15 s regardless of store states. All timing flows through an injected clock (`now: () => number`), making the machine deterministically testable; the component owns exactly one rAF loop while `stage ∈ {choreography, resolve, reveal}` and cancels it on every exit path.

**Alternative:** `setTimeout(() => hideSplash(), 1500)` orchestration — explicitly forbidden by the brief and untestable.

### D4 — Adaptive timing: complete-metaphor compression (amended)

**Decision (amended after first implementation):** `src/lib/startupAnimation/timeline.ts` (pure) builds a phase list from `(variant, formFactor)` and exposes `accelerationPlan(elapsedAtReady, timeline)`. The original policy (finish current beat ≤ 180 ms, then time-warp past un-played pecks to consolidation, reveal ≤ 600 ms) turned out to defeat the feature on fast machines: the app was ready ~45 ms into the choreography, so the pecks never visibly played. The amended policy keeps the readiness-driven contract but changes *what* gets compressed:

- **Canonical timing (no ready signal yet):** the full phase list plays at 1× (tables below).
- **`APP_READY` at any point before idle:** the *remaining* choreography — every un-played beat, pecks included — plays at a single elevated `timeScale` so it completes within the **fast-play budget: 900 ms desktop / 700 ms phone**. Instant-ready launches therefore show the whole metaphor at ~1.7× (desktop) / ~1.5× (phone) instead of skipping it. The wall→virtual map `virtual = startVirtualMs + (now − readyWallAt) × timeScale` is monotonic and jump-free; no beat is ever dropped.
- **`APP_READY` while idle:** resolve plays at 1× from converge.start (the idle end-state equals converge's start-state, so the virtual restart is visually continuous).

Hard budgets (asserted in tests, amended values): after `appReady`, pointer-events are released within ≤ 900 ms (reveal start) and the overlay is fully unmounted within ≤ 1150 ms — i.e. a ready app is interactive in under a second even in the worst (instant-ready) case, and the branded moment always plays in full. Implemented by advancing the driver clock, not by re-scheduling (single `timeScale`; no per-element timers).

### D5 — Canonical timelines (pure data, ms offsets)

**Desktop** (`formFactor: desktop`, branded span entrance→wordmark ≈ 1520 ms; 3 fragments, 3 pecks):

| Phase | Start–End | Content |
|---|---|---|
| entrance | 0–120 | static-parity mascot settle (tiny scale 0.98→1, tuft flick) |
| fragments | 100–320 | 3 abstract token cards fade/drift in around mascot (70 ms stagger) |
| notice | 340–500 | head pivot L (≈80 ms) then R; pupil glance |
| peck-1 (select) | 520–700 | head-group dips toward fragment A; A transforms → card with accent border, scale impulse 1.0→1.08→1.0, snaps to slot |
| peck-2 (connect) | 720–880 | peck B; card B snaps beside A; connector line A–B draws (scaleX 0→1) |
| peck-3 (consolidate) | 900–1160 | peck C; connector B–C; trio aligns into tidy row/stack |
| consolidate | 1060–1260 | arrangement tightens; connectors settle |
| resolve: converge | 1260–1400 | cards converge behind/into mascot, scaling down & fading |
| resolve: wordmark | 1380–1520 | "Plethora" wordmark fades in under mascot (theme font) |
| hold / idle | 1520–1640 | mark breathes; if not ready → **idle** (indefinite) |
| reveal | 1640–1890 | 250 ms overlay fade; app interactive at 1640 |

**Mobile** (`formFactor: phone`; 2 fragments, 2 pecks; branded span ≈ 1080 ms):

| Phase | Start–End |
|---|---|
| entrance | 0–100 |
| fragments (×2) | 80–260 |
| notice (single quick L→R) | 280–420 |
| peck-1 (select) | 440–580 |
| peck-2 (connect) | 600–740 |
| consolidate | 740–880 |
| resolve (converge + wordmark) | 880–1080 |
| hold / idle | 1080–1160 |
| reveal | 1160–1380 |

Composition rules: the scene lives in a centered container capped at ~480 px wide (desktop reads compact on large displays, not scattered); mobile uses fewer/larger elements, never a shrunken desktop scene. Form factor comes from the existing presentation utilities (`useMobileShell` / `PresentationContext`), decided once at mount (no reflow mid-animation).

**Idle state visual:** consolidated card trio + connectors hold position beside/below the mascot; mascot uses a 3 s `kp-breathe` CSS keyframe (scale 1↔1.02) plus a blink every ~4 s (existing companion idioms). No re-pecking, no loop of the sequence.

### D6 — Animation technology: rAF driver + transforms/opacity + CSS keyframes for idle

**Decision:** One short-lived rAF loop in `StartupExperience` samples the pure timeline (`sampleTimeline(t) → per-element transform/opacity`) and writes inline `style.transform` / `style.opacity` on ≤ ~8 referenced elements (mascot head-group, body, wing, 3 fragment cards, 2 connectors, wordmark). SVG groups animate with `transform-box: fill-box` + explicit `transform-origin` (Chromium/WebKit/WebView2 all fine; WebView2/gecko minimums exceed Tauri's floors). Idle/hold uses CSS keyframes (compositor) and the rAF loop **stops**. Reduced-motion uses one CSS opacity transition. No WAAPI, no canvas, no library.

**Alternatives:** Web Animations API (rejected: jsdom lacks `element.animate`, hurting the deterministic tests the brief demands; playbackRate/seek bring little over a clock-driven driver); framer-motion/GSAP/Lottie/Rive (rejected: new dependency for one 1.5 s effect, against repo discipline and the no-bloat constraint); pure CSS keyframes for the whole choreography (rejected: cannot time-warp/accelerate deterministically on `APP_READY`).

### D7 — Mascot & fragment assets

**Decision:**

- New `src/components/startup/StartupBird.tsx`: an inline SVG redrawn from `assets/brand/plethora-icon-master.svg` proportions with the companion's part-group structure (`kp-bird-head` wrapping beak+eye as a pivoting subgroup about a neck origin, plus body/wing/tuft/feet). Identical brand hexes: gradient `#8B5CF6/#7C3AED/#5B21B6`, amber beak `#F59E0B` (companion convention; reads better on dark than the master's `#6D28D9`), pupil `#1E1B4B`. `CompanionBird.tsx`, the master SVG, and the icon pipeline are untouched.
- `src/__tests__/brandInventory.test.ts` is extended to lock `StartupBird.tsx` (and the static-frame copy in `index.html`) to the canonical hexes, same guard style as existing entries.
- Knowledge fragments are **abstract, language-neutral token cards** (two rounded text-bars + a dot on a small dark-glass card with a purple accent edge) — no hardcoded words anywhere. Connectors are thin accent-colored line elements.
- The static frame in `index.html` embeds the same bird in its rest pose; a unit test asserts geometry constants (mascot px size, container width) in `index.html` match the exported `KP_GEOMETRY` constants used by the React overlay, so the two layers cannot drift.

### D8 — Gating precedence (who sees which variant)

**Decision:** evaluated once at overlay mount, in this order:

1. `interface.startupAnimationEnabled === false` (new setting, default `true`, all platforms — D11) → no branded layer; kill-switch path from D3.
2. `isEinkMode` (existing `useIsEink()`) → **e-ink variant:** white surface, 3 crisp stepped stills advanced by ~450 ms plain timeouts — (1) mascot + fragments, (2) selected/connected cards, (3) mark + wordmark → reveal. No fades, no transforms, no keyframes (e-ink CSS already kills them globally); full-page state swaps only.
3. `reducedMotion` (existing presentation context; note e-ink already forces this, hence checked after) → **reduced-motion variant:** static mascot + one fragment-card appearing (single opacity step ≤ 200 ms), wordmark, then a ≤ 250 ms crossfade into the app on `appReady`. No translation, no pecking, no loops.
4. Otherwise → **full choreography** (desktop/phone timeline per D5).

`interface.animationsEnabled` deliberately does **not** gate this feature: it is forced `false` on fresh native-mobile installs (settingsStore:1208–1223) to save battery on *ambient* decoration — gating on it would mean most mobile users never see the branded launch at all, defeating the feature. The dedicated kill switch (D11) is the user-facing control. The companion keeps its own semantics; no coupling.

### D9 — Platform behavior

- **Desktop:** full timeline; container capped ~480 px; `z-index: 9000`; window-state restore is irrelevant (overlay is viewport-fixed). Plays on every fresh document load of the main window (cold launch; explicit reload via Cmd+R/vimium `reload` — a genuine webview restart — replays; this is accepted and documented, since a reload re-runs the whole boot path).
- **Mobile (Android/iOS Tauri, PWA):** phone timeline; larger elements; safe-area-aware centering (`env(safe-area-inset-*)`). **Resume does not replay**: the once-per-runtime guard is a module-level flag; a backgrounded app keeps its JS context, so resume never re-mounts the overlay; only a process/webview restart (module re-evaluation) replays. Share-target/deep-link opens on Android `singleTask` arrive via `onNewIntent` into a live context → no replay (correct: not a restart). Share-target cold opens (PWA redirect at main.tsx:10–23) are genuine starts → play.
- **Route gating:** the overlay only arms for the catch-all route. At mount it checks `window.location.hash`; `#/auth/callback` and `#/screenshot-overlay` skip the branded experience entirely (static frame is simply replaced by React as today; `PageLoader` Suspense fallback remains for those routes). All other hashes — including deep links — are main-window launches and play.
- **Android native splash continuity:** add `res/values-v31/themes.xml` with `android:windowSplashScreenBackground` = `#0A0A0A` (icon stays the launcher icon — already the mascot) and set a solid dark `android:windowBackground` on the base DayNight themes (both day and night; the WebView covers it immediately) for API 24–30. Result: dark native splash w/ mascot → dark static frame w/ mascot → choreography — one continuous launch. This is a hand edit inside the generated tree: **must be added to the re-apply inventory in `docs/android-build-notes.md`.** E-ink caveat: the native splash is dark on e-ink devices too (undetectable natively); the e-ink variant's first JS-painted frame switches to white — one deliberate full-screen repaint, accepted.
- **iOS:** no scaffold in-repo; when `tauri:ios:init` lands, the same static-frame approach needs no storyboard (dark system launch screen background is the only follow-up). Out of scope; noted for the future.

### D10 — Failure handling

Layered, reusing existing machinery — the overlay never becomes a trap:

- **Pre-React failure:** `#error-display` (z 99999) already sits above the overlay z 9000; static frame is replaced by the existing startup-error DOM as today.
- **Startup data failure:** `ensureStartup("startup")` reaching `status: "error"` (snapshot + legacy fallback both failed) → `APP_ERROR` → `aborted` (150 ms fade) revealing the app's existing error/retry surfaces (e.g., `retryStartup` consumers).
- **App render failure:** the overlay is mounted *inside* the root `ErrorBoundary` tree (main.tsx:206), so a caught render error replaces the overlay with the boundary fallback automatically.
- **Overlay's own failure:** a tiny local error boundary around `StartupExperience` degrades to `null` (plain boot surface; app visible) rather than blocking the launch.
- **Hang:** `WATCHDOG` (15 s) force-exits to reveal whatever exists beneath. `ensureStartup`'s own 8 s snapshot timeout bounds the data path first.

### D11 — Settings & i18n

`interface.startupAnimationEnabled: boolean` (default `true`) added to `settingsStore` following the exact pattern used for `animationsEnabled`/companion settings (schema field ~line 296, default ~line 689, merge/migration handling for persisted-without-flag). UI row in `SettingsPage.tsx` Interface/Appearance area beside the companion rows (~1097–1200), labeled via new `settings.interface.startupAnimation*` keys added to **all six** locales (`src/lib/i18n/locales/{en,de,es,fr,ja,zh}.ts`). No other user-visible strings: fragments are abstract, the wordmark is the product name.

### D12 — Variants registry (extensibility seam, not a system)

`src/lib/startupAnimation/variants.ts` exports `KP_VARIANTS: Record<KPVariantId, { desktop: PhaseScript; phone: PhaseScript }>` with the single entry `"knowledge-peck"`. Phase scripts are the pure data consumed by `timeline.ts`. Future variants (Highlight/Flashcard/Connection Peck, Card Stack, crooked-stack recovery) add entries without touching the driver/machine. No dispatch magic, no plugin API.

### D13 — Performance strategy

- **Zero new dependencies.** The overlay is statically imported into the entry chunk (it must render before lazy routes resolve): expected addition ≈ 6–10 KB raw (~3–5 KB gz) of SVG + logic + CSS. `npm run check:bundle` must stay green against unchanged `scripts/bundle-budgets.json` (entry budget 3.0 MB, ~2.7 MB used).
- **Animation cost:** ≤ ~8 elements animated via transform/opacity only (compositor-friendly; no layout properties, no filters/shadows animated); one rAF loop only while `stage ∈ {choreography, resolve, reveal}`; idle is a CSS keyframe on one element; loop is cancelled on every exit path (test asserts no pending rAF after `done`/`aborted`).
- **Gate compliance (repo protocol):** new `src/lib/startupAnimation/timeline.bench.ts` benches `buildTimeline` + a full `sampleTimeline` sweep over the canonical desktop timeline (deterministic inputs, result folded into a module sink, returns `void`), with a baseline entry added to `scripts/perf-baselines.json` in the same PR. Startup wall-time impact is verified by comparing `data-plethora-mounted` timing before/after on dev cold runs (manual smoke, documented in the PR), since the overlay renders *while* the app boots and the only added main-thread work is one lightweight component tree.
- **Offline:** no network — assets are inline SVG/CSS; wordmark uses the theme font already loaded; the service worker already caches `index.html` (static frame included). A static test asserts no `http(s)://` references in the new component/source files (brandInventory-style).

### D14 — Testing strategy (detailed mapping in tasks)

- **Pure unit** (vitest): timeline builder (phase tables, ordering, budgets), `accelerationPlan` (early/late/idle ready), machine transitions (full table incl. watchdog/error/kill-switch), once-per-runtime guard, route gating, variant selection precedence, geometry-parity check between `index.html` and `KP_GEOMETRY`, offline-source check, brandInventory extension.
- **Component** (Testing Library, fake timers with `requestAnimationFrame` faked): renders per `data-kp-stage` attribute; desktop vs phone compositions (presentation mocks); reduced-motion and e-ink variants; `appReady` fast-path unmounts within budget; slow path reaches idle and does not restart on further ticks; error path yields to error UI; kill switch bypasses; overlay cleans up its rAF.
- **Lifecycle integration:** with `ensureStartup` mocked (established `vi.hoisted`/module-mock patterns), the full boot fixture: mount → snapshot resolves → routePainted → resolve → reveal → unmount; and the failure fixture: snapshot rejects → legacy fails → `aborted`.
- **Visual (Playwright):** new `src/visual/knowledgePeck.visual.spec.ts` against the dev server using a **DEV-only freeze hook** (`?kp-stage=<handoff|fragments|notice|peck-1|peck-2|peck-3|consolidate|resolve|idle>&kp-freeze=1`, honored only under `import.meta.env.DEV`): `toHaveScreenshot` baselines for {initial, fragments, connected, resolved/idle} × {1280×800, 390×844} + reduced-motion frame (via `page.emulateMedia`) + e-ink still (via seeded `plethora-display-mode` localStorage). Frozen stages make the spec timing-insensitive, matching the existing harness philosophy.
- **Manual smoke (documented, not automated):** Android launch continuity (native splash → frame → animation) via the android-build skill; desktop light/dark theme reveal; e-ink device or forced mode.

## Risks / Trade-offs

- **[Static frame vs overlay geometry drift]** → single-source `KP_GEOMETRY` constants + parity unit test (D7).
- **[Static-frame SVG duplication in `index.html`]** → brandInventory test pins its hexes; accepted duplication (a build-time injection step would add complexity for ~30 lines).
- **[Entry bundle growth from static import]** → small by construction; hard check via `check:bundle`; no lazy import possible (ordering requirement).
- **[Android WebView IPC stalls (~30 s observed) leaving the bird idling a long time]** → `idle` is designed to be indefinitely stable and cheap (CSS-only), `ensureStartup`'s 8 s timeout surfaces errors first, watchdog bounds the worst case at 15 s.
- **[Theme flash on reveal for light themes]** → pre-existing behavior (dark `PageLoader` → light app); the crossfade is strictly smoother than today's hard cut.
- **[Replay on manual reload may annoy developers]** → accepted (genuine webview restart); kill switch and DEV freeze hook exist; not extended to resume/navigation.
- **[Android hand-edits lost on `tauri android init` re-run]** → splash theme edits added to `docs/android-build-notes.md` re-apply inventory.
- **[jsdom can't run the real rAF/animation stack]** → driver logic lives in pure modules sampled by injected clocks; component tests fake timers + rAF; visual truth covered by Playwright on real Chromium.
- **[Scope creep into an "animation system"]** → variants are data entries; machine/timeline modules are single-purpose with no external consumers.

## Migration Plan

Additive feature; no data migrations beyond a defaulted settings key (persisted settings lacking the flag merge to `true`). Rollback = flip the default to `false` or revert the single mount in `src/main.tsx`; the static frame degrades gracefully (it is replaced by React in <1 frame in any case). Android theme edits are independent of frontend rollback.

## Open Questions

- None blocking. Two deferred aesthetic knobs are intentionally left to implementation polish: exact idle blink cadence (target ~4 s) and whether the wordmark uses `var(--font-family)` bold vs. medium weight (default: medium). Both are covered by the visual baselines once recorded.
