## 1. Open a DOM lane in the benchmark harness

- [x] 1.1 Widen discovery to JSX benches: `benchmark.include` in `vitest.bench.config.ts` becomes `["src/**/*.bench.{ts,tsx}"]`; keep `environment: "node"`, `pool: "forks"`, `fileParallelism: false`, and `setupFiles: ["./src/test/bench-setup.ts"]` unchanged
- [x] 1.2 Widen the unit-run exclusion: add `src/**/*.bench.tsx` to `test.exclude` in `vitest.config.ts` so `npm test` still ignores benchmark files
- [x] 1.3 Add `src/test/bench-dom-setup.ts` — minimal jsdom shims (`matchMedia`, `ResizeObserver`, `IntersectionObserver`) imported explicitly by DOM bench files, *not* registered as a global setup file, so Node benches are untouched. Document at the top why this is separate from both `src/test/setup.ts` and `src/test/bench-setup.ts`
- [x] 1.4 Confirm the existing `DOMMatrix` guard in `src/test/bench-setup.ts` still no-ops under jsdom and does not clobber a real implementation
- [x] 1.5 List `npm run bench` and `npm run bench:check` in the README's Available Scripts table. They were never there — a gap from `add-performance-benchmark-gate`, not from this change — but a change that exists so the UI is benchmarked should leave the command findable

## 2. Benchmark the tab workspace

- [x] 2.1 Add `src/stores/tabsWorkspace.bench.ts` (Node lane) with a fixture that builds a 20-tab workspace and a depth-4 split tree from `seededRandom` in `src/test/bench-support.ts`, never `Math.random()`, and stubs `localStorage` so `saveTabs` measures serialization rather than storage
- [x] 2.2 Benchmark cases in 2.1: `tabs/activate-in-20-tab-workspace` (the `setActiveTab` reducer path), `tabs/serialize-20-tab-workspace` (the `saveTabs` payload build), `tabs/normalize-pane-tree-depth-4`, `tabs/find-reusable-tab-20-tabs`
- [x] 2.3 Add `src/components/common/Tabs/tabWorkspace.bench.tsx` (DOM lane) with the `// @vitest-environment jsdom` docblock and an import of `src/test/bench-dom-setup`; placeholder content only, never a real tab. **Revised after measuring:** the mount case uses a placeholder with a *representative* mount cost, the switch and re-render cases keep trivial content. With trivial content everywhere, the mount benchmark measured 0.98x against HEAD — root setup and the twelve wrapper divs dominated it and the mount count was invisible. With representative content the same comparison is ~10x. Switch/re-render stay trivial, where workspace reconciliation really is the subject
- [x] 2.4 Benchmark cases in 2.3: `tabs-dom/mount-12-tab-workspace`, `tabs-dom/switch-active-tab-12-tabs`, `tabs-dom/rerender-on-tab-collection-change`
- [x] 2.5 Run `npm run bench` and confirm all seven new cases appear in `.bench/results.json` and that `node scripts/check-perf-budget.mjs` reports them as unbaselined warnings (not failures) with paste-ready JSON lines

## 3. Pin the invariants that already hold

- [x] 3.1 Add `src/components/common/Tabs/__tests__/renderInvariants.test.tsx` with a counting harness: a content component factory that increments a per-tab counter on each render, plus a `renderWorkspace(tabCount, activeId)` helper. No timers, no `performance.now()`, exact-count assertions only
- [x] 3.2 Assert switching the active tab in a 12-tab pane leaves the other 10 tabs' render counters unchanged, and that the count of rendered subtrees is identical at 4 tabs and at 12 tabs
- [x] 3.3 Assert updating one tab's `data` re-renders only that tab's subtree
- [x] 3.4 Carry forward the existing contracts into the same file so an optimization cannot satisfy the counters by breaking them: state survives a switch away and back (mirrors `TabContent.test.tsx`), and exactly one active-gated boot effect runs (mirrors `startupVisibility.test.tsx`)

## 4. Mount tabs on first activation

