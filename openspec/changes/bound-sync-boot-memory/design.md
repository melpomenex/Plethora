# Design: Bound Sync Boot Memory

## Context

The proposal establishes that a 15+ GB peak cannot come from ~500 MB of on-disk state, so the cause is amplification or retention inside the sync boot chain. It also establishes that we do **not** yet know which of the unbounded paths dominates on the reporting machine. That uncertainty shapes this design in two ways:

1. **Diagnosis is a deliverable, not a prerequisite.** Group 1 of the tasks ships the observability that makes the answer readable off a user's machine. It lands first and independently.
2. **Every fix must stand on its own merit.** Each bounding change below is justified as "this path has no ceiling and should," not as "this is the bug." If group 1 reveals the dominant path is #7 (frame-log backlog), groups 2–4 are still correct; they simply become preventive rather than curative.

### Current state of the hot paths

- **`ProgressiveScheduler`** (`src/lib/sync/progressiveScheduler.ts`) implements weighted lanes (`P0`–`P3`), an adaptive time slice (default 4 ms, shrinking under `deviceMemory <= 2` or `saveData`), input-pending preemption, retries with exponential backoff, and domain quarantine. The mechanism is sound. The defect is that `runSlice` does `await item.run(context)` — the scheduler owns *when* an item starts, never *how long it runs*. Preemption is entirely cooperative through `context.shouldYield()` / `context.yield()`, and no boot-chain call site accepts the context. A single `run: () => runSyncMigrationIfNeeded()` therefore occupies the scheduler for the whole migration.

- **`startSyncSubsystems`** (`src/lib/startSyncSubsystems.ts`) wraps three steps in `scheduleProgressiveSyncWork` with context-ignoring thunks (lines 47, 157, 167) and runs the nine `ensure*Ready()` calls in a bare `Promise.all` (lines 126–153) **outside the scheduler entirely**. So the heaviest phase is not even nominally budgeted.

- **`FileTransferManager`** (`src/lib/file-transfer.ts`) holds `localFiles: Map<string, Blob>` (line 273). Two population paths exist. The lazy one, `registerLocalFileLoader` (line 609), stores a `() => Promise<Blob>` and is the fix documented in the changelog for the import path. The eager ones — `rehydrateCachedFiles()` fired from the constructor (line 294) and `registerLocalFile(fileId, blob)` (line 587) — store live Blobs with no cap and no eviction. `assembleAndComplete` (line 769) is the 3× peak: `receivedChunks` map, `combined` copy, `Blob` copy, all live at once, followed by an IndexedDB `cacheFile` and a disk write through IPC.

- **`maybeAutoDownload`** (`src/lib/autoFileSyncDownload.ts:127`) is subscribed to manifest `file-added` / `device-online` / `device-files-updated`. The last two pass `event.hasFiles` — a whole device's file list — and the function loops it sequentially with no guard against a second invocation starting while the first is mid-loop.

- **`syncTelemetry`** (`src/lib/sync/syncTelemetry.ts`) already records everything needed: `markSyncPhaseStart` returns a closer that takes `SyncPhaseDetails`, `recordSyncWorkSize(bytes, records)` exists, `getSyncTelemetry()` returns the samples, `installSyncLongTaskObserver()` watches for long tasks. `getSyncTelemetry` and `getStartupRequestCounts` have **no callers outside their own module and tests**.

### Constraints

- **Multi-version interop is mandatory.** Sync exists to connect devices that update at different times. No change may alter the wire format, frame encoding, room protocol, or encryption scheme.
- **This device must keep seeding.** `localFiles` is read by the outbound path (line 406) to serve peers. Any change to its population must preserve the set of files this device advertises and can serve.
- **`navigator.deviceMemory` is unavailable in WKWebView**, and `performance.memory` is Chromium-only. Memory accounting must be *estimated from bytes we ourselves allocate*, not read from a browser API, or it will silently no-op on the exact platform that reports the bug.
- **The chain must stay automatic.** Deferring past first paint stays; making sync manual or opt-in is not an acceptable fix.
- **The 4 ms slice is deliberate** and tuned for mobile responsiveness. This design does not retune it.

## Goals / Non-Goals

**Goals:**

