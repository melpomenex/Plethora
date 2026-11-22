# Bound Sync Boot Memory

## Why

On macOS the app can reach **15+ GB of RSS** with a burst of **~166% CPU** during roughly the first five minutes after launch, during which the UI is unresponsive. The burst is self-limiting: CPU falls back to single digits once the work completes.

The decisive framing fact is that **no amount of local data explains it**. Measured on the reporting machine (2026-07-24):

| Store | Size |
|---|---|
| `incrementum.db` (file) | 261 MB |
| ...of which `documents` table | 43 MB |
| ...of which `rss_articles` + FTS | 35 MB |
| WebKit IndexedDB (both origins) | ~30 MB |
| `imports/` (binary files on disk) | 389 MB |
| **Total addressable content** | **~500 MB, of which ~80 MB is DB content** |

15 GB is ~30× everything on disk and ~190× the database's actual content. So the cause is not payload size — it is **replication or unbounded allocation**, and the only subsystem that runs unattended in that window and touches all of this data is the Yjs sync boot chain.

That chain is confirmed live on the reporting machine. Persisted settings read `sync.yjs.enabled: true` and `sync.autoDownloadMode: "always"`.

### What the boot chain actually does

`main.tsx:306` defers `startSyncSubsystems()` to just after first paint. From `src/lib/startSyncSubsystems.ts` it then runs, unattended and without a memory ceiling:

1. `getYjsSync()` — `Y.Doc` + `IndexeddbPersistence` replay + the **encrypted** WebSocket provider (Argon2id, 64 MiB × 3 iterations × 4 parallelism, in a Worker).
2. **Nine entity replicators concurrently** via a bare `Promise.all` — documents, collections, extracts, conversations, flashcards, RSS, podcasts, file sync, file-availability intent.
3. `startAutoFileSyncDownload()` — gated only by `autoDownloadMode`, which is `"always"` here.
4. `runSyncMigrationIfNeeded()` — first-join backfill publishing the local library (1044 learning items, batched 50) into the shared doc.
5. `drainSyncOutboxBatch(50)` on a 1.5 s timer, for the rest of the session.

The codebase already records this chain as dangerous. `src/main.tsx:279`:

> "The eager chain previously caused OutOfMemoryError on Android (~189MB allocation against a 512MB Java heap during boot — see commit 524f087a) ... the (large) sync room is pulled into the WebView heap."

That was resolved by **deferring** the chain past first paint, not by bounding it. Desktop has no 512 MB ceiling to force the failure, so instead of crashing it simply keeps allocating.

### Concrete unbounded paths found

| # | Finding | Evidence | Bounded today? |
|---|---|---|---|
| 1 | **The progressive scheduler cannot bound the boot chain.** `ProgressiveScheduler` does `await item.run(context)` — it awaits each work item to completion. Its 4 ms `sliceBudget` / `deadline` / `shouldYield` are a **cooperative** contract that a task must opt into. Every boot-chain call site passes a context-ignoring thunk (`run: () => getYjsSync()`, `run: () => startAutoFileSyncDownload()`, `run: () => runSyncMigrationIfNeeded()`), so a multi-minute task occupies the scheduler entirely and the slicing does nothing. | `src/lib/sync/progressiveScheduler.ts:201` (`await item.run`), `:179-196`; call sites in `src/lib/startSyncSubsystems.ts:47,157,167` | No |
| 2 | **The scheduler has no memory budget at all**, despite the shipped description of "explicit CPU, memory, I/O, and network budgets". `effectiveSliceMs()` reads `navigator.deviceMemory` only to shrink a *time* slice. Nothing measures or caps bytes in flight. | `src/lib/sync/progressiveScheduler.ts:238-250` | No |
| 3 | **Nine replicators initialize concurrently with no coordination.** Each projects its entity set into Yjs maps at the same time; Yjs's in-memory struct representation typically runs 5–20× the raw record size for many small records, and all nine peaks coincide. | `src/lib/startSyncSubsystems.ts:126-153` | No |
| 4 | **Every cached file Blob is loaded into memory at construction.** `FileTransferManager`'s constructor fires `rehydrateCachedFiles()`, which walks every id in the IndexedDB file cache and holds each `Blob` in a `localFiles: Map<string, Blob>` — no size cap, no count cap, no eviction, for the life of the session. This is the lazy-loader fix from the changelog (`registerLocalFileLoader`) being bypassed on the receive path. | `src/lib/file-transfer.ts:294`, `:333-349`, `:273` | No |
| 5 | **File assembly holds 3× the file size simultaneously.** `assembleAndComplete` keeps `receivedChunks` (1×), allocates `combined = new Uint8Array(totalLength)` (2×), then wraps it in a `Blob` (3×) — then retains the Blob in `localFiles`, caches it to IndexedDB, persists it to disk through IPC, and `saveReceivedFileSync` re-registers the same eager Blob a second time. | `src/lib/file-transfer.ts:769-812`, `src/lib/fileSyncRegistration.ts:380` | No |
| 6 | **Auto-download has no re-entrancy guard.** `maybeAutoDownload` is invoked from the manifest subscription on every `device-online` / `device-files-updated` with that device's *entire* file list, and runs a sequential loop over all of it. Repeat events start overlapping loops; `inFlightDownloads` dedupes per-`fileId` only, so distinct files across concurrent loops are all in flight at once. | `src/lib/autoFileSyncDownload.ts:110-155` | Partially |
| 7 | **Server-side frame-log backlog replay is unbounded and unmeasurable locally.** The relay is the sole persistence layer for encrypted frames; a joining device receives the whole backlog and decrypts + applies each frame. Backlog size is a function of room history across all paired devices, not of local data — the one candidate whose magnitude cannot be checked from this machine. | `CHANGELOG.md` (zero-knowledge relay / encrypted frame-log entries); `src/lib/sync/encryptedProvider.ts` | Unknown |
| 8 | **The chain is unobservable in production.** `getSyncTelemetry()` and `getStartupRequestCounts()` record per-phase timings and sizes but have **zero consumers** anywhere in `src/` and are not exposed on `window`. `installSyncLongTaskObserver()` logs to `console.warn`, and the desktop log sink (`~/Library/Logs/com.incrementum.app/Incrementum.log`) carries only Rust lines. There is currently no way for a user or maintainer to say which phase spiked. | `src/lib/sync/syncTelemetry.ts:97,107,119`; verified no consumers | No |

