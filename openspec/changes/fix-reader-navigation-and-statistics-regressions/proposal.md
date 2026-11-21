# Change: Fix First-Navigation Loading and Reader Statistics Regressions

Covers **Requirement #6** (views failing to load on first navigation) and **Requirement #11** (Statistics crashing PDF and EPUB readers with Minified React error #185).

## Why

1. **First-navigation loading failures (#6):**
   - `TabRegistry.tsx` (`debugLazy`) and `SettingsPage.tsx` (`lazySection`) wrap `React.lazy(() => importWithRetry(...))`. In React, a rejected `React.lazy` promise is cached permanently on the `LazyExoticComponent` instance, so clicking "Retry" in `TabErrorBoundary` (`setRetryKey`) re-renders the same rejected `React.lazy` object and cannot recover.
   - `documentStore.ts` (`loadDocuments`) clears `isLoading: false` when an older collection-scoped fetch finishes after a collection switch while a newer fetch is still in flight, and lacks in-flight deduplication.
   - `startupStore.ts` (`ensureStartup`) treats `snapshot.queue.total === 0` from a `"dashboard"` snapshot as `alreadyReady` for `"queue"`, and `ContinueReadingTab` relies on `ensureStartup("continue-reading")` which short-circuits if `"dashboard"` already marked `status === "ready"` with a stale or partial snapshot.
   - `ReviewHome` and other tab views gated by `useIsActiveTab()` need deterministic transitions to content, empty, loading, or recoverable error states on first activation without requiring navigate-away-and-back.

2. **Statistics crash in PDF/EPUB readers (#11):**
   - Clicking Statistics (`ItemStatsButton`) in `DocumentViewer` mounts `ItemStatsModal` inside the active reader tab.
   - `ItemStatsModal` renders `StatsCurves` (`IntervalGrowthChart` and `RetentionCurveChart` using Recharts 3.6.0 `ResponsiveContainer`), `ItemStatsButton` passes an unstable inline `onClose` callback (re-attaching document keydown listeners on every render), and `ItemStatsModal` has no scoped error boundary, so any error or render/resize loop inside the auxiliary Statistics modal crashes the entire `TabErrorBoundary` ("This tab could not be displayed").

## What Changes

- **Retryable lazy module loading:** Replace static `React.lazy` caching on failure in `TabRegistry.tsx` and `SettingsPage.tsx` (or `importWithRetry`) with a retry-aware lazy component wrapper so transient chunk failures genuinely re-attempt import on Retry without requiring tab cycling.
- **Deterministic store & view loading:** Fix `documentStore.loadDocuments` stale-response `isLoading` clobbering using request generations, ensure `startupStore` surface readiness distinguishes surface-specific payloads, and verify first-navigation loading across major views.
- **Statistics modal stability & containment:** Stabilize `ItemStatsModal` / `ItemStatsButton` callbacks and `StatsCurves` `ResponsiveContainer` sizing (`minWidth={0}` / bounded container without layout-measurement feedback loops), and wrap `ItemStatsModal` in a scoped error boundary inside `ItemStatsButton` so auxiliary stats errors never crash the underlying PDF/EPUB reader.

## Impact

- **Affected specs:** `first-view-loading-reliability`, `item-statistics-stability`
- **Affected code:** `src/components/tabs/TabRegistry.tsx`, `src/components/settings/SettingsPage.tsx`, `src/components/common/Tabs/TabContent.tsx`, `src/stores/documentStore.ts`, `src/stores/startupStore.ts`, `src/components/stats/ItemStatsButton.tsx`, `src/components/stats/ItemStatsModal.tsx`, `src/components/stats/StatsCurves.tsx`
- **Non-goals:** Redesigning the tab bar, replacing Recharts, or hiding loading failures behind artificial timeouts.
