# Change: Navigation, Layout, and Reader Interaction

Covers numbered requirements **#6 (tab strip mouse-wheel/trackpad scrolling), #11 (first-open/new-view loading stalls), #17 (Assistant resize dynamically reflows EPUB text)**.

## Why

1. **Tab strip wheel scroll (#6):** `src/components/common/Tabs/TabBar.tsx` already has wheel handling: `handleTabWheel` (lines 149–154) scrolls by `e.deltaY` only, and a capture-phase non-passive listener (lines 158–173) `preventDefault()`s `deltaY` while hovering the strip (a prior Linux AppImage WebKitGTK fix). **Gaps:** native horizontal trackpad deltas (`deltaX`) are ignored; Shift+wheel (which produces `deltaX`) is ignored; horizontal gestures don't scroll the overflowed strip; and the capture listener traps page scroll even when the strip is at a boundary. The requirement is to make the strip navigate naturally with wheel/trackpad like a browser while never changing the active tab or scrolling tab contents.
2. **First-open/new-view loading stalls (#11):** The app uses tab-based navigation with lazy tab components (`src/components/tabs/TabRegistry.tsx` `debugLazy` → `importWithRetry`) and Suspense fallbacks. Repo history shows the root causes were already being mitigated: `importWithRetry.ts` (lazy-chunk fetch stall on Android WebView — "spins on first open, works on second"), `startupStore.ts` 8 s watchdog for the startup snapshot dead-promise coalescing (regression-tested in `startupStore.stall.test.ts`), `tabsStore.loadTabs` restore guard (line 1657, "first view switch doesn't load, second one does"), `DocumentsView.tsx:334–342` collection-hydration race, and `ReviewQueueView.tsx:322–427` queue claim-after-success. This requirement is a **root-cause hardening + instrumentation** task: verify no first-open path still stalls, add dev diagnostics/tests to catch regressions (cold startup and warm state), and fix whatever remains rather than hiding the spinner.
3. **Assistant resize → EPUB reflow (#17):** The chain is already wired: `AssistantPanel` width state (lines 293–296) → `DocumentViewerWrapper.tsx:436–461` flex row → EPUB container `ResizeObserver` + debounced `rendition.resize(undefined, undefined, liveCfi)` (`EPUBViewer.tsx:1039–1088`). **Gaps:** `onWidthChange` is exposed by `AssistantPanel` but never consumed; the reflow is 150 ms-debounced and suppressed during interaction; there is no explicit min-width enforcement for either pane; and there is no automated test that resizing keeps the logical reading position stable.

## What Changes

### 1. Tab strip wheel/trackpad scroll (see `specs/tab-strip-wheel-scroll`)
Make the horizontally-overflowing tab strip scroll naturally: vertical wheel deltas translate to horizontal tab scrolling only while hovering/focusing the strip; native horizontal deltas (trackpad, Shift+wheel `deltaX`) scroll horizontally; scrolling never changes the active tab or scrolls tab contents; page scroll is not trapped when the strip is at a boundary; momentum/inertial scroll works across Linux, macOS, Windows (and high-resolution trackpads). Implement inside `TabBar.tsx` (the single shared strip component) rather than adding per-screen handlers.

### 2. First-open loading reliability (see `specs/first-view-loading-reliability`)
Treat as a root-cause investigation + fix + instrumentation. Any view must render reliably the first time it is opened after startup (cold start) and in a warm session. Keep the existing mitigations, find any remaining path that spins on first navigation, and add **development-only** diagnostics/tests capable of catching first-view navigation latency regressions (cold and warm), without noisy production logging.

### 3. Assistant resize → EPUB reflow (see `specs/assistant-resize-epub-reflow`)
Complete and verify the existing chain: resizing the Assistant (side-by-side mode) continuously updates the reader width and the EPUB text reflows to the new width; the logical reading position stays stable; highlights/selections/annotations remain anchored; minimum usable widths prevent either pane collapsing; the renderer's reflow is triggered properly (ResizeObserver + debounced/rAF `rendition.resize`), including in Queue View / Scroll Mode where the same Assistant+reader layout appears.

## Impact

### Affected Specs
- `tab-strip-wheel-scroll` (new, #6)
- `first-view-loading-reliability` (new, #11)
- `assistant-resize-epub-reflow` (new, #17)

### Affected Code Areas
- `src/components/common/Tabs/TabBar.tsx` (#6)
- `src/components/tabs/TabRegistry.tsx`, `src/utils/importWithRetry.ts`, `src/stores/startupStore.ts`, `src/stores/tabsStore.ts`, `src/components/documents/DocumentsView.tsx`, `src/components/review/ReviewQueueView.tsx`, `src/components/settings/SettingsPage.tsx` (lazy sections), and new dev diagnostics (#11)
- `src/components/assistant/AssistantPanel.tsx` (`onWidthChange` consumption, min widths), `src/components/viewer/DocumentViewerWrapper.tsx`, `src/components/viewer/EPUBViewer.tsx` (ResizeObserver/reflow), `src/pages/QueueScrollPage.tsx` (#17)

### Non-goals
- No redesign of the tab strip, Assistant, or EPUB viewer.
- No hiding of spinners or artificial delays for #11.
- No change to the EPUB rendering mode (continuous vs paginated).