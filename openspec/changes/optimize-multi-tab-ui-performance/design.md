# Design: Benchmark and Optimize Multi-Tab UI Performance

## Context

Two things are true at once, and the design has to serve both: the tab workspace has no performance regression protection, and it is slow enough with several tabs open that users notice. Building the guard first is not bureaucracy here — every optimization below is a behavioral change to mounting and unmounting, and without a measurement in place we cannot tell an improvement from a plausible-looking rewrite.

Current state of the surfaces this change touches:

- **`TabContent` (`src/components/common/Tabs/TabContent.tsx`)** renders *every* tab in a pane on every render (`:104`), each wrapped in a `hidden` div. `TabWrapper` is `memo`ized with a comparator that short-circuits inactive→inactive and active→inactive transitions (`:43-61`), so a mounted-but-hidden tab does not re-render *from above* — but it stays mounted, so anything it subscribed to (zustand selectors, `document` listeners, observers, intervals) still wakes it from below, and its mount effects all ran at creation time. A single shared `<Suspense>` wraps the whole map (`:103`), and there is no error boundary.
- **`Tabs` (`Tabs.tsx:27-40`)** takes ten separate store selectors, subscribes to the whole `state.tabs` array, and calls `normalizePane(rawRootPane)` unmemoized on every render. `normalizePane` returns a fresh object whenever anything needed normalizing (`tabsStore.ts:73-105`), so downstream memoization cannot hold. `TabBar` (495 lines) and `SplitPaneContainer` (483 lines) are plain function components taking props from `Tabs`, so they reconcile whenever it does.
- **`tabsStore` (`src/stores/tabsStore.ts`, 1476 lines)** already debounces `saveTabs` at 180 ms with a `pagehide`/`visibilitychange` flush (`:194-236`), and `setActiveTab` is already wrapped in `measureTabSwitch` (`:690-706`) which records samples into `syncTelemetry`. `findReusableTab` (`:257-269`) still `JSON.stringify`s each candidate tab's `data` on every `addTab`.
- **The benchmark gate** (`vitest.bench.config.ts`, `scripts/check-perf-budget.mjs`, `scripts/perf-baselines.json`) normalizes every measurement against the in-process `noise-anchor` and compares dimensionless cost ratios, which is what makes a 1.25× default tolerance survive shared CI runners. It runs `environment: "node"`, `pool: "forks"`, `fileParallelism: false`, and discovers `src/**/*.bench.ts` only.
- **Heavy tabs already gate themselves** on `useIsActiveTab()` — the graph engines, the viewer, the queue, the RSS reader, `PodcastManager`, `AudiobooksTab` and others (18 call sites). The graph engines additionally gate on `document.hidden`. That work is done; what is left is the cost of *existing at all*.

Constraints:

- `inlineDynamicImports: true` (Tauri v2 build) means `React.lazy` chunks resolve from the same bundle — fast, but still asynchronous, so the shared Suspense boundary still yields a fallback frame.
- Split panes mean **several tabs are active simultaneously**, one per pane. Any "active tab" concept must be per-pane, and any eviction rule must be "not active in *any* pane".
- The mobile shell (`Tabs.tsx:160-181`) flattens to a single pane but still renders all its tabs through `TabContent`, so it inherits every mount cost and every fix.
- Existing behavior contract: tab component state survives switching (pinned by `TabContent.test.tsx`) and only the active tab runs boot effects (pinned by `startupVisibility.test.tsx`). Neither may regress.

## Goals / Non-Goals

**Goals:**

- Put the tab workspace under the existing anchor-normalized gate, at both the store level and the React render level.
- Pin the *shape* of tab-workspace render work with deterministic, clock-free assertions, so an accidental O(open tabs) switch fails CI on any machine.
- Make session restore mount one tab instead of N.
- Cap resident tabs so a long session does not accumulate unbounded mounted trees, without any tab type silently losing state.
- Make the real-hardware tab-switch number readable from the running app.

**Non-Goals:**

- No tab-bar virtualization — realistic tab counts are dozens; the bar is not the cost.
- No Tauri, WebView, or Rust changes; no dependency additions.
- No rewrite of the Three.js engines, the PDF viewer, or any tab's internals. This change alters *when tabs exist*, not what they do.
- No change to visible tab behavior beyond the eviction/restore path, which is opt-in per tab type.
- No attempt to measure real compositing/paint cost in CI — jsdom has no layout. Paint stays a field-telemetry question (D8).

## Decisions

### D1. Three measurement layers, counting first

