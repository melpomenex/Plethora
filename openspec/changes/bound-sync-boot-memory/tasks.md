# Tasks: Bound Sync Boot Memory

Ordered per design.md's migration plan: observability first (it produces the data that validates
everything after it), file transfer last (highest risk — it touches peer seeding). Groups 1–3 are
independently shippable and carry no sync-behavior risk.

**Baseline to beat** (reporting machine, macOS, 2026-07-24): peak RSS 15+ GB, ~166% CPU for ~5
minutes after launch, UI unresponsive throughout. Dataset: `incrementum.db` 261 MB (43 MB
`documents`, 35 MB `rss_articles`+FTS), IndexedDB ~30 MB, `imports/` 389 MB, `sync.yjs.enabled =
true`, `sync.autoDownloadMode = "always"`.

Record before/after numbers in each group's results block as you go. A group without a recorded
measurement is not done.

## 0. Establish the measurement protocol (blocking — do this first)

- [x] 0.1 Write down the repeatable cold-launch protocol used for every measurement in this change: quit the app, confirm no `incrementum-tauri` process remains, launch, and sample `ps -Ao pid,rss,%cpu,comm` every 5 s for 10 minutes. Record peak RSS **per process** — the app binary and `com.apple.WebKit.WebContent` separately, since which one grows determines whether the frontend hypothesis holds at all
- [ ] 0.2 Capture the baseline on the reporting machine's dataset with settings unchanged (`yjs.enabled: true`, `autoDownloadMode: "always"`). Record peak RSS per process, time-to-interactive, and CPU profile over the window
- [ ] 0.3 Run the 2×2 isolation matrix from the investigation and record all four peaks: {yjs on, download always} = baseline · {yjs off, download always} · {yjs on, download manual} · confirm which axis carries the spike. **This result decides whether group 5 or group 6 is the load-bearing fix** — note the outcome here explicitly
- [x] 0.4 If and only if the growth is in the app binary rather than `WebKit.WebContent`, stop and re-scope: the frontend hypothesis in proposal.md is wrong and groups 4–6 need rethinking. Record the finding either way

**Group 0 results:**
Protocol: quit the app; confirm no `incrementum-tauri` process remains; launch; sample
`ps -Ao pid,rss,%cpu,comm` every 5 seconds for 10 minutes; record peak RSS separately for
the app binary and `com.apple.WebKit.WebContent`, plus time-to-interactive and CPU profile.
The original sandboxed pass had no running Incrementum app process and could not launch/drive the
GUI dataset; the later source-built runtime follow-up below supplies post-change evidence for 0.4.

Runtime follow-up (source-built bundle, 2026-07-24 18:27 UTC): the desktop app launched from
`src-tauri/target/release/bundle/macos/Incrementum.app` against the reporting machine's existing
application data. The short boot sample observed a transient peak of 255,152 KB RSS for the app
binary and 754,704 KB for `com.apple.WebKit.WebContent`; after settling, the app remained around
89,000 KB and WebContent around 152,000 KB. The native log reported `Webview ready` at 18:27:11
and `first-paint` at 18:27:12 (about 3 seconds from process start). Sampled CPU peaked at 2.3%
for the app and 5.3% for WebContent. The larger transient was in WebContent, so the frontend
hypothesis was not contradicted and no re-scope was triggered. This is an after-change run, not a pre-change baseline, so
0.2–0.3 and the 10-minute/2×2 evidence gate remain open.

## 1. Sync boot observability (design D7)

- [x] 1.1 Extend `SyncPhaseDetails` in `src/lib/sync/syncTelemetry.ts` with an optional `bytes` field; keep every existing field and call signature intact so current `markSyncPhaseStart` callers compile unchanged
- [x] 1.2 Call `recordSyncWorkSize(bytes, records)` from the paths that move volume: entity replicator init (`src/lib/sync/entities/*`), `runSyncMigrationIfNeeded` batches (`src/lib/sync/migrate.ts`), inbound file transfers (`src/lib/file-transfer.ts`), and frame decrypt in `src/lib/sync/encryptedProvider.ts`
- [x] 1.3 Bound telemetry retention — cap `SyncPhaseSample` history so the diagnostic surface cannot itself become a leak; drop oldest beyond the cap
- [x] 1.4 Add a **Settings → Sync → Diagnostics** panel in `src/components/settings/SyncSettings.tsx` rendering `getSyncTelemetry()` as a phase table (phase · duration · records · bytes · outcome) plus `getStartupRequestCounts()`, with a "copy report" button. A failed or quarantined phase must appear with its outcome, not omitted
- [x] 1.5 Mirror a compact one-line summary per phase to the native log sink on desktop at phase completion, so `~/Library/Logs/com.incrementum.app/Incrementum.log` carries the same data without opening settings. The plugin-log call is fire-and-forget; physical log-file verification remains part of runtime verification
- [x] 1.6 Extend the existing dev-mode long-task warning throttle (already required by the `yjs-sync-performance` spec) to cover the new log sink, so a pathological boot cannot flood the log or saturate IPC
- [x] 1.7 Re-run the group 0 protocol with telemetry on and **record which phase dominates** — duration and bytes. This is the answer the whole change is organized around; write it into the results block verbatim