- A cold launch on the reporting machine's dataset completes sync boot with a peak RSS delta under a stated ceiling, with the UI remaining interactive throughout.
- Any single sync work item is preemptible within one slice budget, or is decomposed until it is.
- No code path retains more than a bounded working set of file bytes.
- A user can report *which phase* spiked without attaching a debugger.
- The dynamic virtual list provably terminates.

**Non-Goals:**

- No new sync semantics, entities, conflict rules, or protocol versions.
- No change to what the relay stores or how frames are encrypted.
- No redesign of `TabContent`'s keep-everything-mounted model (real, separate, larger).
- No attempt to shrink the on-disk footprint (`WebKitCache`, models, backups) beyond the orphaned-temp-file sweep.
- No retuning of scheduler lane weights or slice defaults.

## Decisions

### D1. Make the scheduler's preemption contract mandatory, not optional

The scheduler cannot interrupt an `await`. Rather than add forced preemption (impossible for a single JS task), make the contract enforceable at the boundary:

- Introduce a `SyncWorkItem.kind: "atomic" | "sliceable"` discriminator. `atomic` keeps today's behavior for genuinely indivisible short work. `sliceable` asserts the task consults `context.shouldYield()`.
- In dev builds, a `sliceable` item that runs longer than `sliceBudget * N` without calling `yield()` logs a loud warning naming the item id. This turns a silent architectural violation into a visible one.
- Rewrite the three boot-chain call sites to accept the context and honor it: `runSyncMigrationIfNeeded` yields between its existing 50-item batches (it already has `await new Promise(r => setTimeout(r, 0))` there — replace with `ctx.yield()`), and `startAutoFileSyncDownload`'s download loop yields between transfers.

**Why not "just spawn a Worker"?** Yjs docs, IndexedDB persistence, and the WebSocket provider all live on the main thread and are shared by the whole app; relocating them is a rewrite, not a fix. Cooperative yielding is the tractable change.

### D2. `localFiles` becomes a lazy registry plus a bounded LRU

Split the map's two jobs, which are currently conflated:

```
  TODAY                                 AFTER
  localFiles: Map<id, Blob>             fileRegistry: Map<id, () => Promise<Blob>>
    ├─ "which files can I serve?"         └─ "which files can I serve?"  (metadata only)
    └─ "give me the bytes"                blobCache: LRU<id, Blob>  (bounded, evictable)
                                            └─ "give me the bytes"  (miss → call loader)
```

- `rehydrateCachedFiles()` becomes `rehydrateCachedFileIds()`: it enumerates ids from the IndexedDB cache (`getAllCachedFileIds()` — already id-only) and registers a **loader** per id (`() => getCachedFile(id)`). It no longer calls `getCachedFile` in a loop at construction. This alone converts an O(total cached bytes) boot allocation into O(number of files × a few bytes).
- The empty-blob cleanup that `rehydrateCachedFiles` performs today moves to loader-resolution time: a loader returning a zero-size blob deletes the cache entry and reports unavailability, preserving the existing repair behavior lazily.
- `registerLocalFile(fileId, blob)` is kept for the true "I have these bytes right now" case but inserts into `blobCache` (evictable) while registering a loader that can re-read from disk/IndexedDB. Nothing depends on the Blob being permanently resident.
- The LRU is capped by **total bytes**, not entry count, since file sizes span kilobytes to hundreds of megabytes. Default cap: 128 MB, configurable. Eviction never drops registry entries, only cached bytes, so the advertised file set is unchanged.

**Seeding invariant:** presence/advertisement derives from `fileRegistry.keys()`, which is a superset of what `localFiles` covers today. `refreshPresence()` and `hasFileLocal()` read the registry. This is what makes the change safe for peers.

### D3. Stream assembly instead of building a 3× peak

`assembleAndComplete` currently materializes chunks → `combined` → `Blob`. Two of those three are avoidable:

- Construct the `Blob` directly from the ordered chunk array: `new Blob(chunks, { type })`. The `Blob` constructor accepts a sequence of `BufferSource`s and concatenates internally; the intermediate `combined: Uint8Array` is pure waste. This removes the 2× peak.
- Release `transfer.receivedChunks` immediately after the `Blob` is constructed and before any caching or IPC, so the 1× copy does not survive into the persistence phase.
- `saveReceivedFileSync` currently persists to disk *and* re-registers the same eager `Blob` (`fileSyncRegistration.ts:380`). Once the file is on disk, register a **disk-backed loader** instead, so the received bytes become collectable as soon as persistence succeeds.