Findings 1–3 and 8 are certain and architectural. Findings 4–6 are certain as code defects but, on *this* machine's current cache (~30 MB of IndexedDB), cannot alone account for 15 GB — they are unbounded by design and will scale with the file cache. Finding 7 is the only candidate whose size is both unbounded and unverifiable from the client. **This proposal therefore treats diagnosis as work item #1** and structures every fix to be correct regardless of which path dominates.

### Adjacent findings outside the sync chain

Surfaced during the same investigation, included because they are real defects in the same "unbounded / uncleaned" family:

| # | Finding | Evidence |
|---|---|---|
| 9 | `DynamicVirtualList` re-attaches an **inline ref callback** on every render, so `measureItem` runs a forced synchronous `getBoundingClientRect()` per visible item per render. It calls `forceUpdate({})` whenever the measured float height differs *at all* from the cached one — from the commit/layout phase, so the re-render flushes synchronously. Because each item's `top` is a running sum of previously measured floats, height-depends-on-offset-depends-on-height can oscillate at sub-pixel precision and never settle. Heights are also cached **by index** rather than item id (any sort/filter invalidates all of them), `getItemOffset` is O(n) called inside the render map (O(n²) per render), and `map.get(i) \|\| itemHeight` treats a measured `0` as absent — which is exactly what a `display:none` tab returns. | `src/components/common/VirtualList.tsx:363,332,255,283,287-325` |
| 10 | `ThemeBackdrop`'s `onResize` contract overwrites the ref holding the handler that was actually registered, so cleanup removes a function that was never added and the real `resize` listener leaks — once per effect re-run, and the deps include `isVisible`, which flips on **every window focus change**. Each leaked closure retains the canvas. | `src/components/common/ThemeBackdrop.tsx:1424-1466` |
| 11 | Podcast transcription temp files are removed on the success and error paths but there is no boot-time sweep, so a kill mid-transcription strands them. 270 MB of stranded `.mpeg` files were found on the reporting machine (dated 2026-06-18 and 2026-07-05). | `src-tauri/src/commands/podcast.rs:432,526,558,592` |
| 12 | The app data directory contains `incrementum.sync-conflict-*.db` files and one marked `.corrupt-20260618`, indicating an external file-level syncer (Syncthing, per the device tags) is replicating the SQLite file itself alongside the app's own Yjs sync. **SQLite in WAL mode does not survive file-level sync** — this is a live data-loss hazard the app can detect but currently ignores. | `~/Library/Application Support/com.incrementum.app/` directory listing |

## What Changes

