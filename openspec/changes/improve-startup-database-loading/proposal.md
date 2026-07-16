## Why

On cold start, especially on low-tier Android hardware such as the Boox Palma 2, the app can render its shell before the first useful library/queue data arrives. The current boot path fans out into several independent database reads and IPC calls while the native backend is still completing database open, integrity validation, and migrations; the result is avoidable contention, duplicate work, and visible startup jank.

This change will make the first local data load coordinated, lightweight, and measurable so the app becomes usable quickly without weakening database correctness or making background sync part of the startup critical path.

## What Changes

- Add startup performance instrumentation that separates native backend readiness, first paint, first local data, collection selection, document loading, queue loading, and background work, with low-tier-mobile benchmark fixtures and acceptance budgets.
- Introduce one coordinated local-startup loading path that resolves the active collection before issuing collection-scoped document and queue queries, deduplicates overlapping requests, and exposes shared readiness/error state to the shell and tabs.
- Reduce the initial database/IPC payload to the fields needed by the first screen; keep full document bodies, covers, sync registration, analytics, and other enrichment work deferred until after the initial data is usable.
- Optimize the native startup/list-query path for cold launch by avoiding repeated setup work, using purpose-built summary/count queries, and ensuring migrations/integrity handling remain safe and observable.
- Update default dashboard, queue, documents, and continue-reading surfaces to consume the coordinated startup result rather than independently reloading the same data on mount.
- Add regression tests for request deduplication, collection-scoped correctness, cold-start ordering, payload shape, and failure recovery on slow/empty databases.

## Capabilities

### New Capabilities

- `startup-data-loading`: Coordinated, progressive loading of the first local collection, library items, and queue data with explicit readiness and performance behavior.

### Modified Capabilities

<!-- No existing repository capability has startup-loading requirements that need a delta spec. -->

## Impact

- Frontend bootstrap and shell: `src/main.tsx`, `MainLayout`, dashboard/queue/documents/continue-reading tabs, and the collection/document/queue stores.
- Frontend APIs and telemetry: startup snapshot/readiness APIs and performance diagnostics alongside the existing Tauri/browser command wrappers.
- Native backend: Tauri setup readiness, SQLite connection/migration lifecycle, document summary/list queries, queue startup queries, and related command tests.
- No user-facing data model or sync protocol changes are intended. Full document content remains available through existing detail APIs, and background sync/enrichment stays outside the critical path.