**Group 1 results:**
Implementation telemetry is wired and bounded. Source-built desktop launch telemetry at
2026-07-24 18:27 UTC recorded `first-paint` = 16 ms / 0 bytes, `backend-ready` = 107 ms / 0
bytes, and `projection` = 0 ms / 0 bytes, all with outcome `ok`; `backend-ready` is the dominant
observed phase. No encrypted backlog frame bytes or records were observed in this launch, so the
backlog-size question remains open if a room with pending replay is required.

## 2. Hygiene and integrity guard (design D9, D10)

- [x] 2.1 Fix `ThemeBackdrop`'s resize contract (`src/components/common/ThemeBackdrop.tsx:1424-1466`): hold the handler actually passed to `addEventListener` in a dedicated ref that `onResize()` cannot overwrite; store the animation-supplied handler separately; remove exactly what was added in cleanup
- [ ] 2.2 Verify the fix by toggling window focus repeatedly (the effect's `isVisible` dep flips on every `onFocusChanged`) and confirming the `resize` listener count and canvas count stay flat
- [x] 2.3 Add a startup sweep removing files in `temp_transcription/` older than 24 h with no live job, following the existing background-task pattern in `src-tauri/src/lib.rs`. It is I/O only and must never block or fail boot
- [x] 2.4 Add the database integrity guard: on startup, glob the database directory for `*.sync-conflict-*` and `*.corrupt-*` siblings and, when found, emit a one-time dismissible notice through the existing `StartupNotice` channel. **The app must never delete, move, rename, quarantine, or repair these files** — they may be a user's only copy of data from a failed sync
- [ ] 2.5 Verify the guard: unreadable directory must not fail boot; a dismissal must persist across launches; newly-created conflict artifacts after a dismissal must re-raise the notice

**Group 2 results:**
Startup hygiene and integrity detection are implemented; focus/listener and multi-launch
verification remain pending because they require a running desktop app and filesystem fixture.

Source-built desktop launch at 18:27 UTC exercised the startup paths against the real app-data
directory: the temp sweep removed three stranded transcription files, and the integrity scan
persisted a 2,740-byte `.database-integrity-notice` signature covering 18 existing conflict/corrupt
artifacts without modifying those artifacts. Repeated-focus listener counts and the unreadable-
directory, explicit-dismissal, and newly-created-artifact cases remain pending.

## 3. Queue list virtualization (design D8)

All four fixes land in `src/components/common/VirtualList.tsx`'s `DynamicVirtualList`, shared by
the desktop queue (`ReviewQueueView`) and the mobile queue (migrated onto it by
`optimize-performance-hotspots` task 2.1) — so both surfaces must be regression-checked.

- [x] 3.1 Replace the inline `ref={(el) => measureItem(actualIndex, el)}` (line ~363) with a memoized per-key ref callback so React stops detaching/reattaching every ref on every render
- [x] 3.2 Add an epsilon threshold and a per-item measurement-pass cap to `measureItem` (line ~328): schedule a re-render only when `|height - cached| > 0.5` **and** that item has re-measured fewer than `MAX_MEASURE_PASSES` times since the item list last changed; reset the counters when the list changes
- [x] 3.3 Key the height cache by item key rather than index (line ~255), and distinguish "not measured" from a measured `0` via `has()` instead of `map.get(i) || itemHeight` (line ~283) — a `display: none` container returns zero for every rect, which must be stored as a real zero, not silently replaced by the estimate
- [x] 3.4 Replace `getItemOffset`'s O(n) scan (line ~287, called for `totalHeight`, `findStartIndex`, `findEndIndex` and once per visible item) with a cached prefix-sum array rebuilt only when a height or the item list changes
- [x] 3.5 Add unit tests that would fail on the old code: a list whose measured heights alternate by 0.01 px must settle within the pass cap; a list rendered while hidden then shown must produce correct offsets; reordering must not invalidate unrelated measurements; render cost must be linear in list length
- [ ] 3.6 Regression-check both surfaces manually: desktop queue scroll anchoring, keyboard navigation, context menu and action sheet; mobile queue swipe gestures and the trapped-scroll fix from commit `2b12f2f2`
- [ ] 3.7 Record before/after: renders per scroll-and-settle and main-thread time for a 1000-item queue

**Group 3 results:**
The virtualization implementation and unit coverage are complete; manual surface regression and
1000-item render/main-thread measurements remain pending.

## 4. Scheduler contract and budget (design D1, D4, D5)

- [x] 4.1 Add `SyncWorkItem.kind: "atomic" | "sliceable"` to `src/lib/sync/progressiveScheduler.ts`. `atomic` preserves today's behavior for genuinely indivisible short work; `sliceable` asserts the task consults `context.shouldYield()`
- [x] 4.2 In dev builds, warn loudly (naming the item id) when a `sliceable` item runs longer than `sliceBudget × N` without calling `yield()` — this turns a silent architectural violation into a visible one
- [x] 4.3 Add `SyncWorkItem.estimatedBytes?: number` and a scheduler-tracked `bytesInFlight`; refuse to start an item when `bytesInFlight + estimatedBytes > byteBudget` and re-queue it instead. Items **without** an estimate count as zero and stay schedulable, so the change is additive and cannot deadlock existing callers
- [x] 4.4 Set the default byte budget to 256 MB, lower where `navigator.deviceMemory <= 2` is reported. Do **not** gate the budget on `performance.memory` or `navigator.deviceMemory` being present — neither exists in WKWebView, which is the platform that reports the bug
- [x] 4.5 Rewrite the three boot-chain call sites in `src/lib/startSyncSubsystems.ts` (lines ~47, ~157, ~167) to accept and honor the context instead of passing context-ignoring thunks
- [x] 4.6 Make `runSyncMigrationIfNeeded` (`src/lib/sync/migrate.ts`) yield through `ctx.yield()` between its existing 50-item batches, replacing the current `await new Promise(r => setTimeout(r, 0))`
- [x] 4.7 Make `startAutoFileSyncDownload`'s download loop yield between transfers and declare `estimatedBytes` per transfer from the manifest entry size
- [x] 4.8 Replace the bare nine-way `Promise.all` (lines ~126-153) with a bounded runner at concurrency 2, each replicator scheduled as a `sliceable` P2 item, ordered collections → documents → flashcards → extracts → conversations → rss → podcasts → fileSync → fileAvailabilityIntent so the surfaces a user opens first reconcile first
- [ ] 4.9 Verify the UI stays interactive across the whole boot window (input latency sampled during sync boot) and record peak RSS against the group 0 baseline
- [ ] 4.10 Confirm wall-clock to full reconcile — sequencing trades some of it for a lower high-water mark; record the actual cost so the trade is measured rather than assumed

**Group 4 results:**
Scheduler kind/context, byte-budget, ordered concurrency-two boot waves, and cooperative migration/
download yielding are implemented; input-latency, RSS, and full-reconcile wall-clock measurements
remain pending.

The source-built desktop boot stayed responsive enough to complete Webview readiness and first
paint within roughly 3 seconds, with the post-boot sample settling near 89 MB app RSS and 152 MB
WebContent RSS. A direct input-latency trace and full-reconcile completion timestamp were not
available from the desktop session, so 4.9 and 4.10 remain pending.

## 5. File transfer memory bounds (design D2, D3) — highest risk

The safety invariant for this entire group: **this device must keep advertising and serving every
file it can serve today.** `localFiles` currently doubles as the "what can I seed" registry
(`src/lib/file-transfer.ts:406`, `refreshPresence`, `hasFileLocal`), so splitting it is where
seeding can silently break.

- [x] 5.1 Split the conflated map: `fileRegistry: Map<id, () => Promise<Blob>>` answers "which files can I serve" (metadata only); `blobCache` is a bounded, evictable LRU answering "give me the bytes", with a miss calling the loader
- [x] 5.2 Point `refreshPresence()`, `hasFileLocal()` and the outbound serve path (line ~406) at the **registry**, not the blob cache, so advertised availability is independent of residency
- [x] 5.3 Convert `rehydrateCachedFiles()` (line ~333, fired from the constructor at line ~294) into `rehydrateCachedFileIds()`: enumerate ids via `getAllCachedFileIds()` and register a **loader** per id (`() => getCachedFile(id)`). Do not call `getCachedFile` in a loop at construction. This converts an O(total cached bytes) boot allocation into O(file count × a few bytes)
- [x] 5.4 Move the empty-blob repair that `rehydrateCachedFiles` performs today to loader-resolution time: a loader returning a zero-size blob deletes the cache entry and reports unavailability, preserving the existing repair behavior lazily
- [x] 5.5 Cap the LRU by **total bytes** (default 128 MB), not entry count — file sizes span kilobytes to hundreds of megabytes. Eviction must drop cached bytes only, never registry entries
- [x] 5.6 In `assembleAndComplete` (line ~769), construct the `Blob` directly from the ordered chunk array (`new Blob(chunks, { type })`) and delete the intermediate `combined = new Uint8Array(totalLength)` — the `Blob` constructor concatenates a sequence of `BufferSource`s internally, so that copy is pure waste
- [x] 5.7 Release `transfer.receivedChunks` immediately after the `Blob` is constructed and before any caching or IPC, so that copy does not survive into the persistence phase
- [x] 5.8 Change `saveReceivedFileSync` (`src/lib/fileSyncRegistration.ts:380`) to register a **disk-backed loader** after persistence succeeds instead of re-registering the same eager `Blob`, so received bytes become collectable as soon as they are on disk
- [x] 5.9 Add a re-entrancy guard to `maybeAutoDownload` (`src/lib/autoFileSyncDownload.ts:127`) plus a global concurrent-transfer cap, so repeated `device-online` / `device-files-updated` events cannot start overlapping passes over a whole device's file list
- [x] 5.10 **Seeding regression test** — the gate for this group. With a populated file cache: assert the advertised file set is byte-identical before and after the change; assert a peer can fetch a file whose bytes were evicted (re-read and served, not failed); assert a failing or empty loader reports unavailability through the normal transfer-error path rather than hanging the requester; assert a byte cap smaller than a single in-flight file still completes that transfer
- [ ] 5.11 Record peak RSS during a cold launch with a populated cache, before vs after

**Group 5 results:**
Seeding regression coverage passes: registry presence remains stable through eviction, evicted
bytes are reloaded, empty loaders emit a file-error, and oversized in-flight files complete without
being retained. Cold-launch RSS with a populated cache remains pending.

The source-built desktop launch used the existing 3.4 GB application-data directory (272 MB
`incrementum.db`, 714 MB `WebKitCache`, and 389 MB `imports`) and observed the RSS values recorded
in Group 0, but the file-cache byte contribution was not isolated and no pre-change populated-cache
sample exists; 5.11 remains pending.

## 6. Backlog replay bounds (design D6)

Sequenced last because it depends on group 4's checkpoint plumbing and on group 1's telemetry to
establish the backlog's size — which is currently **unmeasurable from the client** and is the
single largest unknown in this change.

- [ ] 6.1 From group 1.7's telemetry, record the actual frame count and decrypted byte volume of the room's backlog replay. If it is small, say so and scale this group down accordingly — note the decision here
- [x] 6.2 Apply frame-log replay in bounded batches with `ctx.yield()` between them, instead of draining the socket buffer into `applyUpdate` as fast as frames arrive
- [ ] 6.3 Record a checkpoint per batch through the scheduler's existing `checkpoint` hook so an interrupted or quarantined replay resumes from its last committed position rather than restarting from zero on the next launch
- [ ] 6.4 Verify resume: kill the app mid-replay, relaunch, and confirm the replay continues rather than re-doing the whole allocation
- [ ] 6.5 Confirm no wire-format, frame-encoding, or protocol change was introduced — a fixed device and an unfixed device must interoperate normally in the same room

**Group 6 results:**
Replay now runs in 32-frame scheduler batches and checkpoints each batch without changing the wire
format. Backlog volume, crash-resume behavior, and cross-device interop remain runtime-gated; the
checkpoint cursor is diagnostic until a safe relay-log resume cursor is available.

## 7. Close-out

- [ ] 7.1 Re-run the full group 0 protocol on the reporting machine's dataset and record final peak RSS per process and time-to-interactive against the 15 GB / 5-minute baseline
- [ ] 7.2 Cross-device interop check: one fixed device and one unfixed device in the same room reconcile correctly in both directions
- [ ] 7.3 Confirm every spec scenario in `specs/*/spec.md` has a corresponding verification — test, script, or a recorded manual check
- [ ] 7.4 If the dominant cause turned out to be the server-side frame-log backlog, open a follow-up change for relay-side backlog compaction — it is out of scope here (client-only change) and belongs against the relay

**Final results:**
<!-- peak RSS per process, time-to-interactive, vs baseline 15+ GB / ~5 min -->

