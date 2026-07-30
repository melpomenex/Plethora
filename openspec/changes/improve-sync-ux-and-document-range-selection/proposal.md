## Why

The Sync settings page currently renders the full current-session diagnostics history inline, which pushes the controls users need below a long table. At the same time, enabling real-time sync can make rapid tab switching feel sluggish because background replication, projection, persistence, and tab-session work compete with interactive rendering. Documents already supports multi-selection, but only modifier-toggle selection; users need the familiar file-explorer range-selection behavior for contiguous batches.

## What Changes

- Replace the unbounded inline diagnostics table with a compact, collapsed-by-default diagnostics summary that exposes current health and recent activity without consuming the page; retain a bounded, scrollable details view and one-click full report copying.
- Instrument tab-switch interactions alongside sync phases and long tasks, then adjust real-time sync scheduling, projection coalescing, and session snapshot persistence so sync work yields to active input and tab switches do not synchronously perform avoidable serialization or reload work.
- Preserve session restore and sync correctness while debouncing/deduplicating non-urgent tab workspace persistence and batching refreshes caused by bursts of remote document updates.
- Add Windows/File Explorer-style Shift-click range selection to Documents using the active view’s visible, filtered, sorted document order, while preserving ordinary click, Cmd/Ctrl toggle, checkbox, double-click, context-menu, and mobile behavior.
- Add focused unit/component coverage for diagnostics collapse and bounded rendering, tab-switch performance safeguards, and range selection across grid, list/compact, filtering, sorting, and duplicate-section cases.

## Capabilities

### New Capabilities

- `sync-diagnostics-summary`: A compact sync diagnostics summary with on-demand bounded detail viewing and full-report export.
- `document-range-selection`: Ordered, modifier-aware range selection for document library items across supported desktop views.

### Modified Capabilities

- `yjs-sync-performance`: Real-time sync background work SHALL yield to interactive tab navigation and coalesce non-urgent projection/session work without weakening replication correctness.

## Impact

- Frontend settings UI: `src/components/settings/SyncSettings.tsx` and related sync-settings tests/localization strings.
- Sync/runtime performance: `src/lib/sync/progressiveScheduler.ts`, `src/lib/sync/syncTelemetry.ts`, `src/lib/documentReplication.ts`, `src/lib/fileSyncRegistration.ts`, `src/lib/localStorageSync.ts`, and `src/stores/tabsStore.ts`, with exact changes guided by profiling.
- Documents UI and tests: `src/components/documents/DocumentsView.tsx` plus new or existing selection helpers and component tests.
- No new runtime dependency, database migration, network/API contract, or breaking change is expected.