Timing benchmarks are the wrong primary tool for "tab switching must not become O(N)". A 20 % timing drift and a complexity-class change look the same through a tolerance band, and the tolerance has to be loose enough to survive CI noise. So the gate is layered, cheapest and strictest first:

1. **Render-count invariants** (`npm test`, jsdom, deterministic). Mount a workspace of N tabs with instrumented content components that increment a counter per render, drive an interaction, assert exact counts. Zero clock involvement, so the assertion can be exact (`toBe(2)`, not `toBeLessThan(...)`) and cannot flake on a slow runner. This layer catches complexity-class regressions, which are the ones that actually make the app feel laggy.
2. **Store-level timing benchmarks** (`npm run bench`, Node). `setActiveTab` on a 20-tab workspace, workspace serialization, `normalizePane` over a depth-4 split tree, `findReusableTab` over 20 tabs. These are pure TypeScript over plain objects, so they fit the existing Node harness unchanged and are the least noisy timing signal available.
3. **Render-level timing benchmarks** (`npm run bench`, jsdom lane). `TabContent` mount at N tabs, active-tab switch, and a store-update pass through mounted tabs. Noisier, wider tolerance, but it is the only layer that prices React reconciliation itself.

*Alternative considered*: a Playwright/WebDriver measurement against a real WebView. Rejected for this change — it needs a built app and a display server in CI, its numbers are dominated by machine and GPU variance, and the anchor-normalization trick does not transfer to it. D8 covers the real-device question with field telemetry instead.

### D2. jsdom as a per-file opt-in, not a second bench project

DOM benchmarks need a document; the existing benchmark config deliberately does not have one, and `performance-benchmark-gate` currently forbids jsdom outright because loading `src/test/setup.ts` would add startup cost and unpredictable timing to every Node benchmark.

The resolution is per-file, not global. A DOM bench file declares `// @vitest-environment jsdom` in a docblock and imports `src/test/bench-dom-setup.ts` at the top for its shims (`matchMedia`, `ResizeObserver`, `IntersectionObserver`). `vitest.bench.config.ts` keeps `environment: "node"` as the default and keeps `src/test/bench-setup.ts` as the only global setup file, so **no existing benchmark changes environment or gains a shim**. The discovery glob widens to `src/**/*.bench.{ts,tsx}` because render benches need JSX, and `vitest.config.ts`'s exclude list widens to match so the unit run still ignores them.

The spec requirement in `performance-benchmark-gate` that says benchmarks "SHALL run in a Node environment (not jsdom)" is amended rather than deleted: Node stays the default and the rule that the jsdom *test* setup is never loaded stays intact.

*Alternative considered*: a second Vitest project with its own environment and setup file. Rejected — it produces two results files or a merged shape the gate would have to learn, for no benefit over a docblock.

### D3. One anchor, wider tolerances for the DOM lane

DOM benches normalize against the same single `noise-anchor`, not a second DOM-specific anchor. The anchor's job is to answer "how fast is this machine right now"; it answers that whether the benchmark being normalized runs in Node or jsdom, and `fileParallelism: false` means the two never contend. Introducing a per-environment anchor would mean teaching `comparePerfResults` an anchor-selection rule and an `anchor` field on baseline entries — real complexity for a second-order correction.

What jsdom *does* change is variance: allocation-heavy React rendering under a synthetic DOM is noisier than integer arithmetic. DOM bench baselines therefore get an explicit per-entry `tolerance` of 1.6–2.0 (the file already supports per-entry tolerances, and several Node benches already use 1.4–2.0 with a recorded `reason`). Each DOM entry records a `reason` naming the lane, same protocol as the existing entries.

This keeps the gate script unchanged. If DOM entries prove flaky on CI over a few weeks, the fallback is to raise those tolerances — the counting layer (D1) is what actually protects complexity, so a loose DOM tolerance is not a hole.

**Measured during implementation: the anchor does not normalize as designed, at least on some hardware.** Running the suite twice on the same commit, the `noise-anchor` sped up 1.217× between runs while every benchmark's absolute rate stayed flat — so every cost ratio moved 1.20–1.30×, the pre-existing Node benchmarks (`file-manifest` 1.30×, `markdown` 1.26×, `sm20` 1.21×) just as much as the new ones. The anchor is a tight integer/string loop that this CPU boosts independently of allocation-heavy workloads, which is precisely the case the "both numbers move together" assumption excludes. The same effect explains why eight already-recorded baselines fail on this machine by up to 8×.