- [x] 4.1 Add residency state to `src/stores/tabsStore.ts`. **Revised during implementation:** a *mounted* set would have duplicated state the store already has — residency is `activeTabHistory` (restricted to open tabs) minus the tabs the cap evicted, and `setActiveTab`/`loadTabs` already maintain that history. So the store gains only `evictedTabIds: ReadonlySet<string>` (non-persisted), cleared for a tab on activation and on every close path, with a `clearEvicted` helper that preserves set identity when nothing changed so subscribers do not re-render on each switch. `TabContent` tracks the activations it has itself rendered, which keeps it drivable from plain props — see the note in 4.2
- [x] 4.2 In `TabContent` (`src/components/common/Tabs/TabContent.tsx:104`), render a stable empty placeholder for a tab not in `mountedTabIds`, preserving `key`, DOM order, and the `hidden`/`aria-hidden` treatment; mount the real component once the tab is in the set
- [x] 4.3 Verify the first-mount/reactivation interaction: a deferred tab's first mount happens while active, and `useTabReactivation` (`src/hooks/useTabReactivation.ts:11-19`) ignores the initial active render — add a test that first activation runs mount work once and reactivation work zero times, and that a later switch back runs reactivation work
- [x] 4.4 Mount-count coverage: restoring a 12-tab single-pane workspace mounts exactly one content component; a two-pane split mounts exactly two (one per pane's active tab). Landed in the new `deferredTabMounting.test.tsx` rather than `renderInvariants.test.tsx` — the latter counts *renders*, these count *mounts*
- [x] 4.5 Check the mobile shell path (`Tabs.tsx:160-181`) shares the same `TabContent` and therefore the same deferral, and add a test for a flattened single-pane mobile workspace

## 5. Give each tab its own boundaries

- [x] 5.1 Replace the single `<Suspense>` at `TabContent.tsx:103` with a per-tab `<Suspense fallback={<TabLoader />}>` inside the per-tab wrapper, so a suspending tab no longer blanks the pane
- [x] 5.2 Add a per-tab error boundary rendering a scoped error state with a retry that remounts only that tab; reuse the app's existing error-boundary component if one fits, otherwise add a minimal local one next to `TabContent`
- [x] 5.3 Add the loading and error strings (including the retry label) to the i18n locale files alongside the other `tabs.*` strings
- [x] 5.4 Test: a mounted tab that suspends leaves the active tab's content on screen; a tab that throws shows its own error state while the pane, tab bar, and other tabs stay functional; retry remounts only the failed tab

## 6. Cap resident tabs with LRU eviction

- [x] 6.1 Declare the evictable tab types. **Revised during implementation:** the flag lives in `tabsStore` as `EVICTABLE_TAB_TYPES` (beside the existing `SINGLE_INSTANCE_TAB_TYPES`) rather than in `tabContentRegistry`, because `tabsStore` must not import `TabRegistry` at module scope — that is why `loadTabs` imports it lazily. Initial set: `dashboard`, `analytics`, `continue-reading`. `image-registry` was evaluated and left out: `ImageRegistryLibrary` holds `renamingAssetId`, so an in-flight rename would be lost
- [x] 6.2 Add the `residentTabCap` setting to `src/stores/settingsStore.ts` (default 8, `0` = unlimited), surface it in the general settings section, and add its label/description to the locale files
- [x] 6.3 Implement eviction in `tabsStore` on the `setActiveTab` path: candidates are tabs in `mountedTabIds` that are evictable and are not the `activeTabId` of *any* pane; pick least-recently-active first using the existing `activeTabHistory` order (`tabsStore.ts:698`); remove from `mountedTabIds` until the count is at the cap or no candidates remain. No timers
- [x] 6.4 Test the policy: cap reached evicts exactly the LRU eligible tab; a workspace of only non-evictable tabs never evicts and is allowed to exceed the cap; both panes' active tabs are exempt in a split; lowering the cap takes effect on the next activation; `0` disables eviction
- [x] 6.5 Test restore-after-eviction: an evicted tab unmounts, reactivates, and remounts (`deferredTabMounting.test.tsx`); and a cross-pane move evicts nothing (`tabResidentCap.test.ts`). **Corrected during implementation:** the original wording claimed a moved tab keeps its component state — it does not, and did not before this change either. A tab moved between panes is rendered under a different pane subtree, so React remounts it. Verified directly; the `idle-tab-eviction` spec scenario was rewritten to the guarantee that actually holds

## 7. Tighten workspace re-render scope

- [x] 7.1 Memoize pane normalization in `Tabs` (`src/components/common/Tabs/Tabs.tsx:29-30`): `useMemo(() => normalizePane(rawRootPane), [rawRootPane])` so a stable tree yields a stable object
- [x] 7.2 Wrap `TabBar` and `SplitPaneContainer` in `memo`, and confirm every callback `Tabs` passes them is a stable store action or `useCallback` reference
- [x] 7.3 Pass each pane only its own tabs: derive the per-pane slice memoized on the pane's `tabIds` and the `tabs` array identity, instead of threading the whole array through `SplitPaneContainer`
- [x] 7.4 Replace the per-candidate `JSON.stringify` in `findReusableTab` with `tabDataKey`, a stable structural key cached in a `WeakMap` on the payload object itself (payloads are replaced, never mutated, so a key never goes stale). Chosen over a `dataKey` field on `Tab` because it needs no shape change and covers rehydrated tabs too. Keys are order-independent, so `{documentId, page}` and `{page, documentId}` now reuse one tab where they previously opened two — a small deliberate improvement over `JSON.stringify`, with `undefined` fields still dropped exactly as JSON does. Covered by `tabDataKey.test.ts`
- [x] 7.5 Pin pane isolation with render counters in the new `paneIsolation.test.tsx`: changing a tab in one pane, and adding a tab to one pane, leave the other pane's chrome unrendered. `TabBar` is stubbed with a counter because tab *content* cannot show this — `TabWrapper`'s memo already skips an unchanged active tab either way. Verified to fail without the memoization

## 8. Make the field number readable

- [x] 8.1 Add a percentile summary over the tab-switch samples already recorded by `measureTabSwitch` (`src/stores/tabsStore.ts:690-706` → `src/lib/sync/syncTelemetry.ts:150-171`): count, p50, p95, max, returning a zero-sample result rather than misleading zeros when nothing has been measured
- [x] 8.2 Expose it through the existing dev/debug surface (see `src/components/common/PerformanceMonitor.tsx` and `src/debug/`) without adding always-on bookkeeping to release builds — the existing `shouldMeasureTabSwitches()` gate stays the switch
- [x] 8.3 Test the summary: zero samples, one sample, and an ordered set where p50/p95/max are known by construction

## 9. Record baselines and verify

> **Measured against HEAD (worktree A/B, same machine, back to back).** Mounting a 12-tab workspace: 38.9 ms -> 4.0 ms, ~10x raw / ~15x normalized. Re-render on a tab-collection change: ~1.4x raw / ~2.1x normalized. Switching the active tab: unchanged, as expected — the pre-existing `TabWrapper` memo already made a switch re-render one subtree. Store-level benches 1.00-1.05x, i.e. flat: those paths were never the bottleneck.

- [ ] 9.1 **Blocked — needs a CI run.** Baselines must come from CI, and this machine cannot stand in for it: eight *pre-existing* baselines already fail here (`precision/review-sequence` at 8.2x its recorded cost), and 9.3 found why. Recording local numbers would bake in values that fail on CI. Until then the gate reports the seven new benchmarks as warnings with paste-ready JSON lines, which is the intended handoff — run `npm run bench:check` on CI and paste them, updating `recordedFrom`
- [ ] 9.2 **Blocked on 9.1.** Tolerances cannot be set without numbers. When recording: DOM-lane entries want 1.6-2.0, and per 9.3 the Node-lane entries deserve a second look too
- [x] 9.3 Ran the suite twice on the same commit. **Finding — the anchor does not normalize on this hardware.** Between two back-to-back runs the `noise-anchor` sped up 1.217x while every benchmark's absolute rate stayed flat, so *every* cost ratio drifted 1.20-1.30x — pre-existing benchmarks (`file-manifest` 1.30x, `markdown` 1.26x, `precision` 1.21x) exactly as much as the new ones (1.16-1.31x). The anchor is a tight integer/string loop that this CPU boosts independently of allocation-heavy workloads, which breaks the "both numbers move together" assumption and also explains the eight pre-existing failures. The new DOM lane is no noisier than what is already there. This is a gate-wide issue, out of scope here, and it is the empirical case for D1: the counting invariants, not the timings, are what actually protect against regressions
- [x] 9.4 `vitest run`: 314 files, 2209 tests, 1 skipped, **0 failures**. The run still exits 1 from a `[vitest-pool]: Worker exited unexpectedly` teardown crash — infrastructure, not a test: it produced 19 such messages at default concurrency and 1 at `--maxWorkers=4`, so it scales with worker count. ESLint on every touched file: clean apart from one pre-existing warning (unused `totalSize` in `cleanupEmptyPanes`, `tabsStore.ts:591`, untouched by this change). `tsc --noEmit`: clean
- [x] 9.5 Confirmed by reading `.github/workflows/ci-regression.yml`: the `performance` job runs `npm run bench` then `node scripts/check-perf-budget.mjs`, and discovery now globs `*.bench.{ts,tsx}` — the new suites are picked up with no workflow edit
- [ ] 9.6 **Blocked — no display in this environment.** The Vite PWA dev server starts and serves the app (modules 200, no errors attributable to this change), but the browser pane is not displayed, so the renderer never composites and every page-inspection tool times out. Manual verification still owed: restore a 12+ tab session and confirm it paints without waiting on every tab; switch rapidly and read p50/p95 from the sync diagnostics panel; cross the resident cap with evictable tabs and confirm the evicted one restores; confirm a split workspace keeps both active tabs mounted