Net effect: peak per transfer goes from ~3× file size retained-through-persistence to ~1× transient.

### D4. Bytes-in-flight budget in the scheduler

Add an explicit accounting the scheduler can enforce, since no browser API will tell us:

- `SyncWorkItem.estimatedBytes?: number` — declared by the caller (file transfers know the size from the manifest; batch replays know `batchSize × avgRecord`).
- The scheduler tracks `bytesInFlight` and refuses to start a new item when `bytesInFlight + item.estimatedBytes > byteBudget`, re-queueing it instead. Default budget: 256 MB, with a lower default under `navigator.deviceMemory <= 2` where that hint exists.
- Items without `estimatedBytes` are treated as zero and remain schedulable — so this is additive and cannot deadlock existing callers.

**Why a declared estimate rather than a measurement?** `performance.memory` does not exist in WKWebView, which is precisely where the bug reproduces. A budget we can only enforce on Chromium is not a fix. Declared estimates are approximate but enforceable everywhere.

### D5. Serialize replicator init with bounded concurrency

Replace the nine-way `Promise.all` with a bounded runner (concurrency 2, same helper shape as `parallelWithLimit` in `queueStore.ts`), each replicator scheduled as a `sliceable` P2 item. Nine concurrent Yjs map projections into one shared doc have no upside — they contend for the same doc and the same main thread — while their memory peaks compound. Sequencing trades a modest wall-clock increase for a much lower high-water mark, and the whole chain is already off the critical path by design.

Order matters for user perception, not correctness: collections → documents → flashcards → extracts → conversations → rss → podcasts → fileSync → fileAvailabilityIntent, so the surfaces a user is most likely to open first reconcile first.

### D6. Chunked, checkpointed backlog replay

