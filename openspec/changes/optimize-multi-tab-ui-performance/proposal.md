## Why

The performance gate we already have (`npm run bench:check`, `scripts/perf-baselines.json`) covers *computation* — SM-20 scheduling, queue composition, markdown, Anki import. It covers no UI at all: every existing `*.bench.ts` runs in a plain Node environment with no DOM, and `performance-benchmark-gate` explicitly forbids jsdom. So the surface users actually feel — the tab workspace — has no regression protection whatsoever, and it is measurably the laggy one once several tabs are open.

Reading the tab workspace shows why, and none of it is speculative:

- **Every tab in a pane is mounted from the moment it exists.** `TabContent` maps over all tabs and renders each one inside a `hidden` div (`src/components/common/Tabs/TabContent.tsx:104`). Restoring a session with twelve tabs mounts twelve component trees at once — twelve sets of mount effects, store subscriptions, observers and fetches — to show one.
- **One `Suspense` boundary wraps all of them** (`TabContent.tsx:103`). Any tab whose lazy chunk has not resolved suspends the *entire* pane, so on cold start nothing paints until the slowest tab in the workspace is ready, and there is no per-tab error boundary either — one throwing tab blanks the pane.
- **Nothing is ever unmounted.** A tab opened an hour ago still holds its PDF.js canvases, its Three.js scene, its subscriptions. There is no resident cap and no eviction.
- **The workspace re-renders wholesale.** `Tabs` subscribes to the whole `state.tabs` array and re-runs `normalizePane(rawRootPane)` on every render (`Tabs.tsx:28-30`); `TabBar` and `SplitPaneContainer` are unmemoized, so any tab-data change reconciles the bar and every mounted tab wrapper.
- **`findReusableTab` JSON-stringifies each open tab's data on every tab open** (`tabsStore.ts:264`) — on the interaction path, O(open tabs) serialization per click.

Previous rounds already fixed what profiling caught at the time (debounced `saveTabs`, reference-compare in the `TabWrapper` memo, `useIsActiveTab()` gating in the heavy tabs). Those were point fixes without a gate behind them; the structural costs above survived because nothing measures them.

## What Changes

- **The benchmark harness gains a DOM lane.** Benchmark files may opt into jsdom per file, and `*.bench.tsx` is discovered alongside `*.bench.ts`, so React render cost can be measured by the same anchor-normalized gate that already protects the computational hot paths. No existing benchmark changes environment.
- **The tab workspace gets benchmarks and a baseline.** New suites measure the store-level hot paths (activate a tab in a 20-tab workspace, serialize the workspace, normalize a nested pane tree, reuse-lookup) and the render-level ones (mount a workspace, switch active tab, push a store update through mounted tabs), all gated in CI.
- **Render-count invariants become hard assertions.** Timing benchmarks catch drift; they do not catch "someone made tab switching O(open tabs)". Deterministic tests assert the *shape* of the work — how many tab subtrees render on a switch, how many mount on restore, how many react to a store update — with counters, not clocks, so they are immune to machine speed and run in `npm test`.
- **Tabs mount on first activation, not on creation.** A tab that has never been shown renders nothing until it is first activated. Once activated it stays mounted, so today's state-preservation behavior across switches is unchanged. Session restore drops from N mounts to one.
- **Each tab gets its own Suspense and error boundary.** A tab still loading, or throwing, no longer blanks or kills its whole pane.
- **Long-idle tabs are evicted under a resident cap.** Beyond a configurable number of mounted tabs per workspace, the least-recently-active *evictable* tab is unmounted and re-mounts on next activation. Eviction is opt-in per tab type and never touches an active tab, so no tab type loses state until it has been verified restorable.
- **Workspace re-render scope is tightened.** Memoized pane normalization, memoized `TabBar`/`SplitPaneContainer`, per-pane tab slices, and a precomputed data key replacing the per-open `JSON.stringify` scan.
- **Real-hardware tab-switch latency becomes readable.** `measureTabSwitch` already records samples into sync telemetry; a dev-only summary surfaces p50/p95 so "a bit laggy" can be checked against an actual number on the machine that feels it.

Non-goals: no tab-bar virtualization (tab counts are dozens, not thousands); no changes to the Tauri/WebView layer or Rust backend; no rewrite of the Three.js graph engines or the PDF viewer; no change to what any tab *displays*; no new dependencies.

## Capabilities

### New Capabilities
- `ui-render-benchmarks`: React render cost for the tab workspace is measured by anchor-normalized benchmarks under the existing gate, and real-hardware tab-switch latency is readable from the running app.
- `tab-render-invariants`: The tab workspace's render *shape* — subtrees rendered per switch, mounted per restore, woken per store update — is pinned by deterministic counting assertions in the unit test suite.
- `deferred-tab-mounting`: A tab's content mounts on first activation rather than on creation, and each tab carries its own Suspense and error boundary.
- `idle-tab-eviction`: A resident-tab cap unmounts the least-recently-active evictable tab, which re-mounts and restores on next activation.

### Modified Capabilities
- `performance-benchmark-gate`: the harness requirement that benchmarks run only in a Node environment is amended to allow per-file jsdom opt-in and `*.bench.tsx` discovery, so UI benchmarks can join the gate.

## Impact

- `vitest.bench.config.ts` — discover `*.bench.tsx`; keep Node as the default environment.
- `vitest.config.ts` — exclude `*.bench.tsx` from the unit run.
- `src/test/bench-dom-setup.ts` (new) — minimal DOM shims imported by DOM bench files only; `src/test/bench-setup.ts` stays as-is for Node benches.
- `src/stores/tabsWorkspace.bench.ts`, `src/components/common/Tabs/tabWorkspace.bench.tsx` (new) — the benchmark suites.
- `scripts/perf-baselines.json` — new entries, recorded from a CI run, with wider tolerances on the DOM lane.
- `src/components/common/Tabs/TabContent.tsx` — deferred first mount, per-tab Suspense + error boundary, eviction-aware rendering.
- `src/components/common/Tabs/Tabs.tsx`, `TabBar.tsx`, `SplitPaneContainer.tsx` — memoized normalization and memoized pane chrome.
- `src/stores/tabsStore.ts` — activation recency for eviction, resident-cap state, precomputed reuse key.
- `src/components/tabs/TabRegistry.tsx` — per-tab-type `evictable` flag.
- `src/stores/settingsStore.ts` + settings UI + locales — the resident-cap setting.
- `.github/workflows/ci-regression.yml` — no new job; the existing `performance` job picks the new benches up.
- `README.md` — the Available Scripts table gains `npm run bench` and `npm run bench:check`, which it had been missing since the gate was introduced.
- No migrations, no new Tauri commands, no dependency changes.