Two consequences. First, the new DOM lane is not the noisy part — it is no worse than what the gate already contains, so D3 stands as written. Second, and more usefully, this is the empirical version of D1's argument: a gate whose measurements drift 1.3× run-to-run on unchanged code cannot enforce a 1.25× tolerance, and the counting invariants are doing the real work. Fixing the anchor is a change to `performance-benchmark-gate` in its own right and is not attempted here.

### D4. Deferred first mount, tracked in the store

A tab's content component renders only after the tab has been active at least once. `TabContent` renders a placeholder (an empty `hidden` div, keeping DOM order and the `key` stable) for a never-activated tab, and mounts the real component the first time it becomes active. After that the tab stays mounted and hidden exactly as today, so the state-preservation contract in `TabContent.test.tsx` is untouched.

**Where the "has ever been activated" set lives — revised during implementation.** The plan was a `mountedTabIds` set in the store. Building it showed that set would duplicate state the store already keeps: residency *is* `activeTabHistory` (restricted to still-open tabs) minus whatever the cap has evicted, and `setActiveTab`/`loadTabs`/the close paths already maintain that history — `addTabInBackground` deliberately does not touch it, which is exactly the "opened but never shown" case. A parallel set could only drift from it.

So the store gains one new field, `evictedTabIds: ReadonlySet<string>` (runtime-only, never persisted), and `TabContent` tracks the activations it has itself rendered. The split is deliberate: `TabContent` decides what to *mount* from what it has shown, and the store tells it only what to *unmount*. That keeps `TabContent` drivable from plain props — its existing tests render it directly with no store at all — while eviction still has a single owner. The two views cannot disagree in the running app, because the only thing that makes a tab active is `setActiveTab`, which is also what appends to the history.

Set identity is load-bearing: `TabContent` subscribes to `evictedTabIds`, so allocating a fresh set on every activation would re-render every pane on every switch — the exact cost this change exists to remove. The `clearEvicted` helper returns the same set when nothing changed, and a test pins it.

The interaction with `useTabReactivation` is deliberate and already correct: a deferred tab's first mount happens *while it is active*, and `useTabReactivation` ignores the initial active render (`src/hooks/useTabReactivation.ts:11-19`), so a first activation runs mount effects once — not mount effects plus a spurious reactivation.

The behavior this removes is a never-shown tab doing background work. That is the point, and no tab type relies on it: every heavy tab already gates its work behind `useIsActiveTab()`, which means a never-activated tab's mount currently pays setup cost and then does nothing.

*Alternative considered*: mounting non-active tabs at low priority via `startTransition` or an idle callback. Rejected — it defers the cost without removing it, and it makes the amount of work on screen depend on scheduler timing, which is exactly what the D1 counting layer cannot assert against.

### D5. Per-tab Suspense and error boundary

The shared `<Suspense>` at `TabContent.tsx:103` means any suspending child replaces the entire pane's content with the loader. With D4 this is mostly moot at restore (only one tab mounts), but it is still wrong when a background pane mounts a tab or a lazy chunk is slow, and the missing error boundary is a correctness bug independent of performance: one throwing tab currently takes down its pane.

Both boundaries move inside the per-tab wrapper: each tab gets its own `<Suspense fallback={<TabLoader />}>` and its own error boundary rendering a per-tab error state with a retry. Cost is one extra pair of components per *mounted* tab, which D4 already bounds.

### D6. Opt-in eviction under an LRU resident cap

Beyond a resident cap (default 8 mounted tabs per workspace, user-configurable, `0` = unlimited), the least-recently-active tab is unmounted: it is removed from the "ever activated" set of D4, so it renders as a placeholder again and re-mounts on next activation.

The eviction rule is deliberately conservative, because the failure mode of getting this wrong is silent data loss:

- **Opt-in per tab type.** Only tab types whose full state round-trips through `tab.data` plus their own persistence are evictable, and each is verified individually. Types with in-memory state that would be lost — a `doc-qa` draft, an unsaved viewer annotation, a half-written extract — stay non-evictable until proven otherwise. A workspace of only non-evictable tabs simply never evicts; the cap degrades to a no-op rather than to data loss. *Implementation note:* the list is `EVICTABLE_TAB_TYPES` in `tabsStore`, beside the existing `SINGLE_INSTANCE_TAB_TYPES`, not a field on `tabContentRegistry` — `tabsStore` must not import `TabRegistry` at module scope, which is why `loadTabs` imports it lazily. The first pass is `dashboard`, `analytics`, `continue-reading`; `image-registry` was evaluated and left out, because `ImageRegistryLibrary` holds a `renamingAssetId` that an unmount would discard.
- **Never the active tab in any pane.** Split panes have multiple simultaneously-active tabs; all of them are exempt.
- **LRU by `activeTabHistory`**, which the store already maintains in activation order (`tabsStore.ts:698`). A tab never activated is not resident and is not a candidate — it was never mounted.

