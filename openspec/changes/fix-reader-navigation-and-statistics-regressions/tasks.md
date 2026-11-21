# Tasks: Fix First-Navigation Loading and Reader Statistics Regressions

## 1. First-Navigation Loading (#6)
- [x] 1.1 Fix `debugLazy` in `src/components/tabs/TabRegistry.tsx` and `lazySection` in `src/components/settings/SettingsPage.tsx` so retrying a failed lazy chunk genuinely re-attempts import instead of hitting React's cached rejected promise.
- [x] 1.2 Add monotonic request-generation guarding to `documentStore.loadDocuments` (`src/stores/documentStore.ts`) so stale collection fetches never clobber `isLoading` or `documents`.
- [x] 1.3 Audit `startupStore.ensureStartup`, `ContinueReadingTab`, `DocumentsView`, and `ReviewQueueView` for first-activation state transitions (content, empty, loading, error).
- [x] 1.4 Add regression tests for cold startup, warm repeat, first navigation, collection switch races, rejected backend requests, and lazy chunk retry recovery.

## 2. Reader Statistics Stability (#11)
- [x] 2.1 Stabilize `ItemStatsButton` (`onClose` callback) and `ItemStatsModal` focus/listener lifecycle.
- [x] 2.2 Harden `StatsCurves.tsx` (`min-w-0` on grid children, `minWidth={0}` and `debounce` on Recharts `ResponsiveContainer`) to prevent resize-measurement update loops.
- [x] 2.3 Add a scoped `ItemStatsErrorBoundary` around `ItemStatsModal` in `ItemStatsButton.tsx` so auxiliary stats failures never crash the active reader tab.
- [x] 2.4 Add unmocked `StatsCurves` + `ItemStatsModal` unit tests and reader containment tests.
