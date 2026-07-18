## Context

Synchronization in the application utilizes Yjs with IndexedDB local persistence and WebSocket replication. When the application loads, Yjs loads the local document database and triggers a startup replay: it compares every sync entity in the Yjs map (which contains collections, documents, cards, and review results) with the local SQLite database.

Currently, this comparison is done key-by-key:
- For cards and documents, the frontend invokes Tauri commands (`get_synced_learning_item`, `get_synced_document`) individually for every item.
- For review results (which are append-only and have no local read check in JS), the frontend runs `upsert_synced_review_result` for *every* review in the Yjs map.

This creates a "transaction storm" on startup: thousands of Tauri IPC calls and un-batched SQLite read/write operations. Because each SQLite write is committed individually, it triggers a disk `fsync` per record, locking the database and freezing the UI thread (lag). In development mode, this is worsened by a `PerformanceObserver` logging all long tasks (>50ms) to console, which saturates the stdout pipe. Finally, Linux environments unconditionally disable hardware acceleration in dev mode, exacerbating CPU bottlenecking.

## Goals / Non-Goals

**Goals:**
- Eliminate startup UI thread lag and freezes during synchronization.
- Reduce database query count on startup from $O(N)$ to $O(1)$ per sync entity type.
- Batch database insertions for synchronization items (especially reviews).
- Restrict Linux software-rendering environment variables to Linux hosts only.
- Throttle long-task console logging to avoid IPC congestion in development mode.

**Non-Goals:**
- Change the core CRDT model (Yjs).
- Replace the SQLite database.
- Sync audio or video media files (which are already skipped due to memory limits).

## Decisions

### D1: Frontend In-Memory Clock Cache for Replay Filtering
Instead of querying SQLite via individual Tauri IPC calls for every key in a Yjs map during startup replay, we will load all local entity IDs and clocks at startup using a single bulk query per entity type.

- **Approach:**
  - Add backend commands to fetch all keys and clocks for sync entities in bulk (e.g., `get_all_learning_item_clocks` returning `Map<String, String>`).
  - On startup, the frontend fetches this map and caches it in memory.
  - During Yjs replay (`map.forEach`), the frontend compares the Yjs update clock against the cached local clock in-memory. It only enqueues `handleRemote` tasks for items that are actually missing or stale.
- **Alternatives Considered:**
  - *Keep current key-by-key queries:* Unacceptable, causes $O(N)$ database query storm.
  - *Batched queries (e.g., querying 50 keys at a time):* Still generates $O(N / 50)$ IPC overhead and queries, which is much slower than a single in-memory comparison.

### D2: Batched Review Projections
Reviews are append-only and immutable. Replaying them on boot triggers writes for every review in the Yjs map. We will batch review writes into bulk transactions.

- **Approach:**
  - Introduce a Tauri command `upsert_synced_review_results_batch(reviews: Vec<SyncedReviewResult>)` which inserts multiple records within a single SQL transaction.
  - In the frontend `replicatedMap` or review sync helper, collect review writes and flush them in batches of 100/500 using a debounced queue.
- **Alternatives Considered:**
  - *Batching in JS:* Individual database commands would still run in separate SQLite transactions, keeping the write speed capped by disk fsync rates.

### D3: Throttle PerformanceObserver Logging
- **Approach:**
  - In `src/lib/sync/syncTelemetry.ts`, throttle long task logging in dev mode (e.g., log at most once per 2 seconds, or only log if a task takes > 250ms).
- **Alternatives Considered:**
  - *Remove observer entirely:* Losing telemetry makes profiling performance issues harder; throttling is a better compromise.

### D4: Target-Gated Dev Environment Workarounds
- **Approach:**
  - Wrap WebKitGTK and Mesa soft-rendering environment exports in `scripts/tauri-wrapper.sh` inside a Linux-only target check (`if [[ "$(uname -s)" == "Linux" ]]`).
- **Alternatives Considered:**
  - *Keep exports global:* Harms macOS/Windows developers by injecting irrelevant env vars that could affect other tools or debugging workflows.

## Risks / Trade-offs

- **[Risk] High Memory Footprint on Large Libraries** → Loading all card clocks into memory could use too much RAM if the user has 50k+ cards.
  * *Mitigation:* A map of 50,000 string IDs and timestamps uses under 5MB of memory, which is negligible compared to the memory footprint of the Webview itself.
- **[Risk] Sync Inconsistencies due to Cache Staleness** → If a local database write happens after the cache is loaded but before replay completes, the cache could be stale.
  * *Mitigation:* Local writes are intercepted by the `replicatedMap` publish path which updates the local state synchronously, ensuring the clock cache stays correct.
