## Why

When Yjs sync is enabled and contains a large amount of replicated data (such as thousands of review logs or cards), the application experiences severe UI thread lag and freezes during startup and synchronization on both Linux and macOS. 

This performance degradation is caused by:
1. **Un-batched database operations:** During the startup sync replay, the application enqueues and executes thousands of individual key-by-key SQLite queries (`getLocal`) and writes (`apply`) via Tauri IPC without transaction batching. This triggers thousands of separate SQLite fsyncs, locking the database and blocking all other read/write operations.
2. **IPC and console logging floods:** Telemetry/PerformanceObservers warn on every long task (> 50ms) in development mode, sending verbose logs over Tauri IPC which blocks the main thread and creates a performance feedback loop.
3. **Linux-specific software rendering:** Development environments unconditionally disable GPU acceleration, exacerbating any CPU-bound main thread lag.

Optimizing these areas now is critical to keep the application responsive and usable on desktop platforms when real-time synchronization is enabled.

## What Changes

- **Batched SQLite Operations during Sync Replay:** Modify the replication layer to read and write database rows in bulk/batches during startup replay and sync catch-up instead of firing individual Tauri IPC database commands per key.
- **In-Memory Echo/Clock Cache:** Add a lightweight persistent clock cache for sync maps in the frontend to avoid querying the local database for keys whose remote sync clock hasn't changed.
- **Throttled/Silenced Telemetry Warnings:** Disable or throttle verbose `long task observed` warnings from `PerformanceObserver` in `tauri dev` mode.
- **Selective Linux HW Accel:** Wrap Linux EGL/Compositing workaround environment variables inside a proper target check so they are not exported unconditionally for non-Linux platforms (e.g., macOS), and refine the software rendering fallback.

## Capabilities

### New Capabilities
- `yjs-sync-performance`: Defines performance thresholds and correctness metrics for batched sync replay and database projections.

### Modified Capabilities
<!-- None: The functional behavior of synchronization remains identical; only the performance, batching, and latency characteristics are modified. -->

## Impact

- **Frontend:** `src/lib/sync/replicatedMap.ts`, `src/lib/documentReplication.ts`, `src/lib/startSyncSubsystems.ts`, `src/utils/performance.ts`
- **Backend (Tauri/Rust):** `src-tauri/src/commands/sync.rs`, `src-tauri/src/database/` (adding bulk sync database helper commands)
- **Tooling:** `scripts/tauri-wrapper.sh` (environment exports check)