- **Sync boot runs under an explicit budget.** The boot chain's heavy steps accept and honor the `SyncWorkContext` (`shouldYield` / `yield` / `checkpoint`) instead of passing context-ignoring thunks, so the progressive scheduler's slicing becomes real rather than advisory. The nine-way concurrent replicator init becomes a bounded-concurrency sequence. The scheduler gains a bytes-in-flight budget alongside its existing time slice, and refuses to start new work while over it.
- **File transfer stops holding whole files in memory.** `rehydrateCachedFiles` registers **lazy loaders** (the mechanism that already exists via `registerLocalFileLoader`) instead of materializing every cached `Blob`; `localFiles` becomes a bounded LRU of live Blobs with eviction; assembly streams chunks to their destination rather than building a 3× peak; `saveReceivedFileSync` stops re-registering an eager Blob; and `maybeAutoDownload` gets a re-entrancy guard plus a global concurrent-transfer cap.
- **Backlog replay is chunked and checkpointed.** Frame-log replay applies updates in bounded batches with a yield between them, and records a checkpoint so an interrupted replay resumes rather than restarting.
- **The boot chain becomes observable.** Sync telemetry (phase durations, records, bytes, peak `performance.memory` where available) is surfaced in a Settings → Sync diagnostics panel and mirrored to the desktop log sink, so the spiking phase is identifiable from a user's machine without attaching a debugger.
- **Queue list virtualization is corrected.** Stable ref callbacks, id-keyed height cache, an epsilon threshold plus an iteration cap on measurement, prefix-sum offsets instead of O(n) scans, and an explicit "not measured" sentinel so a `0` from a hidden tab is not confused with a real height.
- **Two leak/cleanup fixes.** `ThemeBackdrop` tracks the registered resize handler separately from the animation-supplied one; a boot-time sweep removes orphaned transcription temp files older than a threshold.
- **Data-loss guard.** On startup the app detects `*.sync-conflict-*` / `*.corrupt-*` siblings of its database and surfaces a one-time, dismissible warning that external file-level sync of the SQLite file risks corruption.

Non-goals: no change to sync *semantics* (what replicates, conflict resolution, CRDT model, encryption scheme, or the relay protocol); no re-litigation of deferring the chain past first paint (that stays); no work on the desktop tab-mounting model (`TabContent` keeping every tab mounted is real but is a separate architectural change); no changes to scheduling algorithms or SM-20 paths; no Cargo profile changes.

## Capabilities

### New Capabilities

- `sync-boot-memory-budget`: The sync boot chain executes under an explicit, enforced ceiling on concurrency and bytes in flight, and its long-running steps are preemptible by the progressive scheduler.
- `file-transfer-memory-bounds`: File bytes crossing the sync layer are never retained in memory beyond a bounded working set, and no file is materialized more than once per transfer.
- `sync-boot-observability`: Per-phase sync boot telemetry is reachable from a running production build without a debugger.
- `queue-list-virtualization`: The dynamic virtual list converges to a stable measurement in bounded work and cannot enter a self-sustaining render loop.
- `local-database-integrity-guard`: The app detects and warns about external file-level replication of its SQLite database.

### Modified Capabilities

<!-- none — `yjs-sync-performance` keeps every requirement it has; this change adds new bounding requirements rather than altering replay semantics. -->

## Impact

- **Frontend (primary):** `src/lib/startSyncSubsystems.ts`, `src/lib/sync/progressiveScheduler.ts`, `src/lib/sync/syncTelemetry.ts`, `src/lib/file-transfer.ts`, `src/lib/fileSyncRegistration.ts`, `src/lib/autoFileSyncDownload.ts`, `src/lib/useFileSync.ts`, `src/lib/sync/encryptedProvider.ts`, `src/components/settings/SyncSettings.tsx`, `src/components/common/VirtualList.tsx`, `src/components/common/ThemeBackdrop.tsx`.
- **Rust:** `src-tauri/src/commands/podcast.rs` (temp sweep), new startup integrity check near `src-tauri/src/lib.rs`. No DB schema changes, no IPC contract changes.
- **Compatibility:** All changes are internal to one device. The wire format, room protocol, and encryption scheme are untouched, so a fixed device and an unfixed device interoperate normally — important because sync is inherently multi-version.
- **Risk concentration:** the file-transfer rework. `localFiles` is currently load-bearing for *serving* files to peers; converting it to lazy loaders plus a bounded LRU must not make this device stop seeding files it holds. Covered by design D2 and its scenarios.
- **Verification gate:** the change is not complete until a cold launch on the reporting machine's dataset is observed with peak RSS recorded, before and after. Baseline to beat: 15+ GB peak, ~5 minutes unresponsive.

