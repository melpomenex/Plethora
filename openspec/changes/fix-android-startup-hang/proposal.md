## Why

Android launch is still very slow despite the existing startup-data recovery work. The source records a roughly 30-second first IPC stall while native setup completes in roughly 1.5 seconds; retries recover some launches but leave the blocking operation unresolved, and nested retry budgets can keep the app loading for much longer.

## What Changes

- Capture an Android launch trace from activity creation through bootstrap, main-module loading, native database readiness, first IPC dispatch/response, snapshot hydration, and the first usable local screen. Identify the blocking operation and thread before choosing the fix.
- Remove the measured startup blocker in the application, Android plugin, or vendored WebView bridge, according to that trace; retain the database integrity and migration gate.
- Schedule optional startup integrations after the first usable local screen so their imports and IPC calls do not compete with readiness and local data loading.
- Give Android launch one shared 15-second automatic startup deadline, including readiness probes and snapshot retries, followed by visible recovery controls instead of repeated independent timeout cycles.
- Preserve startup diagnostics while the native bridge is blocked, and verify release APK cold launches against a five-second p95 target for first usable local data on the reference Pixel device and fixture.

## Capabilities

### New Capabilities

- `android-startup-latency`: Traceable, bounded Android launch from bootstrap to usable local data, with a responsive bridge and independent recovery when startup stalls.

### Modified Capabilities

- None. Existing startup collection scoping, loading/empty/error semantics, bounded snapshots, and animation behavior remain prerequisites covered by the earlier startup changes.

## Impact

- Frontend startup: `src/main-bootstrap.ts`, `src/main.tsx`, `src/lib/tauri.ts`, `src/stores/startupStore.ts`, `src/lib/startupDiagnostics.ts`, and `src/lib/consoleLogcatBridge.ts`.
- Native readiness and the measured blocking path: `src-tauri/src/lib.rs`, relevant Android plugins/activity code, and `vendor/wry-0.55.1/src/android/` only if the trace demonstrates a bridge defect.
- Startup recovery presentation, regression tests, and an Android launch measurement harness/report.
- Extends `fix-android-cold-start-data-loading` and `improve-startup-database-loading`; their device-verification gaps must be resolved as part of this work. No new dependency or database schema change is planned.