For the frame-log backlog (proposal finding #7, magnitude unknown):

- Replay applies frames in bounded batches with `ctx.yield()` between batches, rather than draining the socket buffer into `applyUpdate` as fast as frames arrive.
- Each batch records a checkpoint through the scheduler's existing `checkpoint` hook, so an interrupted or quarantined replay resumes from its last committed position instead of restarting from zero — which today would re-do the entire allocation on every launch.
- Telemetry (D7) reports frames replayed and bytes decrypted so the backlog's actual size becomes a known quantity for the first time.

### D7. Surface the telemetry that already exists

No new instrumentation is needed — only consumers:

- Extend `SyncPhaseDetails` with an optional `bytes` field and call `recordSyncWorkSize` from the replay, migration, and transfer paths.
- Add a **Settings → Sync → Diagnostics** panel rendering `getSyncTelemetry()` as a phase table (phase, duration, records, bytes) plus `getStartupRequestCounts()`, with a "copy report" button. This is what turns a user report of "it spikes" into "phase `map-ready` took 240 s and moved 4.1 GB".
- Mirror a compact one-line summary per phase into the native log sink on desktop at completion, so the rotating log file at `~/Library/Logs/com.incrementum.app/` carries the same data without the user opening settings.
- Throttle the long-task observer's `console.warn` (the existing `yjs-sync-performance` spec already requires this in dev; extend the same throttle to the new log sink so a pathological boot cannot flood the log).

### D8. Make the virtual list provably terminate

Four independent changes, each closing one non-termination or cost path in `src/components/common/VirtualList.tsx`:

1. **Stable refs.** Replace the inline `ref={(el) => measureItem(actualIndex, el)}` with a memoized per-key callback, so React stops detaching/reattaching every ref on every render and `getBoundingClientRect` stops being called on renders that changed nothing.
2. **Epsilon + iteration cap.** `measureItem` triggers `forceUpdate` only when `Math.abs(height - cached) > 0.5` **and** that index has re-measured fewer than `MAX_MEASURE_PASSES` (e.g. 3) times since the item list last changed. Sub-pixel oscillation cannot sustain a render loop past the cap.
3. **Id-keyed cache with an explicit sentinel.** `Map<number, number>` keyed by index becomes `Map<string, number>` keyed by item key, and `getItemHeight` distinguishes "not measured" from a measured `0` via `has()` rather than `||` — so a hidden (`display: none`) tab's all-zero rects are stored as real zeros and do not silently fall back to the estimate.
4. **Prefix sums.** Replace `getItemOffset`'s O(n) scan (called for `totalHeight`, `findStartIndex`, `findEndIndex`, and once per visible item) with a cached prefix-sum array rebuilt only when a height or the item list changes. O(n²) per render becomes O(n) per invalidation.

**Why not adopt `@tanstack/react-virtual` here?** It is already a dependency and is the right long-term answer, but swapping the desktop queue's renderer changes scroll-anchoring, keyboard navigation, and the action-sheet/context-menu interactions that `ReviewQueueView` layers on top. That is a larger, riskier change than fixing four defects, and the mobile queue was just migrated onto this same `DynamicVirtualList` under `optimize-performance-hotspots` task 2.1 — fixing the shared component benefits both surfaces immediately.

### D9. Two small hygiene fixes

- **`ThemeBackdrop`:** hold the registered resize handler in a dedicated ref that `onResize` cannot overwrite. `onResize(fn)` stores the animation's handler in a *second* ref; cleanup removes whichever handler was actually passed to `addEventListener`. One-line contract fix, closes a per-focus-change listener + canvas leak.
- **Orphaned temp sweep:** on startup, remove files in `temp_transcription/` older than 24 h that have no live job. Runs in the existing background-task pattern in `lib.rs` — it is I/O only and must not block boot.

### D10. Integrity guard is a warning, never an action

On startup, glob the database directory for `*.sync-conflict-*` and `*.corrupt-*` siblings. If any exist, emit a startup notice through the existing `StartupNotice` channel: external file-level replication of a WAL-mode SQLite database can corrupt it, and the app's own sync already covers cross-device state.

The app **never** deletes, moves, quarantines, or repairs these files. They may be a user's only copy of data from a failed sync. Detect and inform; the user decides.

## Migration Plan

Ordered by risk, lowest first. Each group is independently shippable and independently verifiable.

1. **Observability (D7)** — additive only, no behavior change. Ships first because it produces the data that validates every later group. After this lands, capture a labelled baseline from the reporting machine.
2. **Hygiene (D9) + integrity guard (D10)** — isolated, no interaction with sync.
3. **Virtual list (D8)** — self-contained component, covered by unit tests, benefits desktop and mobile queues.
4. **Scheduler contract + budget (D1, D4, D5)** — behavioral but conservative; the byte budget is additive and callers without estimates are unaffected.
5. **File transfer (D2, D3)** — the risky one. Lands last, behind the seeding-invariant tests, once the earlier telemetry can show its effect directly.
6. **Backlog replay (D6)** — sequenced after 4 because it depends on the checkpoint plumbing, and after 1 because its magnitude is currently unknown.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| **Lazy loaders break peer seeding** — a peer requests a file this device advertises but the loader fails | Presence derives from the registry, and a failed loader reports unavailability through the existing transfer-error path rather than hanging the requester. Explicit scenario in `file-transfer-memory-bounds`. |
| **Sequencing replicators makes first-sync feel slower** | The chain is already off the critical path (post-first-paint). Wall-clock to full reconcile may rise; time-to-interactive improves, which is what the bug report is about. Telemetry makes the trade measurable rather than assumed. |
| **Declared `estimatedBytes` is wrong** | It is a heuristic ceiling, not accounting. Over-estimating costs throughput; under-estimating degrades to today's behavior. Neither is a correctness bug. |
| **The measure-pass cap makes a legitimately-resizing row settle at a stale height** | The cap resets whenever the item list changes, and 0.5 px is below perceptual threshold. A row that genuinely changes height (expand/collapse) changes the item list state and gets fresh passes. |
| **The real cause is #7 and none of this is sufficient** | D6 and D7 target exactly that case; D7 lands first specifically so this is knowable rather than guessed. If backlog replay is the answer, the follow-up (server-side backlog compaction) is a separate change against the relay. |
| **Fixed and unfixed devices in one room** | No wire-format, protocol, or crypto change anywhere in this design. Interop is preserved by construction. |

## Open Questions

- **How large is the frame-log backlog for this room?** Unmeasurable from the client today; D7's replay telemetry answers it. This is the single largest unknown.
- **Does WKWebView keep `Blob` bytes in the WebContent process heap or in a file-backed store?** Affects how much D2/D3 actually recover on macOS specifically. Group 1's before/after RSS measurement settles it empirically without needing the answer up front.
- **What is the right default byte budget?** 256 MB is a starting point chosen to be comfortably above any single legitimate transfer and far below the observed failure. Tune from the first round of telemetry.

