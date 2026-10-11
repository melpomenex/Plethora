## Why

On Android, a cold launch can show a blank or empty library while local database startup is still in progress, and the data may not appear until the user changes views. The existing coordinated startup path is present, so this follow-up will identify where Android readiness, request recovery, or UI hydration loses that data and ensure users see a loading or retry state until a real result is available.

## What Changes

- Trace and instrument Android cold-start readiness from native database initialization through the startup query, store hydration, and first visible items; distinguish a confirmed empty database from a pending, timed-out, or failed load.
- Make the active mobile surface recover from delayed or dropped startup requests without requiring navigation or app relaunch, using bounded retries and preserving already-visible data.
- Keep empty states behind a completed successful query, and provide a clear recoverable error/retry path when Android cannot load local data.
- Add regression coverage for delayed readiness, transient IPC failures, populated and empty databases, and eventual item visibility on Android devices, including GrapheneOS and standard Android.

## Capabilities

### New Capabilities

- `android-startup-data-loading`: Reliable readiness, retry, and empty-state behavior for local library data during Android cold start.

### Modified Capabilities

- None.

## Impact

- Startup coordination and API: `src/stores/startupStore.ts`, `src/api/startup.ts`, and `src/lib/tauri.ts`.
- Mobile shell and data surfaces: `src/components/startup/StartupExperience.tsx`, `src/components/layout/MainLayout.tsx`, mobile library/queue views, and document/queue stores.
- Native Android startup diagnostics and readiness gates in `src-tauri`, plus Android-focused frontend and native regression coverage.
- No database schema, stored user data, or sync behavior changes are intended.
