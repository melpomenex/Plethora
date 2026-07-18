## 1. Rust Backend Bulk Sync Commands

- [x] 1.1 Implement bulk database command `get_all_learning_item_clocks` in `src-tauri/src/commands/sync.rs` returning a map of card IDs to their `updated_at` timestamps.
- [x] 1.2 Implement bulk database command `get_all_document_clocks` in `src-tauri/src/commands/sync.rs` returning a map of document IDs to their `updated_at` timestamps.
- [x] 1.3 Implement bulk database transaction command `upsert_synced_review_results_batch` in `src-tauri/src/commands/sync.rs` that takes a list of `SyncedReviewResult` objects and inserts them into `review_results` within a single SQLite transaction.
- [x] 1.4 Register the new commands in the Tauri builder inside `src-tauri/src/lib.rs`.

## 2. Frontend Clock Cache Integration

- [x] 2.1 Implement a lightweight clock cache provider in the frontend (`src/lib/sync/clockCache.ts`) to query and store entity clocks in memory.
- [x] 2.2 Warm up the clock cache on startup in `startSyncSubsystems.ts` using the new bulk backend commands.
- [x] 2.3 Hook the clock cache into the `replicatedMap` creation so that card and document publications dynamically update the cached local clocks.

## 3. Replay & Write Batching Optimization

- [x] 3.1 Update `replicatedMap.ts`'s `ensureReady` replay loop to skip enqueuing remote updates if the cached local clock is already equal to or newer than the remote clock.
- [x] 3.2 Refactor append-only maps in `replicatedMap.ts` to gather incoming reviews and write them using the bulk backend command `upsert_synced_review_results_batch`.

## 4. Telemetry & Environment Tweaks

- [x] 4.1 Throttle PerformanceObserver warnings in `src/lib/sync/syncTelemetry.ts` to prevent infinite console logging loops during long initialization cycles.
- [x] 4.2 Gate WebKitGTK software-rendering exports in `scripts/tauri-wrapper.sh` with a target check (`[[ "$(uname -s)" == "Linux" ]]`) so non-Linux platforms (like macOS) preserve native hardware acceleration.
