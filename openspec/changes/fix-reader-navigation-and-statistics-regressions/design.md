# Design: First-Navigation Loading and Reader Statistics Stability

## 1. First-Navigation Loading (#6)

### Root Causes
1. **Permanent rejection cache in `React.lazy`:** `debugLazy` (`TabRegistry.tsx`) and `lazySection` (`SettingsPage.tsx`) pass `() => importWithRetry(...)` directly to `React.lazy`. Once `importWithRetry` rejects, React caches that rejected `Thenable` on the `LazyExoticComponent`. Bumping `retryKey` in `TabErrorBoundary` remounts `<TabWrapper key={retryKey}>`, which still renders the same `LazyExoticComponent`, immediately re-throwing without retrying.
2. **Stale `isLoading: false` in `documentStore.loadDocuments`:** When `activeCollectionId` changes during an in-flight `loadDocuments()`, the stale branch sets `{ isLoading: false }` even though the newer collection's `loadDocuments()` is still running. Using a monotonic `loadGeneration` counter ensures only the latest request updates `isLoading` and `documents`.
3. **Surface-unaware `alreadyReady` in `startupStore.ensureStartup`:** `ContinueReadingTab` and `QueueTab` can hit `alreadyReady` from an earlier `"dashboard"` call if `snapshot` was populated for another surface.

### Solution
- Introduce a `retryableLazy` helper (used by `debugLazy` and `lazySection`) or resettable lazy wrapper that creates a fresh `React.lazy` / clears cached rejection when `TabErrorBoundary` retries.
- Add generation-guarded `loadDocuments()` in `documentStore.ts` so stale responses never clear `isLoading` or overwrite newer collection data.
- Add comprehensive Vitest regression tests covering cold startup, warm state, first navigation, rapid tab switching, slow backend, rejected requests, collection switches, and lazy-import retry recovery.

## 2. Reader Statistics Stability (#11)

### Root Causes & Hardening
- `ItemStatsButton` passes an inline `onClose` arrow function to `ItemStatsModal`, causing `ItemStatsModal`'s `useEffect([onClose])` keydown listener to detach/reattach on every parent render.
- `StatsCurves.tsx` renders Recharts 3.6.0 `ResponsiveContainer` inside `<figure>` elements in a CSS Grid (`grid gap-4 sm:grid-cols-2`) without `min-w-0` on the grid items or `minWidth={0}` on `ResponsiveContainer`, and without guarding against resize-measurement cycles.
- `ItemStatsButton` renders `ItemStatsModal` directly inside `DocumentViewer`'s `TabErrorBoundary` without a modal-scoped error boundary, allowing any error inside Statistics to destroy the entire active PDF/EPUB reader tab.

### Solution
- Stabilize `onClose` in `ItemStatsButton` with `useCallback` and `useEffect` cleanup.
- Add `min-w-0` to chart `<figure>` wrappers and `minWidth={0}` + `debounce={50}` to `ResponsiveContainer` in `StatsCurves.tsx` so Recharts resize measurements cannot oscillate in CSS Grid/flex containers.
- Wrap `ItemStatsModal` in a dedicated `ItemStatsErrorBoundary` inside `ItemStatsButton` that preserves the underlying reader tab and offers an actionable retry/close fallback.
- Add Vitest + Playwright tests exercising `ItemStatsModal` with real `StatsCurves` (unmocked) on PDF and EPUB readers, verifying zero `Maximum update depth exceeded` errors and preserved reading position/zoom.

## Platform & Performance Considerations
- Zero impact on cold startup or entry bundle size (`ItemStatsModal` and `StatsCurves` remain lazily loaded).
- Compatible with Linux WebKitGTK, macOS WKWebView, Windows WebView2, Android, and iOS.