Eviction runs on activation (when the resident set can only have grown), not on a timer: a timer would make an assertion about *when* a tab disappears untestable without fake clocks and would wake the app while idle.

*Alternative considered*: freezing rather than unmounting — keeping the tree mounted but suspended via `<Activity>`/offscreen semantics. Rejected for now: it does not release the memory that motivates the cap (PDF canvases, WebGL contexts), and React's offscreen API is not stable in the pinned React 19 surface this app uses.

### D7. Tightened re-render scope

Three mechanical fixes, all pinned by D1 counters rather than by timing:

- `normalizePane(rawRootPane)` becomes `useMemo`'d on `rawRootPane` identity in `Tabs`, so a stable pane tree yields a stable normalized object and downstream memoization can hold.
- `TabBar` and `SplitPaneContainer` become `memo`ized, and the callbacks `Tabs` passes them are already `useCallback`/store-action references — the two `useState` drag values are the only per-render churn and are already minimal.
- Each pane receives only its own tabs. `SplitPaneContainer` currently threads the whole `tabs` array down; slicing per pane (memoized on the pane's `tabIds` and the tab array identity) means a change to one pane's tab set does not reconcile the other pane's chrome.

### D8. Reuse key instead of per-open serialization, and a readable field number

`findReusableTab` (`tabsStore.ts:257-269`) `JSON.stringify`s both sides for every candidate on every `addTab`. Each tab gains a `dataKey` computed once when its `data` is set (stable key order, `undefined` → `""`), and reuse lookup compares strings. Same semantics, O(1) serialization per open instead of O(open tabs).

Separately, `measureTabSwitch` already feeds `syncTelemetry` samples, but nothing reads them for tab switches specifically. A dev-only summary — p50/p95/max over the recorded tab-switch samples, exposed through the existing debug surface — turns "a bit laggy" into a number on the machine that feels it. This is the only layer that sees real WebView paint, and it is where a claim like "switching is faster now" gets checked on real hardware; CI benchmarks bound the JS work, not the frame.

## Risks / Trade-offs

- **Eviction losing state.** Mitigated by opt-in `evictable` per tab type (D6), verified type by type, with the cap as a no-op for unverified types. The first implementation marks the smallest safe set; expanding it is a later, separately-reviewable change.
- **Deferred mount changing perceived behavior.** A tab opened in the background now shows its loading state on first activation rather than being warm. With `inlineDynamicImports` the chunk is already in memory, so this is a data-fetch delay, not a download — and it replaces a cost that was previously paid for *every* background tab at restore. The counting tests pin the tradeoff explicitly (one mount at restore).
- **jsdom benchmark noise.** Addressed by wide, reasoned tolerances (D3) and by not relying on the DOM lane for complexity protection (D1).
- **Baseline churn.** Every optimization in D4–D7 will move the new benchmark numbers by construction, so the tasks record baselines *after* the optimizations land, in one deliberate commit with a stated reason, per the protocol already documented in `scripts/perf-baselines.json`.
- **Split-pane edge cases** are the highest-risk area of D4/D6 (two active tabs, tab dragged between panes mid-eviction, a pane collapsing). These get explicit test coverage rather than reasoning.

## Migration Plan

No data migration. The resident-cap setting defaults into `settingsStore` like any other general setting; an existing user's first launch after the update sees a workspace that restores faster and, if they hold more than the cap in evictable tabs, evicts the oldest one on the next activation. Nothing on disk changes format, and the persisted tab payload (`incrementum-tabs`) is untouched — mount state and the activation set are runtime-only.

Rollout order matters and is reflected in `tasks.md`: measurement lands first (benchmarks and counting tests against *current* behavior, with baselines recorded), then each optimization lands against a gate that can already see it.

## Open Questions

- Which tab types get `evictable: true` in the first pass? The intent is to start with the clearly-restorable ones (`dashboard`, `analytics`, `continue-reading`, `image-registry`) and leave viewers, editors and chat surfaces alone; the implementation task verifies each candidate against its own state rather than assuming.
- Is 8 the right default resident cap? It is a starting point chosen to sit above typical usage so most users never see eviction. The field telemetry from D8 is what should revise it.
