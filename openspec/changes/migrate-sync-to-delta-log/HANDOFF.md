# Handoff: Phase 9 (Retirement) — migrate-sync-to-delta-log

Written 2026-08-03; updated 2026-08-03 after the cutover-orchestrator
wiring landed. Phases 0–8 are implemented, tested, and deployed to
production. Phase 9 (deleting the Yjs stack) has **not been started** — it
was explicitly deferred by the user, and starting it is gated on conditions
that are not yet met. Read this whole document before touching anything in
section "9. Retirement" of `tasks.md`.

## Update (2026-08-03): the cutover machinery is now wired into the app

A prior handoff noted that, although every cutover phase *function* existed
in `src/lib/sync/cutover.ts`, none of them had a production caller — so no
real room could leave `not_started` and the "drive a real room through
cutover" gate was unreachable. That gap is now closed:

- **New: `src/lib/sync/deltaLog/cutoverOrchestrator.ts`** — a boot-time
  driver that, when `deltaLogSync` is on, builds the delta-log config,
  registers the room (TOFU), starts the pull loop + WS subscription +
  presence heartbeat, and advances the room one phase per boot
  (`not_started → drained → seeded → dual → verified`). It never auto-
  advances past `verified` (P5 cutover, P6 quiesce, P7 retire stay
  user-driven; only `cutover → quiesced` is auto-polled since P6 is
  time-based).
- **Wired into `src/lib/startSyncSubsystems.ts`** (step 4b, after the
  replicators, before the first-join backfill), gated on the
  `deltaLogSync` flag. Non-fatal; a phase failure leaves the phase
  unchanged and retries next boot.
- **Supporting modules:** `src/lib/sync/cutoverTargets.ts` (drain-target
  registry), `src/lib/sync/deltaLog/seedReaders.ts` (per-domain SQLite
  seed readers carrying each row's existing HLC verbatim).
- **Flag coupling fix:** `enqueueSyncOperation` and the boot outbox-drain
  loop now also run when `deltaLogSync` is on (not only when
  `journaledProjection` is), so the P2 seed rows actually reach the
  server via the delta-log outbox publishers.
- **Tested:** `src/lib/__tests__/deltaLog.cutoverOrchestrator.test.ts`
  (8 tests) covers phase sequencing, the `deltaLogSync=false` no-op, the
  registration-failure bail-out, retry-next-boot safety, and the
  verified+ never-auto-advance boundary. Full non-server sync suite
  (52 tests) green.

What did **not** change: `deltaLogSync` still defaults to `false`, Yjs is
untouched, the relay/file-service are untouched, and rollback is safe at
every phase before P7. The orchestrator is purely additive and only runs
once a room is opted in.

This means the real-room cutover runbook below is now actually executable
from a running app (it wasn't before — there was no path to `verified`).

## Update (2026-08-03): Phase 9 prep landed — the three deletion blockers are resolved

A first attempt at "just do Phase 9" surfaced that deleting Yjs was never
the "delete 4 files" job `tasks.md` 9.1 makes it look like. Three things
made a naive deletion break the app; all three are now fixed by additive,
non-destructive prep work. **Yjs is still present and still the active
transport** — this only adds the non-Yjs capability alongside it, so the
rollback path is untouched.

**Blocker 1 (resolved): entity writes dropped without a Yjs map.**
`replicatedMap.ts::publish`/`del` and `documentReplication.ts::publishDocument`/
`deleteDocumentSync` previously ran `await ensureReady(); if (!state.map) return;`
*before* the `enqueueSyncOperation` call — so if the Yjs map wasn't bound, every
write (including the delta-log outbox enqueue) silently no-op'd. Fixed by moving
the outbox enqueue to *before* the map null-check. Verified by
`deltaLog.phase9Prep.test.ts` ("publish enqueues without a bound Yjs map").

**Blocker 2 (resolved): file-manifest had no durability.**
`FileManifest` used the Yjs `filesMap` as its authoritative store with no
SQLite projection, so a restart (or a no-Yjs build) lost the manifest. Added:
- Migration `069_add_file_manifest_entries` (`src-tauri/src/database/migrations.rs`).
- Rust commands `upsert_synced_file_manifest` / `delete_synced_file_manifest` /
  `get_file_manifest_entries` (`src-tauri/src/commands/sync.rs`, registered in
  `lib.rs`).
- An in-memory `cache` on `FileManifest`, hydrated from SQLite via the new
  `hydrateFromSqlite()` (called at construction in `useFileSync.ts`), kept in
  sync by the domain handler + `addFile`/`removeFile`. `getFile`/`getAllFiles`/
  `findByHash` now read the cache first, falling back to the Yjs map.
Verified by `deltaLog.phase9Prep.test.ts` ("survives restart via SQLite projection").

**Blocker 3 (resolved): delta-log presence helpers were unwired.**
`reportPresenceViaDeltaLog` and `getOnlineDevicesViaDeltaLog` existed (task 5.6)
but had zero production callers. Wired: `FileManifest.setDeltaLogPresenceSource`
lets the orchestrator inject config + fileKey; `updateMyPresence` now reports to
the roster when configured, and a new `refreshOnlineDevicesFromDeltaLog()`
(merged into the orchestrator's presence tick) bridges the roster into the
existing synchronous `devicesMap` read path so file-transfer peer discovery sees
delta-log-reporting peers.

**What this did NOT do:** no Yjs file deleted, no dependency removed, `deltaLogSync`
still defaults `false`. The one remaining Yjs coupling — **file-BYTE transport**
(`FileTransferManager` in `file-transfer.ts` rides the Yjs WebSocket itself for
the `0x20` file-frame protocol and `provider.awareness` for peer discovery) — is
deliberately left for a follow-up: it's a larger, separate piece (a non-WS file
transport) and was never part of the entity-replication migration. Until that's
retargeted, deleting Yjs would keep entity sync + file-manifest working but break
actual cross-device file *transfer*.

**Net effect for the next agent:** a future Phase 9 now reduces to (a) retarget
`FileTransferManager` off the Yjs WS (the one remaining piece above), (b) flip
`deltaLogSync` default to `true`, (c) the actual deletions in `tasks.md` 9.1–9.3.
Each of those is now an isolated, individually-testable change rather than one
large risky deletion. See `deltaLog.phase9Prep.test.ts` for the correctness
guarantees that hold throughout.

## Do not start Phase 9 until both of these are true

`tasks.md` line 88 gates Phase 9 on **"8.x passing and P6 quiesced"**. As of
this writing, neither holds:

1. **8.x is not fully passing.** Task 8.1 (cold-start memory on a real large
   room) and task 8.4 (three-device staged upgrade over the real relay) are
   both marked `[ ]` in `tasks.md` with the same note: they need a live app
   on real devices against a real large room, which was not available in the
   environment these phases were implemented in. Do not mark them done
   without actually running them — they are the tasks most likely to catch a
   real bug, precisely because everything else was validated against a
   synthetic/scripted server, not a live client.

2. **No real room has gone through cutover.** `deltaLogSync` defaults to
   `false` (`src/lib/sync/featureFlags.ts:46`) and nothing has flipped it for
   any production room. The cutover state machine
   (`not_started → drained → seeded → dual → verified → cutover → quiesced → retired`,
   see `src/lib/sync/cutover.ts`) has never been driven past `not_started` on
   a real room. "P6 quiesced" means: pick a real room, walk it through the
   full state machine (now drivable automatically via the boot orchestrator
   once `deltaLogSync` is on, plus the migration panel
   `src/components/sync/DeltaLogMigrationPanel.tsx` for P5/P7), let it sit in
   `quiesced` for a while under real usage with no regressions, *then* it's
   evidence the Yjs path is safe to delete. Deleting Yjs before that removes
   your only rollback path if the new sync path has a bug that only shows up
   under real usage.

If you're picking this up and neither condition is met, the right move is
usually to ask the user whether they want to do a real-room cutover first,
not to proceed to file deletion.

If the user has explicitly told you both conditions are satisfied (or to
proceed anyway), continue below.

## Real-room cutover runbook (now executable)

Now that the orchestrator is wired, walking a real room through cutover is:

1. On one device, enable `deltaLogSync` (set `VITE_SYNC_DELTA_LOG=1` at
   build, or flip the `incrementum.sync.feature-flags` localStorage entry).
   Ensure sync is paired (room secret + endpoint set) so
   `getCachedSubKeys` returns non-null.
2. On each boot the orchestrator drives that room forward one phase:
   `not_started → drained → seeded → dual → verified`. Watch the migration
   panel (Settings → Sync) for the current phase and per-domain progress.
   A phase that fails to complete retries next boot (check the console for
   `[cutover-orchestrator]` warnings).
3. Repeat on every device in the room. Once every device reaches `verified`
   (i.e. every device's published per-domain digest agrees and the whole
   roster has checked in), the panel's "Finish migration" button (P5)
   becomes clickable.
4. After P5, leave the room running. The orchestrator auto-advances
   `cutover → quiesced` once Yjs has been idle ≥14 days
   (`QUIESCE_DAYS` in `cutover.ts`). The panel then offers P7 retire.
5. Only after the room has sat in `quiesced` under real usage with no
   regressions is Phase 9 safe to discuss.

## What Phase 9 actually is

Four tasks, `tasks.md:90-93`:

- **9.1** — Remove `yjs`, `y-websocket`, `y-indexeddb`, `y-protocols` from
  `package.json`. Delete `src/lib/yjsSync.ts`,
  `src/lib/sync/encryptedProvider.ts`, `src/lib/sync/yjsCompaction.ts`, and
  the Phase 0 stop-gap code (search for comments referencing "Task 0." or
  "Phase 0" in `src/lib/sync/` — that's the temporary code that patched the
  Yjs relay's memory issue before delta-log existed, and it goes away with
  the rest of the Yjs path).
- **9.2** — Retire the forked relay: `yjs-sync/{server.js,utils.js,frameLog.js}`
  and its `docker-compose.yml` service; delete persisted frame logs. This is
  server-side — see "Production server" below.
- **9.3** — Update `openspec/project.md`: Yjs is currently listed under Key
  Libraries, Architecture Patterns, and External Dependencies. Remove those
  references once it's actually gone.
- **9.4** — Re-run 8.1 and 8.7 on the retired configuration and record the
  final numbers in this change before archiving. (8.7 is already automated
  and passing; 8.1 is the live-device measurement flagged above — you need a
  real run here, not a rerun of the automated suite.)

Before deleting anything client-side, grep for other references to the files
listed in 9.1 (`grep -rn "yjsSync\|encryptedProvider\|yjsCompaction" src/`)
— there were call sites wired into `documentReplication.ts` and the
projector split (Phase 5) that may still reference these modules even in
dual-run mode; confirm nothing outside the files being deleted imports them
before removing.

## Production server

**Host:** `leisrich@100.98.201.21`. SSH key is already authorized for this
account — `ssh leisrich@100.98.201.21` connects directly, no password.

**Sudo:** the `leisrich` account has **no passwordless/interactive sudo**
available to an agent. `sudo -n <anything>` will fail with "sudo: interactive
authentication is required." Any step below that needs root (systemd unit
edits, service stop/disable, file deletion under root-owned paths, Caddy
edits) must be staged as a copy-pasteable script and handed to the user (or
whoever holds the sudo password) to run themselves, the same way the Phase 0
+ delta-log server deploy was done. Do not attempt to obtain or bypass the
credential.

**Current state of the box (as of 2026-08-03, all verified live and
healthy):**
- `yjs-sync.service` — the forked y-websocket relay, port 1234. Still
  running, still receiving traffic (nothing has cut over to delta-log yet).
  This is what 9.2 eventually stops and deletes.
- `yjs-file-service.service` — now hosts *both* the original file-upload
  API (`/files/*`) and the new sync-log delta-log server (`/rooms/:room/ops`,
  `/rooms/:room/head`, `/rooms/:room/cursor`) on the same port, 8787. Do
  **not** delete this service in 9.2 — only `yjs-sync.service` (the relay)
  and its associated files (`server.js`, `utils.js`, `frameLog.js`) are Yjs
  and go away. The file-service process stays; only the Yjs-specific pieces
  of the deploy get removed.
- `caddy.service` — routes `sync.readsync.org`. `/files/*` and `/rooms/*`
  go to file-service:8787; everything else falls through to the relay on
  :1234. When the relay is finally retired, that catch-all `reverse_proxy
  127.0.0.1:1234` block in `/etc/caddy/Caddyfile` needs to be removed as
  part of 9.2 (or the fallback should redirect/404 rather than proxy to a
  dead port).
- **Important operational note:** this Caddyfile has `admin off` set
  (global options block, top of file) — Caddy's local admin API on
  `:2019` is disabled. That means `systemctl reload caddy` **cannot work**
  (it POSTs to the admin API, which doesn't exist) — it will always fail
  with `dial tcp [::1]:2019: connect: connection refused`. Any Caddy config
  change on this box must use `sudo systemctl restart caddy.service`, not
  `reload`. A restart causes a ~1 second connection blip (open WebSocket
  connections briefly drop) — normal reconnect territory but worth doing
  off-peak if you're being cautious about "no user inconvenienced."
- Rollback artifacts from the Phase 0 + delta-log deploy are on the server
  at `~/yjs-sync/backup-20260803-031459/` (pre-deploy `server.js`,
  `utils.js`, `frameLog.js`, `index.js`) and `~/deploy-staging/ROLLBACK.txt`
  has the exact restore procedure. These become irrelevant once 9.2 is
  actually executed (there's no "roll back to Yjs" after Yjs is deleted),
  but keep them until you're confident deletion is correct.
- `better-sqlite3` on this box is pinned to `11.10.0` exact (not `^13.x`) in
  `yjs-sync/file-service/package.json` — v13 segfaults on this box's Node
  20.20.2 (it requires Node ≥22). If you touch that `package.json` for any
  reason during 9.2 cleanup, do not let it drift back to a caret range that
  could resolve to 13.x.

## Checking real cutover state before deleting anything

`sync_cutover_state` / `sync_cutover_domain_progress` (SQLite migration 068,
client-side, see `src-tauri/src/database/migrations.rs` and
`src-tauri/src/commands/sync_journal.rs`) hold the per-room cutover phase.
There's no server-side signal for this — cutover phase is a client-local
decision per room. If you need to confirm "has any real room reached
quiesced" before proceeding, that has to come from the user (which rooms
they migrated) or from inspecting a specific user's local DB — it is not
something the server can tell you on its own, since the whole point of the
new protocol is the server never sees plaintext room state.

## Standing constraints (do not relitigate without new explicit instruction)

- Do not start any part of Phase 9 without the user explicitly telling you
  to, in this session or a future one — this was an explicit "stop here"
  from the user, not just an ordering preference.
- "I don't want any user inconvenienced" applies to any further production
  changes, same as it did for the Phase 0 + delta-log deploy.

## Update (2026-08-03): first live two-device test — transport PROVEN, one known bug

v1.99.0 shipped with `deltaLogSync=true` baked in via `.env.production` (all
users now dual-running). Immediately after release, a live two-device test
(mac + Pixel 9 Pro XL, real library: 273 docs / 1215 cards / 41 extracts /
3 collections / 64 conversations / 77 RSS feeds / 1 podcast = 1401 rows)
was run end-to-end against the production server. **The delta-log transport
is proven to work: 1401 rows pushed mac→server→phone, both devices
converged at cursor head (1408 after continued use), zero data loss, zero
dead-letters.** The CORS fix below is already deployed server-side.

### Bugs found and fixed during the live test (9 total, all in v1.99.0)

1. Native `confirm()` no-op in WKWebView → switched to `useModal().confirm`.
2. Orchestrator not triggered on room join/create → added explicit triggers
   in `SyncSettings.tsx` (`handleJoinRoom`, `handleRotateRoom`).
3. Empty sync URL silently no-op'd the orchestrator → falls back to
   `wss://sync.readsync.org` (matching the UI's behavior).
4. 19s startup lag — seed ran on boot critical path → fire-and-forget.
5. Server CORS only allowed `Content-Type`, blocking `X-Sync-*` headers →
   fixed in `yjs-sync/file-service/index.js` and **deployed + restarted
   server-side** (sudo: user ran `sudo systemctl restart yjs-file-service`).
6. Orchestrator behavior invisible — webview `console.*` doesn't surface in
   Rust stdout → routed through `@tauri-apps/plugin-log` (`orchLog`).
7. Drain gate polled GLOBAL scheduler to idle (never satisfied on a real
   library) → relaxed to bounded settle + dead-letters-only gate.
8. Missing i18n keys — all 21 `syncSettings.deltaLog.*` rendered as raw
   strings → added to `en.ts`.
9. Migration panel didn't scale on mobile → responsive Tailwind breakpoints.

### Known bug NOT yet fixed: orchestrator pull loop doesn't reliably start

**UPDATE (2026-08-03, debug-APK session):** The previously-suspected
"Android auth-key intermittency" was **disproven**. A debuggable APK build
(`tauri android build --debug`) + instrumented key derivation confirmed
both devices derive the **identical** `manifestAuthKey`
(`0c80ee7705cafb54` — first 8 bytes match exactly). The earlier 401s were
stale room-key state from broken joins, NOT a keychain round-trip bug.
A fresh install + re-join clears it permanently. **There is no auth bug.**

**The actual remaining bug:** the orchestrator's pull loop does not
reliably start on every boot. It was made fire-and-forget (`void
scheduleProgressiveSyncWork`) to fix the 19s startup lag (bug #4 above),
but this traded one problem for another: on some boots the deferred
scheduler task never executes, so `runDeltaLogPullLoop` never runs, no
ops are projected, and the phone's SQLite stays partial. Evidence:
- Phone SQLite has 1097/1215 learning_items, 0/273 documents, 0/41
  extracts — entire domains missing despite the server having all 1401+
  ops and the cursor reporting "caught up" (from a prior boot's pull).
- On boots where the orchestrator DOES start, `handleRemoteDocument` is
  never called (0 invocations logged) — because the pull loop that feeds
  the router never ran on that boot.
- The mac does NOT exhibit this (it re-runs reliably every boot).

**Suspected cause:** `scheduleProgressiveSyncWork` with `void` (fire-and-
forget) may be getting orphaned when the boot chain's `await`ed section
completes and returns — the scheduler may not drain a task that nothing is
awaiting, especially on Android where the WebView's event loop behaves
differently. The mac's WKWebView may be more aggressive about draining
microtasks/queued work.

**How to investigate next:** The orchestrator should NOT be fire-and-forget
on the critical path — but it also must not block startup (the 19s lag).
The right fix is likely: run the orchestrator in a detached but reliably-
scheduled context (e.g., `setTimeout(..., 0)` after boot completes, or a
dedicated `requestIdleCallback`, or await it but AFTER the UI is interactive
— i.e., move it past `removeLongTaskObserver()`). The key constraint: it
must run after the replicators register their handlers (so the router has
somewhere to dispatch), but not block first-paint. Test by adding
`orchLog("orchestrator task executing")` at the very top of the
`scheduleProgressiveSyncWork` `run` callback and confirming it fires on
every boot.

**Secondary issue (also contributes to disagreement):** even when the pull
loop DOES run, document projection is slow because `handleRemoteDocument`
does per-row `getDocuments()` calls for fileId dedup. A `persistedDocsCache`
fix was added (caches the snapshot for the pull burst) but wasn't fully
validated because the orchestrator-startup bug masks it. Keep this fix; it's
correct, just unproven at scale due to the upstream blocker.

### Cutover state of the test room (as of the debug session)

Room `3655fe084dd61a51b0d577181d5254e5`, secret `0Y19j4Hdy5UdKJvrcQO9H9WDKXqW2wk77np1SJqd6qA`:
- Mac: phase `dual`.
- Phone: phase `dual` (reached it on one boot), but data is partial
  (1097/1215 cards, 0/273 docs) because the pull loop didn't fully drain.
- Server: ~1429 ops, 2 active devices in roster (a stale 3rd was manually
  deleted from `device_cursor` during the test).
- Digests disagree on every domain because the phone's SQLite is incomplete.

### Server state after the test

The server's `room_auth`, `ops`, `device_cursor`, `room_seq` tables were
wiped once during the test (to clear stale auth from a key rotation) and
re-seeded cleanly. The CORS fix (`Access-Control-Allow-Headers` now includes
`X-Sync-Timestamp, X-Sync-Signature, X-Sync-Room-Key`) is live in
`~/yjs-sync/file-service/index.js` on the production box and is backed up at
`~/yjs-sync/file-service/index.js.bak-cors-*`. The running service was
restarted by the user via `sudo systemctl restart yjs-file-service.service`.

### What the next session should do (in priority order)

1. **Fix the orchestrator-startup reliability** (the known bug above). The
   fire-and-forget `void scheduleProgressiveSyncWork` doesn't reliably
   execute on Android. Move the orchestrator to a context that always runs
   after boot completes without blocking first-paint. Confirm with
   `orchLog("orchestrator task executing")` at the top of the run callback.
2. **Once the pull loop reliably starts**, the phone should fully project
   all domains. Then drive both devices to `verified` (restart until digests
   converge — they should match once the phone has all rows).
3. **Clean up stale device_cursor entries** — the server's GC
   (`DEVICE_STALE_DAYS`) should eventually exclude abandoned devices, but
   during testing it was manually deleted. Verify the GC works or lower the
   threshold for test rooms.
4. **Do NOT delete Yjs (Phase 9)** until (a) the orchestrator reliably
   starts, (b) at least one real room reaches `quiesced` after 14 days,
   AND (c) there's a plan for users whose rooms haven't retired.

## Update (2026-08-03, second debug-APK session): orchestrator-start bug fixed + 3 more real bugs found/fixed; 2 new bugs open

Picked up directly from "fix the orchestrator-startup reliability" above.
Root cause was **different** from the fire-and-forget theory: it was a
scheduler task-id collision, not a scheduling/timing issue. Four bugs
total were found and fixed this session, all confirmed via live
two-device (mac + Pixel 9 Pro XL, real production room) testing. Two
further bugs remain open (extracts domain, file-byte download). This
supersedes the "suspected cause" / "how to investigate next" guesses in
the previous update — those were wrong; here is what actually happened.

### Bug #1 (fixed): `ProgressiveSyncScheduler` domain-quarantine collision

`progressiveScheduler.ts`'s circuit breaker derives a "domain" from a
task id by taking the substring before the first `:` (`domainOf()`), and
after `maxRetries` failures on a task it quarantines that *whole domain*
— every future enqueue under it silently no-ops until `resetCircuit()`.
Many unrelated boot-time tasks across the codebase all used the `sync:`
prefix (`sync:delta-log:pull:${room}`, `sync:auto-download:${fileId}`,
`sync:queue-prefetch:...`, `sync:encrypted-frame-replay:...`, plus 7 ids
in `startSyncSubsystems.ts`) — so a failure in one unrelated `sync:*` task
(e.g. a transient auto-download failure) would quarantine the `sync`
domain and silently kill the delta-log pull loop too, with no error at
the pull loop's own call site. This is why the pull loop "didn't reliably
start" — it wasn't a scheduling bug, it was collateral damage from an
unrelated task tripping a shared circuit breaker keyed on a coincidental
string prefix.

**Fix:** renamed every task id off the shared `sync:` prefix to unique,
non-colliding names (`delta-log-pull:${room}`, `auto-download:${fileId}`,
`queue-prefetch:...`, `encrypted-frame-replay:...`, `boot-provider-setup`,
`boot-yjs-compaction`, `boot-replicator:${label}`,
`boot-auto-download-watch`, `cutover-orchestrator`,
`boot-first-join-migration`, `boot-outbox-drain`,
`boot-yjs-compaction-recurring`). Also added an unconditional
`console.warn` in the quarantine branch itself (previously silent) so
this class of bug surfaces immediately next time instead of requiring a
multi-hour live-device investigation. **Confirmed via live logcat**: the
orchestrator now runs reliably every boot.

Files: `src/lib/sync/progressiveScheduler.ts`,
`src/lib/startSyncSubsystems.ts`, `src/lib/sync/deltaLog/pullLoop.ts`,
`src/lib/autoFileSyncDownload.ts`, `src/lib/sync/encryptedProvider.ts`.

### Bug #2 (fixed): live writes silently dropped without the `deltaLogSync` gate

6 call sites (`replicatedMap.ts::publish`/`del`,
`documentReplication.ts::publishDocument`/`deleteDocumentSync`,
`localStorageSync.ts`, `file-manifest.ts::addFile`/`removeFile`) gated
their `enqueueSyncOperation` call on `getSyncFeatureFlags().journaledProjection`
only — not on `deltaLogSync`. Since the live room only has `deltaLogSync`
on, every live edit/delete on these paths silently never reached the
outbox. Found via: a live document delete on the mac produced zero
matching `sync_outbox` row. Fixed by changing each gate to
`journaledProjection || deltaLogSync`. (The Yjs-bridge-only
`registerSyncOutboxPublisher` gate at `replicatedMap.ts:197` was
deliberately left unchanged — separate concern.)

### Bug #3 (fixed): `filePath` privacy filter rejected the WHOLE document payload

`syncPrivacy.ts::isSyncPayloadSafe()` rejected an entire payload object if
it contained *any* key matching `/file[_-]?path|local[_-]?path/i`,
regardless of the value — so every document (which always has a
`filePath` key) failed the safety check and was dropped outbox-wide, not
just the field. Found via a hard contradiction: the mac's own recorded
seed progress said `documents|0|273` (273 rows read) yet the mac's
`sync_outbox` had **zero** `documents` rows ever.

**Fix (two parts, both needed):**
1. Made `isSyncPayloadSafe` value-aware: a `filePath`/`localPath` key is
   now only rejected if its *value* is a genuine local path — a portable
   URL scheme (`http(s)://`, `browser-fetched://`, `clipboard://`,
   `screenshot://`, `bundle://`) under that key is allowed.
2. That alone still wasn't enough for imported files with real local
   paths (still correctly rejected by design, but rejecting one field
   still drops the whole document) — so `filePath` is now stripped
   entirely from the wire payload (not relying on the filter) in both
   `documentReplication.ts::publishDocument` and
   `seedReaders.ts::readDocumentSeedRows`, via a new shared helper
   `isPortableFilePath()` extracted into a dependency-free module
   `src/lib/sync/filePathPortability.ts` (needed to avoid pulling
   `documentReplication.ts`'s heavy module graph — stores, i18n, Yjs —
   into `seedReaders.ts`, which broke `deltaLog.cutoverOrchestrator.test.ts`
   the first time this was tried with a direct import).

**Confirmed via live test: documents went from 1/273 → 271/271 on the
phone.** This was the core "no files transferred" symptom the user
originally reported.

### Bug #4 (fixed): `fileManifest` domain had no delta-log outbox publisher at all

Separate from Bug #2. `registerDeltaLogOutboxPublishers(...)` in
`cutoverOrchestrator.ts` was only ever called with `VERIFY_DOMAINS`
(= domains derived from `SEED_DOMAIN_READERS`, i.e. documents,
collections, extracts, learningItems, assistantConversations, rssFeeds,
podcastFeeds). `fileManifest` is deliberately excluded from
`SEED_DOMAIN_READERS` (see the doc comment at
`seedReaders.ts:171-183` — it's derived/recomputed state, not something
that needs *seeding*), but that has nothing to do with whether *live*
fileManifest writes should reach the server — and because it had no
publisher, `drainSyncOutboxBatch` left every fileManifest outbox row
"pending" forever.

**Fix:** introduced `OUTBOX_PUBLISHER_DOMAINS = [...VERIFY_DOMAINS,
"fileManifest"]` in `cutoverOrchestrator.ts`, used for the publisher
registration call only (the separate `VERIFY_DOMAINS`-based P4-verify
digest comparison was left untouched — verification and publishing are
different concerns and fileManifest still shouldn't be seeded/verified,
just live-published). Also manually backfilled 199 pre-existing local
`sync_outbox` rows for fileManifest on the mac (a one-time SQL fix for
rows that predated this bug fix; not a code change).

**Confirmed via live test: phone's `file_manifest_entries` for the test
room went from 1 → 188.**

### Bug #5 (FIXED AND LIVE-CONFIRMED; one true orphan retained): `extracts` domain never applies on the phone

The mac fully sends all 41(+dup) extracts via the outbox, and the phone's
cursor reaches server head, but the phone's local `extracts` table stayed at
0 rows. The live WebView error confirmed the root cause:
`upsert_synced_extract` fails with SQLite code 787 (`FOREIGN KEY constraint
failed`) when an extract reaches projection before its parent document exists
locally.

`createProjector` previously logged and swallowed apply failures. The router
then advanced its cursor, permanently stranding the extract even after the
document later arrived. Projector/document handlers now propagate apply
failures; the router writes failed logical operations into the durable
`sync_inbox` before advancing and retries the inbox after every page. The
cutover orchestrator also retries pending inbox work before its initial pull.
A bounded one-time migration (`070_replay_delta_log_after_projection_fix`)
resets delta-log cursors so already-affected devices replay rows skipped by the
old swallow-and-advance behavior. Unknown future domains retain their
intentional drop behavior.

Regression coverage reproduces extract-before-document ordering, verifies
durable deferral, applies the parent, retries the extract, and verifies the
inbox row is marked applied.

**Live result after installing the repaired debug APK:** the phone moved from
0 to 40 extracts. A read-only snapshot of both the desktop and phone databases
shows the same 271 documents and 40 valid extracts. The one remaining pending
extract names a parent document absent on both devices, so 41 is not a valid
referentially-integral target; it is a historical orphan rather than a missed
valid row. `extracts.ts` now preflights `get_document` before invoking the
FK-constrained upsert, so the orphan remains safely deferred without emitting
the repeated SQLite 787 Tauri-command rejection. A full desktop app restart is
required to replace its pre-existing in-memory sync singleton with this
preflight-enabled handler.

### Bug #6 (FIXED IN CODE, live verification pending): file BYTES never download to the phone despite the manifest being populated

Even after Bug #4's fix populated 188 manifest entries on the phone, its file
cache stayed empty. The trigger chain exposed two lost-trigger cases:

- `startAutoFileSyncDownload()` subscribed only to future manifest events;
  entries already hydrated from SQLite before the subscriber attached were
  never reconciled.
- If a manifest event arrived before its document row, the candidate was
  discarded because the `fileId` → document lookup had no match at that
  instant, and it was never retried.

Startup now reconciles `manifest.getAllFiles()`, unmatched manifest candidates
remain pending until the document store contains their `fileId`, and pending
state is cleared correctly on room/manifest rebuild and file removal.
`FileManifest` also emits `file-added` for remote updates, not just first
inserts. Regression tests cover both an already-hydrated manifest row and a
manifest-before-document arrival.

A related document-contract bug surfaced through the live
`upsert_synced_document` Tauri error. Old compacted rows omit fields Rust's
`Document` command argument requires even though TypeScript keeps them
optional for backward compatibility. The receiver now normalizes old rows
(`collectionId`, booleans, counts, tags, dates, file type, and object
`currentViewState`) before invoking Rust. It also promotes
`metadata.fileId` to the top-level document index and writes it back into
metadata. The Rust upsert now persists `collection_id` and
`priority_explicitly_set` along with its existing scheduling fields.

The first live repair replay (migration 070) revealed that only 1/271 phone
documents had retained `metadata.fileId`. The receiver's equal/older-clock
fast path therefore gained a metadata-only reconciliation that copies a remote
`fileId` into the otherwise-preserved local row. Migration
`071_replay_delta_log_after_document_file_link_fix` performs one additional
bounded cursor reset for already-affected clients. After 071, the phone rose
to 12 linked documents, proving the reconciliation works, but also proving
most compacted server document rows had already been overwritten by older
phone republishes without `fileId` (desktop still has 252 linked documents).

Final source-side repair: `registerExistingFilesSync` now performs a one-time,
room-scoped forced republish of unchanged file-linked documents on a device
that still owns the files. This bypasses only the ordinary unchanged-clock
optimization; outbox/server operations remain idempotent. Once the desktop is
fully restarted, those repaired rows should reach the phone at equal clocks,
where the metadata-only receiver path can restore the remaining links and the
hydrated-manifest reconciler can begin downloading bytes.

### Cleanup status

- Both temporary diagnostic blocks were removed from the local worktree:
  `deltaLog/client.ts::registerRoom` and
  `yjs-sync/file-service/syncLog/auth.js::authenticate`.
- The production server still runs the previously deployed auth diagnostic.
  Reverting it requires deploying the cleaned local server file and restarting
  `yjs-file-service.service` through the same user-authorized workflow; no
  remote mutation was performed in this continuation.
- This handoff is current through the code fixes above.

### Net status for the next session

Fixed and live-confirmed earlier: orchestrator-start reliability (#1), missing
`deltaLogSync` gates (#2), filePath privacy dropping documents (#3), and the
missing fileManifest outbox publisher (#4). Documents reached 271/271 and
`file_manifest_entries` reached 188 on the phone.

Fixed and live-confirmed: extract FK failures are durably deferred/replayed
(#5); the two live databases converge on 40 valid extracts and retain the one
true orphan safely. Fixed in code but still requiring the final source-repair
live confirmation: hydrated/early manifest entries are retained and retried,
old synced documents are normalized, equal-clock fileId linkage is reconciled,
and source devices force-republish their links once (#6). Focused TypeScript
tests pass (48/48 across document replication, file registration, extract
dependency handling, router, projector, and auto-download), `npx tsc --noEmit`
passes, migration tests pass, and `git diff --check` passes.
The broad non-server sync tests pass except for five server-backed suites that
cannot start because this checkout lacks the file-service's local `express`
dependency; that is an environment/setup issue, not a test assertion failure.

The final debug APK was built and installed in place on the Pixel 9 Pro XL
without clearing app data; migrations 070 and 071 were both observed applying
successfully. The post-071 snapshot was: 271 documents, 40 extracts, 200
manifest rows, 12 linked documents, cursor 7539, and one pending orphan
extract. Next step: fully quit/reopen the desktop app so the one-time
fileId-source republish runs, relaunch the phone, then verify linked-document
count and `imports/` file count/size grow beyond 12 and the existing single
4.2MB file. Only then mark #6 fully resolved.

Do not start Phase 9 — none of the section-105 gating conditions have changed;
the live bugs reinforce why the retirement phase must wait.

## Update (2026-08-03, current continuation): FK replay fixes, byte transfer reached, encryption pairing repair required

This continuation began from live Tauri failures for
`upsert_synced_review_result` (SQLite 787), then followed the file-byte path
all the way through an Android reader. Phase 9 remains untouched and gated.

### Bug #7 (fixed and live-confirmed): review-result foreign keys

`review_results.item_id` references `learning_items`, while
`review_results.session_id` references device-local `review_sessions`. Incoming
reviews now preflight the learning item, clear the unsyncable session id, and
project one-by-one so a delayed batch cannot acknowledge before SQLite reports
an FK failure. Rust single/batch commands also bind NULL defensively. Migration
`072_replay_delta_log_after_review_projection_fix` replays rows acknowledged by
the old delayed batch. Live result: the phone has the four current synced review
events, no pending review inbox work, and no further review-result 787s.

Files: `src/lib/sync/entities/flashcards.ts`,
`src/lib/__tests__/sync.reviews.test.ts`, `src-tauri/src/commands/sync.rs`,
`src-tauri/src/database/migrations.rs`.

### Bug #8 (fixed and live-confirmed): collection schema drift

The live Android schema lacked `collections.is_default` even though a standalone
SQL artifact included it; in-code migration 023 never added the column.
Migration `073_add_collections_is_default` adds it and marks the canonical
Personal collection. Both desktop and phone applied 073; collection inbox work
is applied and the live phone has all three collections.

### Bug #6 byte-transfer status (partly live-confirmed, final pairing repair pending)

The desktop's one-time document republish ran: phone `fileId` linkage rose from
12 to 99 documents. A further cold-start gap was fixed by resolving manifest
entries against durable SQLite documents rather than only the currently-loaded
Zustand page. Actual HTTP file transfers then began: the phone's app-private
files grew from one ~4.2 MB file to at least three files / ~50 MB.

Two device-local keys had been incorrectly replicated by the generic
`localStorageSync` domain:

- `incrementum_device_id` / sync identity keys made both devices appear to be
  the same file author, causing auto-download to skip remote files. Sync-clock
  and file-manifest identity are now backend-authoritative, startup warms that
  identity first, and the identity/HLC keys are blocklisted and purged from the
  shared settings map. Live phone identity is now its unique backend UUID.
- `incrementum_secure_storage_dev_secret` (the wrapper key protecting the
  room key in IndexedDB) was also replicated. That made the phone unable to
  unwrap the correct room key; it silently used a different room key. Evidence
  is definitive: a downloaded 507,587-byte “EPUB” is AES-GCM ciphertext, exactly
  28 bytes larger than the manifest plaintext size, has no ZIP signature, and
  the phone logs repeated encrypted-state wrong-key failures.

The second issue is now contained in code:

- the secure-storage wrapper secret is blocklisted from localStorage sync;
- encrypted file-service payloads are never returned raw when the room key is
  missing/wrong;
- received files are checked against manifest plaintext size and SHA-256 before
  a document path is updated;
- startup verifies existing local synced paths against the manifest, detaches
  bad paths without deleting their bytes, and drops their IndexedDB cache entry
  so a correctly paired device can retry;
- file-cache unregister now deletes the persistent cached blob too.

The phone still needs the correct room secret again. The safe ordinary path is
to re-pair it with the desktop's full invite code/QR after both devices are on
this build. Automated recovery would require reading the desktop's encrypted
room-key material and injecting it into the phone; do not do that without the
user's explicit authorization. Until re-pairing, wrong-key frames will continue
to be rejected and valid file bytes cannot be downloaded.

### EPUB reader bug found while validating synced bytes

The loopback URL `/epub?path=...` made epub.js treat the source as an unpacked
directory and request `/META-INF/container.xml`, failing CORS. The backend now
advertises `/epub/book.epub?path=...`, retains the legacy route, and the viewer
forces URL sources to `openAs: "epub"`. Seven Rust stream tests and five viewer
tests pass. Live Android confirmed the corrected endpoint serves the complete
archive with HTTP 200 and no CORS error; rendering cannot complete until the
phone re-downloads plaintext rather than the already-persisted ciphertext.

### Latest verification and live state

- Focused sync/viewer suite: 30/30 passed; earlier focused identity/file suite:
  62/62 passed; `npx tsc --noEmit` passes; EPUB Rust tests: 7/7.
- Migration tests and `cargo check --lib` passed earlier in the same change;
  `git diff --check` passed before the final additions and should be rerun at
  handoff completion.
- Latest hardened debug APK was built and installed on the Pixel without
  clearing app data. It contains migrations 070–073, durable document lookup,
  identity isolation, strict ciphertext rejection, manifest integrity checks,
  and the EPUB URL/archive-mode fix.
- Last converged metadata snapshot before the pairing failure was discovered:
  desktop and phone both had 271 documents, 40 valid extracts, 3 collections;
  phone had 1215 learning items, 4 current review results, 200 manifest rows,
  99 linked documents, and only the one true orphan extract pending.
- Do not count the current ~50 MB phone file footprint as successful content:
  at least the inspected EPUB is ciphertext from the broken room-key state.

Next step: re-pair the phone to the desktop room using the full invite code/QR,
restart it, let startup detach bad paths and redownload, then validate a saved
EPUB with ZIP magic (`PK`), open it in the reader, and take a final consistent
SQLite/imports snapshot. Only then mark Bug #6 fully live-confirmed.

### Follow-up live EPUB confirmation

The user retried `Meditations` on the hardened phone build. Live logs confirmed
the corrected `/epub/book.epub` endpoint returned the complete 203,835-byte
file with HTTP 200, but epub.js remained on `Loading EPUB`. A read-only check of
that exact app-private file showed the first bytes were random ciphertext
(`0e 65 fe 6c ...`) rather than the required EPUB ZIP signature (`PK 03 04`).
This confirms the reader is still attached to a payload saved by the old,
wrong-room-key build; it is not a remaining loopback routing failure.

`get_epub_stream_url` now validates the mandatory EPUB ZIP local-file signature
before starting the reader. If a synced path fails validation,
`DocumentViewer` detaches it through `clearInvalidSyncedFilePath` and renders the
download/recovery state instead of allowing JSZip to spin indefinitely. The
manual reader download path now also passes manifest size/hash expectations to
`saveReceivedFileSync`, matching the auto-download integrity boundary. This
improves the failure state but does not remove the cryptographic prerequisite:
the phone must still be re-paired with the desktop's full invite QR/code before
it can download valid plaintext.

The follow-up debug APK was then built and installed over the existing Pixel
app without clearing data. Live retry of `Meditations` produced the expected
native command rejection, `DocumentViewer` invoked
`clearInvalidSyncedFilePath`, and the phone rendered the recovery/error screen
instead of `Loading EPUB`. At the same time, preserved live logs continued to
show `EncryptedWebsocketProvider` rejecting every inbound Yjs frame with
`wrong key or tampering`. This is intentional evidence that installation did
not reset the broken state and that the remaining test is the real encrypted
re-pair/download path. The release APK also built successfully, but Android
correctly rejected installing it over the debug-signed test app; no uninstall
was performed, and the compatible debug APK was installed instead.

## Update (2026-08-03): intentional clean library and room-crypto binding repair

The user paired the phone and then deleted every item from the phone Documents
view to start over. Read-only desktop SQLite counts confirmed those deletions
were synchronized tombstones, not device-local cleanup: desktop `documents`
and `extracts` both reached zero. The user explicitly accepted that result and
will re-import the documents; do not restore the database or delete the
remaining physical files in desktop `imports` / `incrementum/documents`.

The first post-pair phone cold launch still rejected every inbound Yjs frame as
`wrong key or tampering`. The join handler was correctly persisting the scanned
secret and force-rebuilding the provider, which exposed a second historical
cache-consistency hole: the shareable room secret and the Argon2-derived room
key are separate secure-storage records, but older builds had no marker proving
they belonged together. A device could therefore display/invite with secret A
while the live provider continued encrypting with stale key B.

The crypto cache now writes an encrypted `room-binding-v1` SHA-256 commit marker
covering the room id, secret, and derived key. Every provider construction
performs a cheap binding check. A missing or mismatched marker triggers one
local Argon2 derivation from the already-cached shareable secret, rewrites the
key, and commits a fresh marker; healthy future boots avoid Argon2. The marker
is invalidated before multi-record writes so an interrupted update repairs on
the next boot. Clearing sync crypto now clears the binding too. No secret or
key is exported or logged, and Yjs/file/delta-log E2EE remains unchanged.

Verification for this repair:

- `npx tsc --noEmit` passed.
- Focused secure-storage/room-crypto/provider/join suite: 28/28 passed,
  including new legacy-missing-binding and stale-binding repair tests.
- A new debug APK was built and installed over the Pixel with data preserved.
- On the repaired cold launch the phone replayed its room IndexedDB and started
  sync subsystems without any `wrong key`, `tampering`, or encrypted-provider
  decrypt failure. The immediately preceding build emitted dozens of those
  failures on connection, so this is a live confirmation that pairing/key
  recovery converged.
- Final phone UI state was restored to Real-time sync enabled; the conditional
  `Catching up` and `Endpoint (WebSocket)` controls were visibly present.

Bug #6 is still awaiting its final content-level proof: re-import one document
on desktop, let the phone receive its manifest and bytes, confirm the saved EPUB
has ZIP magic (`PK`), and open it in the reader. The library is intentionally
empty now, so no old ciphertext should be used for that test.

## Update (2026-08-03): phone metadata catch-up starvation fix

After the desktop library was re-imported, the phone Sync panel listed files
while the Documents tab remained at zero. Sanitized live queries established
that this was not a collection filter or a failed SQLite projection:

- desktop SQLite held 171 documents and 600 file-manifest entries;
- phone SQLite held zero documents and used the correct default collection;
- the phone had no deferred document inbox rows (only one orphan extract);
- the desktop delta cursor had reached 8270, while the phone cursor was frozen
  at 7844 since before the re-import;
- the phone durable outbox still held 271 document operations plus other
  domains, even though the migration panel showed dual-run enabled.

The boot chain was the cause. Each legacy Yjs adapter was initialized as a
separate P2 scheduler item. Initializing the first large map enqueued thousands
of older P1 projections, which permanently outranked the remaining P2 adapter,
delta-orchestrator, backfill, and outbox-start items. The persisted file
manifest could therefore remain visible while the durable metadata cursor and
outbox never ran.

The fix separates live transport readiness from cutover phase advancement:

- all domain handlers now bind inside one P0 startup item before legacy replay
  can drain;
- the delta transport is prepared immediately after handler binding, while the
  heavier phase state machine remains background work;
- delta pull runs in P0 so legacy replay cannot freeze its cursor;
- the durable outbox loop starts only after the delta publisher is registered
  (preserving dual-write safety), uses bounded ten-row P0 batches, and no longer
  waits behind auto-download/backfill.

This does not weaken or bypass Yjs, room encryption, or dual-run. The phone's
pending document tombstones predate the desktop re-import upserts; server LWW
therefore keeps the newer re-imports when that backlog drains.

Verification:

- `npx tsc --noEmit` passed.
- Focused boot/cutover/router suite: 18/18 passed; `git diff --check` passed.
- The pull-loop integration test could not start its local test server in the
  sandbox; this was environmental rather than an assertion failure.
- A new debug APK was built and installed over the Pixel with paired app data
  preserved (`versionName=1.99.0`, update time 2026-08-03 06:51:08), then cold
  started.
- The tool quota blocked the final post-launch phone log/count read. Live proof
  still required: confirm the phone delta cursor advances beyond 7844 and the
  Documents tab/SQLite count becomes non-zero, then continue the EPUB byte and
  ZIP-signature validation.

## Update (2026-08-04): long live session — server confirmed healthy, real bug narrowed to documents/extracts projection, a separate unresolved orchestration hang discovered

This picked up exactly where the previous entry left off (verify cursor > 7844
and Documents non-zero). It turned into a multi-hour live debugging session on
the paired Pixel. Net result: **the server side is proven healthy and fully
caught-up; the client-side bug is now narrowed to a specific, well-evidenced
symptom (documents/extracts never project) plus a separate, still-unresolved
orchestration hang that blocks the normal boot chain from completing.** Do not
mark 8.1/8.4 or any Phase 9 gate as satisfied based on this session — nothing
here is confirmed *fixed*, only diagnosed further.

### False leads ruled out this session (in order investigated)

1. **Phone's "197 documents" were not synced data.** The phone still had a
   locally-imported library (confirmed with the user) unrelated to the
   delta-log path — zero ID overlap with desktop's 171 real documents despite
   matching titles. Wiped via the app's own bulk-delete UI for a clean test.
   This is why earlier "cursor > 7844 and Documents non-zero" was not by
   itself sufficient proof — always diff document IDs against desktop's, not
   just row counts.
2. **The keychain (`secure_storage.rs`) hang theory — real fix, wrong root
   cause.** `keyring::Entry` calls in `secure_storage_get`/`set`/`clear` were
   genuinely synchronous OS I/O run directly in `async fn` with no
   `spawn_blocking` — a real anti-pattern, now fixed (wrapped in
   `tokio::task::spawn_blocking`, `cargo check`/`cargo test` clean). **But this
   code path is dead on Android**: `shouldUseNativeSecureStorage()`
   (`src/lib/sync/secureStorage.ts:246`) returns `false` unconditionally
   whenever `isNativeMobile()` is true, so the room key always goes through
   the IndexedDB (`webGet`/`webSet`) path on mobile, never through the Rust
   keychain commands. The fix is worth keeping (correct regardless, and the
   desktop opt-in path benefits), but it did not move the stall at all when
   retested.
3. **Device resource/memory pressure.** After a full `adb reboot` (clearing
   all in-memory state from the night's testing) and a retest with **no
   debugger attached** at all, the stall reproduced identically
   (cursor frozen at 8291, 599 pending outbox rows, unchanged across 4+
   minutes). This rules out resource pressure, attached-debugger overhead, and
   Android WebView renderer instability as the cause — it is a deterministic,
   reproducible client bug.
4. **CDP measurement artifacts nearly caused false conclusions twice — worth
   recording as a lesson for the next session:**
   - `performance.getEntriesByType('resource')` silently caps at a 250-entry
     buffer by default; once full it stops recording, which looked exactly
     like "zero network activity" until `performance.clearResourceTimings()`
     + `setResourceTimingBufferSize(2000)` revealed 1000+ real IPC calls were
     happening the whole time.
   - `Runtime.enable` replays some buffered console messages to a
     newly-attached client, which momentarily looked like a mid-session
     WebView reload (a `[TAURI] Couldn't find callback id...` warning replayed
     next to a replayed `Error handler installed`). `performance.now()` /
     `performance.getEntriesByType('navigation')` on the live page proved the
     page had actually been alive continuously for 6 real minutes — no reload
     occurred.
   - adb's default `logcat` main ring buffer is only 256 KiB and gets evicted
     fast under this device's background noise (thermal/Wi-Fi/Bluetooth
     logging is extremely chatty) — a `grep` over a static `adb logcat -d`
     dump can miss real events that happened minutes ago. A **live streaming**
     capture (`adb logcat -v time | grep --line-buffered ...` started via the
     Monitor tool, or better, a CDP `Runtime.consoleAPICalled` WebSocket
     listener attached immediately after launch) is reliable; static dumps and
     `performance.getEntriesByType` snapshots are not, on this device.

### What's actually proven this session (trust these)

- **The server has everything and is fully healthy.** SSH'd to
  `leisrich@100.98.201.21`, pulled `~/yjs-sync/data/sync-log/sync-log.sqlite`
  (+ `-wal`/`-shm`) directly. For room `3655fe084dd61a51b0d577181d5254e5`:
  `room_seq` = **8292**; `ops` table has 2081 live upserts (kind=0) + 307
  appends (kind=2) + 0 live tombstones, `min(seq)=2, max(seq)=8291` (old
  superseded rows correctly GC'd by compaction). The phone's stuck cursor
  (8291) **exactly equals the max live-op seq** — i.e. before any of this
  session's experiments, the phone had already pulled the *entire* op log.
  `journalctl -u yjs-file-service.service` only logs errors (e.g. one old
  signature-mismatch entry), not successful requests, so log silence is not
  evidence of "no traffic reaching the server" — check the DB directly next
  time, not the logs.
- **Documents and extracts are the only broken domains.** On the phone, after
  wiping its local library and letting a real boot run: `collections` (3),
  `learning_items` (1097), `file_manifest_entries` (210), `rss_feeds` (77) all
  projected correctly from the pull. `documents` and `extracts` stayed at
  **0** the entire time. This is not "nothing is syncing" — it's specific to
  these two (extracts plausibly cascades from documents via the existing FK
  preflight in `extracts.ts` from Bug #5).
- **The router silently drops ops for domains with no registered handler —
  no retry, nothing written to `sync_inbox`.** `router.ts:116-120`: if
  `getDomainHandler(decoded.domain)` is `undefined`, it logs a warning and
  `continue`s — unlike a handler that *throws*, which durably defers to
  `sync_inbox` for retry (`router.ts:121-142`). Checked `sync_inbox` on the
  phone: 0 rows for `documents` (consistent with "dropped, not retried"), 1
  row for `extracts` pending (the known historical orphan from Bug #5, not
  new). This is the concrete mechanical signature of a **handler-registration
  race**: if `documentReplication.ts` (a comparatively heavy module, many
  imports) hadn't finished its top-level `registerDomainHandler("documents",
  ...)` call (`documentReplication.ts:56`, runs unconditionally at module
  evaluation time) by the moment the very first full pull processed those
  ops, every document op — and cascading extracts — would be silently and
  *permanently* lost from that pull, while lighter/faster-registering domains
  (collections, rss) succeeded. This has NOT been proven with certainty (see
  next section) but is the most concrete, well-evidenced lead going into the
  next session.

### Unresolved: `startSyncSubsystems()` hangs indefinitely, unboundedly, reproducibly

This is the actual blocker preventing further verification tonight, and it is
**separate from** the documents/extracts finding above:

- Confirmed via direct CDP `Runtime.evaluate`: calling
  `import('/assets/<startSyncSubsystems-chunk>.js').then(m => {
  m.__resetSyncSubsystemsForTest(); return m.startSyncSubsystems(); })` (both
  exported by the module — `isSyncSubsystemsStarted()` is also exported and
  useful for this exact check) **never settles**, confirmed with a real
  in-page `Promise.race` against a 70s JS-level timeout (not relying on CDP's
  own `awaitPromise`/`timeout` params, which do not reliably surface a
  response on this device/WebView — another measurement gotcha for the next
  session).
- Every individual piece tested standalone works fine: all 9 replicators
  (`ensureDocumentReplicationReady`, `ensureCollectionSyncReady`,
  `ensureExtractSyncReady`, `ensureConversationSyncReady`,
  `ensureFlashcardSyncReady`, `ensureRssSyncReady`, `ensurePodcastSyncReady`,
  `ensureFileSyncReady`, `ensureFileAvailabilityIntentReady`) and
  `ensureDeltaLogTransportReady()` all resolve when called directly via CDP.
  So the hang is in the **orchestration**, not any individual sync domain.
- `checkAndRepairCorruption()` (first await inside `getYjsSync()`) was ruled
  out by reading it — it's a synchronous `localStorage.getItem` check with no
  actual async work, cannot hang.
- Added (uncommitted, see below) a `withTimeout(getDeviceId(), 5000, ...)`
  guard around the device-identity warmup in `startSyncSubsystems.ts` — this
  was previously unguarded (the one real gap found, matching the
  `getYjsSync()` `withTimeout` pattern already used two lines below it) — plus
  `[TRACE]` console.log probes at each major step (device-identity warmup
  done, yjsSync imported, `boot-provider-setup` settled, module-imports done,
  `boot-replicators-bind` start/each-wave/exit). **After rebuilding and
  retesting, the hang was unchanged and, worse, even the very first TRACE line
  (the literal first statement in the function body, before any `await`)
  never appeared in a live CDP console capture that started within ~1s of
  process launch** — while `isSyncSubsystemsStarted()` independently confirms
  the function *was* invoked (its module-level `startPromise` guard is set
  the instant the async IIFE begins, synchronously, before any await point
  could reasonably be reached). This is either a genuine logical
  contradiction (unlikely) or evidence that CDP console capture is *still*
  unreliable for the first tick of a new page load on this device, despite
  best efforts to minimize the attach delay. Do not trust "no TRACE line
  appeared" as proof of anything without corroborating SQLite/server-side
  ground truth.
- **Leading hypothesis, not confirmed:** `scheduleProgressiveSyncWork`'s
  quarantine mechanism (`progressiveScheduler.ts`) marks a task's "domain"
  (substring of its id before the first `:`) as permanently quarantined after
  `maxRetries` failures, and **every future `enqueue()` call for that domain
  silently no-ops** (`progressiveScheduler.ts:97`) — critically, this means
  the caller's `scheduleProgressiveSyncWork(...)` promise from
  `startSyncSubsystems.ts` would **never settle** on a *subsequent* attempt,
  not just fail fast, which matches the observed unbounded hang exactly.
  Prime suspects: `boot-provider-setup` (`maxRetries: 0` — a single
  `getYjsSync()` timeout/failure quarantines it forever for the rest of that
  process) and `delta-log-pull:${room}` (`maxRetries: 3`, used by
  `runDeltaLogPullLoop` inside `startDeltaLogTransport`). This was **not**
  confirmed live — I could not find an exported way to query
  `getProgressiveSyncScheduler().health().quarantinedDomains` from outside
  the module via CDP dynamic `import()` (it isn't part of any chunk's public
  export surface). **Next session: temporarily export a debug accessor for
  scheduler health, or add explicit `console.warn` logging (already present
  at `progressiveScheduler.ts:246-249`, just needs to be watched for on a
  truly fresh page load) to confirm or rule this out directly.**
- A **non-destructive cursor-reset experiment** was run to test the
  handler-registration-race theory directly: force-stopped the app,
  pulled the SQLite file, ran `PRAGMA wal_checkpoint(TRUNCATE)` for a
  consistent single-file snapshot, set
  `sync_checkpoints.cursor = '0' WHERE domain='deltaLog:room'`, verified
  `PRAGMA integrity_check` = `ok`, pushed the file back (`cat file | adb shell
  "run-as com.incrementum.app sh -c 'cat > incrementum.db'"`), deleted stale
  `-wal`/`-shm` on-device, relaunched. This is safe to redo any time —
  documents/extracts were already empty locally, and the ops live forever on
  the server regardless of the phone's cursor. **Result: inconclusive**,
  because the same `startSyncSubsystems()` hang blocked the natural boot from
  ever re-pulling. A manual CDP-triggered `ensureDeltaLogTransportReady()`
  call (which bypasses the hung `startSyncSubsystems()` entirely and
  internally calls `startDeltaLogTransport()` → `runDeltaLogPullLoop()`) also
  did not move the cursor within a ~30s observation window — plausibly because
  `delta-log-pull:${room}` was itself already quarantined from an earlier
  failed attempt in the same page session (module-level `transportStarted` /
  `preparedTransport` caches in `cutoverOrchestrator.ts` also mean a second
  manual call in the same session may just return cached state without
  re-triggering the pull — worth explicitly resetting those via
  `__resetCutoverOrchestratorForTest()` next time before re-testing).

### Current on-device state (as of this writing)

- The paired Pixel's local `sync_checkpoints.cursor` for `deltaLog:room` is
  currently **`0`** (intentionally reset for the experiment above). It will
  climb back toward 8292+ once a working pull actually runs. `documents` and
  `extracts` are still 0 locally; nothing else was touched.
- The debug APK currently installed on the phone includes the TRACE probes
  and the `getDeviceId` timeout guard described above — **these should be
  removed before this change is considered production-ready**, but are safe
  to leave in for the next debugging session (they're `console.log`, no
  behavior change beyond the added timeout).

### Uncommitted source changes from this session (on top of prior uncommitted
work already described earlier in this file)

- `src-tauri/src/commands/secure_storage.rs`: wrapped keyring calls in
  `tokio::task::spawn_blocking` (real fix, dead code on Android, keep it).
- `src/lib/startSyncSubsystems.ts`: added `withTimeout` guard around
  `getDeviceId()` (real, worth keeping) + `[TRACE]` console.log probes
  (diagnostic only, fine to keep for now, strip before merging).
- `src/lib/sync/deltaLog/cutoverOrchestrator.ts`: added `[TRACE]` console.log
  probes inside `prepareDeltaLogTransport` (diagnostic only, strip before
  merging).
- `src/lib/sync/secureStorage.ts`: added `[TRACE]` console.log probes inside
  `getCachedRoomKey` (diagnostic only, strip before merging — also a reminder
  that this function, not the Rust keychain, is the real code path on mobile).

### What the next session should do (priority order)

1. **Confirm or rule out the quarantine hypothesis directly.** Either export
   a temporary `__debugSchedulerHealth()` from `progressiveScheduler.ts`
   (returns `getProgressiveSyncScheduler().health()`) and query it live via
   CDP on a truly fresh boot, or just watch for the existing
   `[progressive-sync] quarantining domain "..."` console warning on a fresh,
   immediately-attached CDP session (attach *before* `adb shell am start`,
   using the same near-zero-delay pattern established this session — poll
   `/proc/net/unix` for `webview_devtools_remote_<pid>` right after
   launching).
2. **If confirmed:** the real fix is likely making `boot-provider-setup` (and
   possibly `delta-log-pull:${room}`) tolerant of failure without permanently
   quarantining a task the boot chain depends on every single time — e.g. a
   higher `maxRetries`, or restructuring so a `getYjsSync()` timeout doesn't
   count as a "failure" for scheduler-health purposes (it's already handled
   as a soft-degrade via `withTimeout`'s own catch), or resetting
   `quarantinedDomains` for boot-critical task ids at the start of each
   `startSyncSubsystems()` call.
3. **Once the boot chain reliably completes**, redo the cursor-reset
   experiment (already proven safe and repeatable) to test the
   handler-registration-race theory for documents/extracts specifically. If
   documents/extracts still don't project even with the orchestration hang
   fixed, the real fix is likely ensuring `registerDomainHandler("documents",
   ...)` (and the extracts equivalent) completes — e.g. via `await
   import(...)` at a point strictly before `ensureDeltaLogTransportReady()`
   starts the pull loop, which the code *appears* to already do sequentially
   in `startSyncSubsystems.ts` (module-imports → boot-replicators-bind →
   ensureDeltaLogTransportReady, all `await`ed in order) — so if the race is
   real, look for a path where the pull loop can start *before* that
   sequence, e.g. via `runCutoverOrchestrator()`'s independently-scheduled P2
   task, or a leftover `preparedTransport`/`transportStarted` cache from an
   earlier partial boot attempt in the same session.
4. Only after both of the above are resolved and confirmed live: redo the
   full "verify cursor > previous head, Documents/extracts non-zero with IDs
   matching desktop's" check from scratch (a locally-imported library got
   wiped this session specifically to make that check clean), then continue
   to the EPUB byte/ZIP-signature validation this change has been blocked on
   for several sessions now.
5. Strip the `[TRACE]` probes (keep the `getDeviceId` timeout and the
   `secure_storage.rs` `spawn_blocking` fix) before considering any of this
   committable.

Do not start Phase 9 — none of the section-105 gating conditions have changed;
if anything, tonight surfaced a new, currently-blocking orchestration bug that
makes the Yjs rollback path more important to keep working, not less.

## Update (2026-08-04, continuation): boot hang root-caused and fixed — scheduler starvation, not quarantine

Picked up from "confirm or rule out the quarantine hypothesis". **The
quarantine hypothesis is disproven.** No `[progressive-sync] quarantining
domain` warning ever appeared on a live boot, and the boot chain's own TRACE
probes localised the hang exactly. The real cause is scheduler starvation, and
it fully explains the user-visible symptom ("documents sync but never land in
the database, so they don't show up in the interface").

### How the evidence was obtained (reusable recipe)

The app already installs a `[consoleLogcatBridge]` that forwards every webview
`console.*` call to logcat, so the previous sessions' CDP-console troubles are
avoidable — just read logcat:

```bash
adb logcat -c && adb shell am force-stop com.incrementum.app
adb shell monkey -p com.incrementum.app -c android.intent.category.LAUNCHER 1
# …wait…
adb logcat -d -v time | grep -E "webview:"
```

CDP is still useful for poking at state; note it needs
`suppress_origin=True` on the websocket handshake or Chrome answers 403, and
the forward must be re-established after every relaunch (the abstract socket
name embeds the pid: `adb shell cat /proc/net/unix | grep webview_devtools`).

`window.__TAURI__.core.invoke` is reachable from CDP, which makes the
cursor-reset experiment a one-liner instead of a 234 MB DB round-trip:
`invoke("set_sync_checkpoint", {domain:"deltaLog:room", cursor:"0", shard:null})`.

### Root cause 1: a sliceable work item holds the whole scheduler

`ProgressiveSyncScheduler.drain()` is non-reentrant (`if (this.running) return`)
and stays inside `await item.run(context)` until the item **returns**.
`context.yield()` yields to the *host*, not to the scheduler — the drain loop
cannot pick a different item while a yielded item is still on the stack.

`EncryptedWebsocketProvider.drainInboundReplay` (lane P1) looped
`while (this.inboundReplayQueue.length > 0)`, yielding between batches of 32
but never returning while frames remained. With a large relay backlog (this
room's `encrypted-frame-replay` checkpoint is at 82102) that item owned the
drain loop indefinitely, so **no other lane ever ran — including P0**. Live
proof: `boot-replicators-bind` (lane P0, the item that binds every delta-log
domain handler) was enqueued at 20:31:18.470 and its `run()` had still not been
entered 90 s later.

Fixes:
- `shouldYield()` now also returns true when a strictly higher lane has queued
  work (`hasHigherPriorityWork`), so cooperative items get a real preemption
  signal rather than only a deadline.
- `drainInboundReplay` **returns** on `shouldYield()` instead of yielding in
  place. `scheduleInboundReplay`'s existing `.finally` re-enqueues it, so
  progress is preserved slice by slice.
- `schedule()` posts at `user-visible` priority when P0 work is queued
  (`background` otherwise). Boot-critical work was being posted at `background`,
  which on Android cost seconds even when the loop was free.
- `schedule()` no longer wedges permanently if `scheduler.postTask` rejects
  (the `scheduled` flag would have stayed `true` forever).

### Root cause 2: awaiting a P3 item on the boot critical path

`startSyncSubsystems` **awaited** `boot-yjs-compaction` (lane P3) before the
entity-module imports. P3 only wins a slot once every other lane is empty, so
under root cause 1 the chain stopped there permanently: no entity modules
imported, no domain handlers registered, no delta-log transport, no outbox
drain. Proven by flipping the supported debug override
(`localStorage["incrementum.sync.feature-flags"] = '{"yjsCompaction":false}'`):
with compaction skipped the identical build ran the chain to completion —
replicators bound, transport started, orchestrator advanced.

Fix: the boot compaction is now fire-and-forget. Nothing below reads its
result; it is a pure cold-boot optimisation.

### Root cause 3: the router silently dropped ops and then advanced the cursor

`applyDeltaLogPage` logged and `continue`d when a domain had no registered
handler, and `runDeltaLogPullLoop` checkpoints the room cursor after each
applied page — so a dropped op was **never re-delivered**. Combined with the
two causes above (handlers not yet bound while a pull was running from an
earlier session's orchestrator entry), this is precisely how the phone reached
server head with `documents` = 0 and **zero** `sync_inbox` rows for
`documents`: the ops were pulled, dropped, and the cursor moved past them.

Fix: an op with no registered handler is now durably deferred into
`sync_inbox` (the same path a *throwing* handler already used) instead of
dropped. `replayPendingDeltaLogInbox` retries after every page and on every
boot, so a late-registering domain self-heals; a genuinely unknown future
domain stays pending rather than stalling the page. This makes handler
registration timing a non-issue permanently.

### Measured on-device state that led here (room 3655fe084dd61a51b0d577181d5254e5)

Phone SQLite before the fixes, after a full re-pull from cursor 0 to head:
`documents` 0, `extracts` 0, `collections` 3, `learning_items` 1097,
`rss_feeds` 77, `file_manifest_entries` 210; `sync_checkpoints.deltaLog:room`
= 8291 (= server head); `sync_inbox` = 2 applied collections + 1 pending
extract (the known historical orphan) and **nothing for documents**; durable
outbox still holding 639 pending + 283 coalesced `documents` rows because
`startOutboxDrainLoop()` is only reached after the transport starts.

### Files changed this session

- `src/lib/sync/progressiveScheduler.ts` — preemption signal, P0 host
  priority, postTask-failure fallback, `queuedIds` consistency on the
  input-pressure unshift path, and `enqueue` now reports why it dropped an
  item so `scheduleProgressiveSyncWork` **rejects** instead of returning a
  forever-pending promise (this silent-drop path is what made every previous
  session's investigation look like an unexplainable hang).
- `src/lib/sync/encryptedProvider.ts` — replay returns on `shouldYield()`.
- `src/lib/startSyncSubsystems.ts` — boot compaction no longer awaited.
- `src/lib/sync/deltaLog/router.ts` — durable deferral for unhandled domains.
- Tests: `progressiveScheduler.test.ts` (+2), `deltaLog.router.test.ts`
  (the old "drops an op" test now asserts deferral + late-handler replay,
  plus an unknown-future-domain case).

`npx tsc --noEmit` clean; 512 tests pass. The 5 failing test files are the
pre-existing server-backed suites that cannot start in this checkout (missing
the file-service's local `express`), not assertion failures.

### Root cause 0 (found after the first fixed build): `postTask` background priority is a black hole on Android WebView

The first fixed build still did not run `boot-replicators-bind`. A direct CDP
measurement on the live page settled it:

| host call | result |
| --- | --- |
| `scheduler.postTask(cb, {priority:"user-blocking"})` | ran in 0 ms |
| `scheduler.postTask(cb, {priority:"user-visible"})` | ran in 31 ms |
| `scheduler.postTask(cb, {priority:"background"})` | **never ran (>5000 ms)** |
| `requestAnimationFrame` | ran |
| `requestIdleCallback(cb, {timeout:1000})` | ran at 1020 ms (via its timeout) |

`ProgressiveSyncScheduler.schedule()` posted **every** drain at `background`
priority and latched `this.scheduled = true` until the callback fired. On
Android WebView 150 that callback does not fire while the page has work — so
the first `schedule()` after boot wedged the scheduler for the rest of the
session, and every later `enqueue()` returned without ever draining. This is
the deepest cause: the progressive scheduler was effectively dead on Android
whenever the page was not perfectly idle, which is why sync work only ever
progressed opportunistically and why lane priorities appeared not to matter.

Fixes:
- `hostPriority()` now returns `user-blocking` when P0 work is queued and
  `user-visible` otherwise. `background` is never used again — deferring to
  the page is enforced by the slice budget, the `visible()`/`inputPending()`
  checks and `shouldYield()`, not by a priority the host may never schedule.
- `schedule()` arms a 250 ms watchdog `setTimeout` alongside the host call and
  makes the drain callback idempotent, so no single un-invoked host callback
  can ever strand the queue again.
- Regression test: "still drains when the host never invokes a posted task".

Reproduce the measurement any time with CDP `Runtime.evaluate` against the
live page — it takes seconds and is far more reliable than reading logs.

### LIVE CONFIRMATION (2026-08-04): documents now project on the phone

Cold boot of the fixed debug APK on the paired Pixel, room cursor manually
reset to 0 first:

| | before | after |
| --- | --- | --- |
| boot chain | stopped at "about to import entity modules", never resumed | completes; replicators bind, transport starts, orchestrator advances |
| room cursor | 8291, frozen | 0 → 8298 (server head) in one boot |
| `documents` | 0 | 308 upserts applied, settling at 95 live rows after the log's tombstones |
| `sync_inbox` extracts | 41 deferred | 1 (the known historical orphan) |
| `sync_inbox` documents | 0 rows despite 0 documents (silent loss) | n/a — nothing lost |

One regression the deferral change introduced was caught here and fixed:
`__verify` (the P4 digest control-plane domain) has no handler by design, so
every digest op was being deferred — 314 useless `sync_inbox` rows in a single
pull, which would eventually crowd out real deferred rows inside
`get_pending_sync_inbox`'s 500-row window. `router.ts` now never defers
`__`-prefixed reserved domains (`isInternalDomain`), with a regression test.
The 314 stale rows already written on the test device were marked applied.

### Still open: EPUB files do not open on the phone (user-reported, this is Bug #6, not a regression)

With metadata finally syncing, the next layer of Bug #6 is now visible from
the UI: opening an EPUB shows the `viewer.documentTypePreviewComingSoon`
fallback (`DocumentViewer.tsx:6913`), which is the branch taken when
`docType === "epub"` but neither `fileData` nor `epubUrl` is set — i.e. the
document row exists but its bytes were never downloaded.

Measured cause, and it is upstream of the download logic:

- Phone: 95 documents (85 EPUB), 210 `file_manifest_entries`, **0 documents
  with a `fileId`** — so nothing can match a manifest entry to a document and
  auto-download has no candidates.
- Every synced document on the phone has `metadata` = **NULL**. `fileId` lives
  only inside `metadata` (the `documents` table has no `file_id` column), so
  losing `metadata` loses the linkage.
- Desktop locally: 171/171 documents have `metadata.fileId`. But its outbox
  payloads are a mixed bag — 1105 document rows, 806 with a fileId, and the
  most recent row for a still-linked document carries
  `metadata.fileId: null`. The phone's own outbox is likewise mixed (293 rows,
  50 with no metadata at all).
- So the row that won LWW on the server for these documents was published by a
  device whose local copy had no metadata, and the sender-side
  unchanged-clock optimisation in `publishDocument`
  (`syncClockCache.isStale` → early return) then prevents either device from
  ever correcting the record, because `dateModified` never advances.

The shape of the real fix is a merge concern, not a transport one: `metadata`
(and `fileId` specifically) must not be clobbered by a whole-row LWW write
from a publisher that does not have it. Candidates, in rough order of
preference:

1. Treat `fileId` as a field that only ever moves absent → present in
   `handleRemoteDocument` (never present → absent), mirroring how `filePath`
   and `coverImageUrl` are already preserved there, AND strip `metadata:
   null` / `fileId: null` from the wire in `publishDocument` /
   `readDocumentSeedRows` so an ignorant publisher stops overwriting.
2. Give `fileId` its own field clock (the projector already supports
   `fieldClocks`), so it is merged independently of the row clock.
3. A one-time forced republish from the device that owns the files, as was
   done before — necessary regardless to repair the rows already on the
   server, but on its own it is only a patch: the next unchanged-clock write
   from a device without metadata will wipe them again.

Do not treat the EPUB reader itself as suspect here — the viewer is correctly
reporting that it has no bytes, and the loopback `/epub/book.epub` +
ZIP-signature work from the earlier session is unchanged.

### fileId-linkage fix implemented (code + tests green; NOT yet live-confirmed)

Option 1 from the list above is now implemented, plus the repair trigger:

- `documentReplication.ts::handleRemoteDocument` — `fileId` is now an
  absent → present-only field. A newer remote row that carries no fileId (or
  no metadata at all) keeps this device's link instead of blanking it, the
  same way `filePath`/`coverImageUrl`/`currentViewState` are already
  preserved. The remote row still wins on every other field.
- `documentReplication.ts::publishDocument` and
  `seedReaders.ts::readDocumentSeedRows` — never put `metadata: null` on the
  wire; omit the key so the receiver keeps what it has.
- `fileSyncRegistration.ts` — `FILE_ID_REPUBLISH_REPAIR_VERSION` bumped
  `v1` → `v2`, which re-arms the existing bounded one-time forced republish of
  file-linked documents on every device that owns files. This is what repairs
  the rows already poisoned on the server; the merge rule above only stops it
  recurring.
- Regression test: "never unlinks a local fileId when a newer remote row
  carries no metadata" (`documentReplication.test.ts`).

`npx tsc --noEmit` clean; 515 tests pass (same 5 pre-existing server-backed
suites cannot start). **Not verified on a device** — this landed after the
last APK was installed.

To confirm it: rebuild and install on BOTH devices (the desktop is the one
that owns the files and must run the v2 republish), fully restart the desktop
app so `registerExistingFilesSync` runs, then on the phone check that
documents with a `fileId` climbs above 0 and that
`imports/` starts growing. Only then open an EPUB and validate the ZIP magic
(`PK`) as the earlier sessions set out.

### Build/verify recipe used this session (saves ~30 min next time)

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
       ANDROID_SDK_ROOT=$ANDROID_HOME \
       NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
npx tauri android build --debug --target aarch64     # ~20 min
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

`npx tauri android build` fails immediately with "failed to ensure Android
environment" unless those three variables are exported — they live in
`~/.zshrc` but are not picked up by a non-interactive shell.

## Update (2026-08-04): CRITICAL — historical Yjs tombstones cover the entire desktop library

Discovered immediately after the boot-chain fix landed, while investigating
the user's "EPUB won't open" report. **This is the most dangerous thing in
this change and must be read before any device is upgraded.**

The phone's document count fell 95 → 4 within minutes of the fixed build
running. It was NOT the delta log: the room cursor moved only 8298 → 8305
(7 ops) in that window, and the phone's durable outbox still shows
`documents/delete` = 635 **pending**, 4 coalesced, 0 sent. The deletions came
from the **Yjs `documentsMap` replay**, which applied the historical
tombstones written when the user bulk-deleted the phone's library earlier in
this change.

Those tombstones are not confined to the phone's own rows:

```
phone sync_outbox documents/delete distinct keys : 639
desktop documents                                : 171
intersection                                     : 171   ← ALL of them
```

The earlier session's note that the phone's wiped library had "zero ID
overlap with desktop's 171 real documents" is **wrong** — by the time it was
wiped, those rows had been synced from the desktop and carried the desktop's
ids. Deleting them produced tombstones for the desktop's entire library.

The desktop has survived only because it has the *same* scheduler bug: its
boot chain hangs before `ensureDocumentReplicationReady()` binds the Yjs map,
so the replay never runs. **Installing the fixed build on the desktop while it
is still joined to room `3655fe084dd61a51b0d577181d5254e5` will delete all 171
documents**, exactly as it did on the phone. Do not do it.

Protective actions already taken:
- Phone app force-stopped, so none of the 635 pending delete ops publish.
- Desktop DB backed up (verified 171 documents / 1097 learning items) to
  `~/incrementum-db-backups/incrementum-desktop-<timestamp>.db` (+ `-wal`).
- Confirmed the desktop app was not running and its EPUBs are intact on disk
  (`/Volumes/external/Books 2/`, 171 rows with a non-empty `file_path`).

### Agreed remedy: a fresh room seeded from the desktop

The user chose this over purging the server or guarding the replay. It is the
only option that discards both poisoned things at once — the tombstones AND
the `metadata`/`fileId`-less document rows — because a new room id means a new
Yjs doc name (y-indexeddb is per-room scoped) and a new delta-log stream.

Order matters; the desktop must leave the old room BEFORE it runs a build
whose boot chain completes:

1. **Desktop, on its CURRENT (unfixed) build** — Settings → Sync → rotate to a
   new code. This is safe on the old build precisely because
   `handleRotateRoom` does *not* await `startSyncSubsystems()`
   (`SyncSettings.tsx:290`) and `createNewSyncRoomId()` persists the new room
   id to localStorage synchronously (`yjsSync.ts:94`). Nothing replays. Record
   the new invite code/QR. Quit the app.
2. Build + install the fixed desktop build. Launch. It boots against a new,
   empty room, binds the replicators, and seeds all 171 documents — which
   locally still carry `metadata.fileId` — into a clean log and clean Yjs doc.
3. **Phone** — clear app data (this also discards the 635 pending delete ops
   and the old room's Yjs IndexedDB), install the fixed APK, pair with the new
   invite code.
4. Phone pulls metadata, links manifest entries by `fileId`, downloads bytes.
   Then validate a saved EPUB's ZIP magic (`PK`) and open it in the reader —
   the content-level proof Bug #6 has been waiting on for several sessions.

### Also fixed here: the room cursor was never reset on a room switch

`resetDeltaLogCursors` (checkpoints.ts) had **zero production callers**, so
after step 1 the desktop would have carried cursor 8270 into the new room —
and since seq numbers are per-room, every `pull(since = 8270)` against a
fresh room returns an empty page forever. The desktop would have seeded the
new room and then silently never received anything back from the phone.

The cursor is now scoped to its room: `setRoomCursor` records the room in the
checkpoint's `shard` column and `getRoomCursor(room)` restarts from 0 on a
mismatch. A checkpoint written by an older build (`shard` = null) is treated
as belonging to the current room, so upgrading does not force a re-pull.
Callers in `pullLoop.ts` and `cutoverOrchestrator.ts` now pass `config.room`.
Tests: `deltaLog.checkpoints.test.ts` (3).

## Update (2026-08-04, third continuation): fresh-room cutover executed live — delta-log document metadata PROVEN end-to-end, two real code bugs found

This session executed the fresh-room remedy the previous handoff agreed on,
and in doing so proved the delta-log transport carries real document metadata
end-to-end (desktop → server → phone, 370 documents) for the first time. Two
real code bugs were found and one is still open. The fresh room is
`21d60302aeb9d080c2d5727ea9959565`, secret `Sx6-7DOEOfW1Px8dAlgDu8qDMTO0HlNoqeAY62YJGxo`.

### The old room's crypto was irrecoverably split three ways

Room `3655fe084dd61a51b0d577181d5254e5` could not be repaired. Verified by
decrypting the desktop's secure-storage IndexedDB blobs (dev secret
`FWxcjMDsdPHC96Cl78tGdcAgmvzdEgWHzdvpafUDMHs=`, AES-GCM under the per-device
`incrementum_secure_storage_dev_secret` localStorage key) and independently
re-deriving the keys with the app's own Argon2 params:

| source | room key (hex) | manifestAuthKey first 8 bytes |
|---|---|---|
| Argon2(stored secret) | `244d6a69...` | `8d25fcf8` |
| stored key on desktop disk | `2b718f9e...` | `643720b3` |
| server `room_auth.auth_key` | — | `0c80ee77` |

Nothing matched anything. The desktop's own stored secret did not derive to
its own stored key, and neither matched the server. Re-pairing to this room
was impossible. The user rotated to a fresh room via the desktop UI.

### Bug #9 (real code bug, NOT yet fixed): `deriveSubKeys` swaps manifestAuthKey and roomIndexKey

`src/lib/sync/encryption.ts:190-212`: the destructure assigns `manifestAuthKey
← authRaw` (info `incrementum-sync/auth-v1`) and `roomIndexKey ← indexRaw`
(info `incrementum-sync/index-v1`). These are **reversed**. The
`manifestAuthKey` field — which `registerRoom` exports and sends as
`X-Sync-Room-Key`, and which the server registers in `room_auth` — actually
holds the `auth-v1` derivation, while `roomIndexKey` holds the `index-v1`
derivation.

Confirmed live by hooking `crypto.subtle.deriveBits` via CDP on the phone:
the orchestrator's HKDF log showed `index-v1 → c0e0efa7...` but the request
sent `X-Sync-Room-Key` = `auth-v1 → 622397e6...`. The field name and the
bytes disagree.

This has been silently wrong the whole time: it only "worked" when the same
buggy derivation both registered AND verified (the registering device and the
verifying device both use the `auth-v1` bytes under the `manifestAuthKey`
name). It breaks the moment an external tool registers the server with the
correct `index-v1` key (which is what the design doc and the variable names
imply is correct). **Workaround applied this session:** the server was
registered with the `auth-v1` key the app actually sends, so the live test
proceeds. The real fix is to swap the two assignments in `deriveSubKeys`,
but that invalidates every existing `room_auth` registration (each room
would need re-registration under the corrected key) — so it must be
coordinated with a migration, not flipped in place.

### Bug #10 (real, fixed live): room-cursor shard not reset on room switch (null-shard edge case)

After rotating to the new room, the phone's `sync_checkpoints.deltaLog:room`
cursor stayed at `8357` with `shard = NULL`. The room-scoped reset logic
treats a null shard as "belongs to current room" (so upgrades don't
re-pull), which meant the phone kept requesting `pull(since=8357)` against a
fresh room whose head was <300 — returning empty pages forever. Fixed live
by resetting the cursor to 0 via `invoke('set_sync_checkpoint', {domain:
'deltaLog:room', cursor:'0', shard:'<newroom>'})` through CDP. The phone then
pulled all 370 documents in one burst. This null-shard-on-rotate path needs
a code fix: `rejoinRoom`/`handleRotateRoom` should explicitly reset the
delta-log cursor (call `resetDeltaLogCursors`, which exists but still has
zero production callers per the prior handoff).

### Bug #11 (operational, worked around): desktop `startPromise` singleton across room rotation

The desktop's `startSyncSubsystems()` caches its result in a module-level
`startPromise`. After rotating the room, the running process's `startPromise`
was already resolved (against the old room), so the delta-log transport and
outbox drain never re-initialized for the new room — the outbox stayed
frozen. A clean quit + relaunch (fresh process, `startPromise = null`) ran
the full boot chain correctly. Not a code bug per se, but `handleRotateRoom`
should tear down and re-run the sync subsystems against the new room rather
than relying on the singleton having not yet been set.

### Live test result (room 21d60302..., 2026-08-04)

- **Desktop:** booted clean, delta-log transport started (`boot-trace`
  confirms every step), cutover advanced `not_started → drained → seeded`,
  outbox drained 370 documents + 171 fileManifest entries to the server
  (server reached 1635+ ops).
- **Phone:** re-paired, `registerRoom` 200 (after the Bug #9 workaround),
  cold-booted, cursor reset, **pulled all 370 documents via the delta log**
  (cursor 0 → 1766+), 171 documents gained `fileId` linkage, 72+ manifest
  entries for the new room arrived on the phone.
- **File bytes:** desktop uploaded 341 EPUB files to the file-service under
  the new room's dir (`/files/21d60302.../<fileId>.bin`); a direct HTTP GET
  returned 200 with a 77 MB body. **Downloadable.**

### Still open: phone auto-download not triggering after the bytes arrive

The phone's `autoFileSyncDownload` reconciler did not re-attempt downloads
after the file bytes landed on the server. The initial attempts 404'd (bytes
not yet uploaded), and once the bytes were available no retry fired — the
reconciler subscribes to *new* manifest events but does not re-evaluate
already-seen entries whose prior download failed. `startAutoFileSyncDownload`
reconciles `manifest.getAllFiles()` on startup (per the Bug #6 fix), but the
phone's cold boot after the bytes arrived still produced zero downloads —
the reconciler may be gating on `isYjsSyncEnabled()` (which is false on the
phone until the user toggles real-time sync, same as the desktop's
`registerExistingFilesSync` gate), or the file-key decryption is failing
silently. **Next session:** enable real-time sync on the phone (Settings →
Sync → toggle), then check whether auto-download fires; if not, trace the
`startAutoFileSyncDownload` reconcile path and the `downloadRoomFile` →
`saveReceivedFileSync` integrity check.

### Boot-trace probes added (strip before merge)

`src/lib/startSyncSubsystems.ts` now has a `bootLog()` helper that routes
through `@tauri-apps/plugin-log` (so it surfaces in `Incrementum.log`,
unlike plain `console.log` which does NOT appear in the Rust stdout). Tracer
calls at: singleton guard, boot-provider-setup schedule/enter/settle,
null-sync early return, deltaLogSync flag check, transport ready, outbox
drain start. These confirmed the boot chain completes on a fresh process.
**Strip these (or keep `bootLog` but remove the call sites) before
considering this change committable.** They are diagnostic only.

### Server registration procedure (reusable)

To register a fresh room's auth key on the server (when the desktop's
outbox/transport hasn't drained yet, or to correct a wrong TOFU registration):

```bash
# 1. Delete any existing (wrong) registration:
ssh leisrich@100.98.201.21  # then on the box:
cd ~/yjs-sync/file-service && node -e '
const Database = require("better-sqlite3");
const db = new Database("data/sync-log/sync-log.sqlite");
db.prepare("DELETE FROM room_auth WHERE room=?").run("<ROOM>");
console.log("deleted"); db.close();'

# 2. Re-register with the key the app actually sends (Bug #9: that's the
#    auth-v1 HKDF, NOT index-v1, until deriveSubKeys is fixed):
node -e '
const crypto = require("crypto");
const ROOM="<room>"; const KEY_HEX="<32-byte room key hex>";
const salt=Buffer.from(ROOM,"utf8");
// NOTE: use "incrementum-sync/auth-v1" here (what the app sends), NOT index-v1,
// until the deriveSubKeys swap bug (#9) is fixed.
const mak=Buffer.from(crypto.hkdfSync("sha256",Buffer.from(KEY_HEX,"hex"),salt,Buffer.from("incrementum-sync/auth-v1"),32));
const path=`/rooms/${ROOM}/head`, ts=Date.now();
const msg=Buffer.concat([Buffer.from("GET"),Buffer.from([0]),Buffer.from(path),Buffer.from([0]),Buffer.from(String(ts)),Buffer.from([0])]);
(async()=>{const k=await crypto.subtle.importKey("raw",mak,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
const sig=Buffer.from(await crypto.subtle.sign("HMAC",k,msg)).toString("hex");
const r=await fetch(`https://sync.readsync.org${path}`,{method:"GET",headers:{"X-Sync-Timestamp":String(ts),"X-Sync-Signature":sig,"X-Sync-Room-Key":mak.toString("base64")}});
console.log("register:",r.status);})();'
```

Do not start Phase 9 — the delta-log path is proven for metadata but file
byte download is not yet live-confirmed on a device.

## Update (2026-08-04, fourth continuation): EPUB file-byte download PROVEN end-to-end — two more real bugs found and fixed

Following the third continuation's fresh-room cutover, two more bugs blocked
the final step (downloading actual EPUB bytes from the server to the phone).
Both are fixed and the full chain is live-confirmed: an EPUB downloads from
the file-service, decrypts to valid `PK\x03\x04` plaintext, saves to disk,
and the document's `file_path` is set.

### Bug #12 (fixed, committed): `YjsFileDownload.encrypted_metadata` serde casing mismatch

`src-tauri/src/commands/yjs_file.rs`: the `YjsFileDownload` struct field is
`encrypted_metadata` (snake_case). Without a `#[serde(rename_all)]` or
per-field rename, Tauri serializes it as `encrypted_metadata` over IPC. But
the TS layer (`yjs-file-service.ts:161`) reads `dl.encryptedMetadata`
(camelCase). The field was **always null** in the JS, so the receiver never
got the decryption sidecar — `downloadRoomFile` fell through to the
plaintext branch, returning raw ciphertext (which `saveReceivedFileSync`
would have saved as a corrupt "EPUB"). Verified: a 77 MB download returned
`firstBytes = 3f2f6143` (`?/aC`, ciphertext), not `504b0304` (`PK`).

**Fix:** `#[serde(rename = "encryptedMetadata", alias = "encrypted_metadata")]`
on the field. Verified via CDP: the response now has `encryptedMetadata`
(272 chars, the AES-GCM nonce+contentType sidecar), and the bytes decrypt to
`PK\x03\x04`. The header itself (`x-encrypted-metadata`, sent by the server)
was always correct — `reqwest`'s case-insensitive `headers().get()` read it
fine; only the IPC field name was wrong.

### Bug #13 (fixed, committed): `list_documents_summary` NULLed out metadata, hiding fileId from auto-download

`src-tauri/src/database/repository.rs`: both `list_documents_summary` and
`list_documents_summary_by_collection` used `NULL AS metadata` in the SELECT
(to shrink IPC payloads — content/content_hash are genuinely large). But the
auto-download reconciler (`autoFileSyncDownload.ts:82`) builds its
`fileId → document` index from `getDocuments()` → `doc.metadata.fileId`.
With metadata NULLed, **every synced document had `fileId: undefined`** in
JS — the reconciler could never match manifest entries to documents, so no
download ever fired. Verified: SQLite held 171 docs with `fileId` in their
metadata column, but `get_documents` returned `metadata: null` for all of
them (`withFileId: 0`).

**Fix:** include the `metadata` column in the summary SELECT (it is small
JSON — the sparse DocumentMetadata object — unlike content/content_hash
which stay NULL). Parse it into `Option<DocumentMetadata>` and populate the
struct field. Verified: `get_documents` now returns `withFileId: 171`.

(Note: there are TWO `list_documents_summary` implementations —
`document_repository.rs:367` and `repository.rs:852`. The one `get_documents`
actually calls is `repository.rs` via `State<'_, Repository>`. The
`document_repository.rs` copy is a separate/unused path. Only `repository.rs`
was changed.)

### Live end-to-end proof (room 21d60302..., 2026-08-04 23:20)

Triggered via CDP for document "The Law Book" (`465f6308...`,
fileId `9f547325...`):
- `yjs_file_download` → 77,137,093 bytes + `encryptedMetadata` (272 chars)
- decrypt with room `fileKey` (HKDF `files-v1`, salt=roomId) → plaintext
  77,137,065 bytes, **first4 = `504b0304`** (valid ZIP/EPUB)
- `save_synced_file` →
  `/data/user/0/com.incrementum.app/incrementum/documents/1785820803-The Law Book...epub`
- `ls` confirms 77 MB on disk; `od` confirms `50 4b 03 04` magic
- `update_document_file_path` → `get_document` confirms `filePath` set

### Still open: auto-download does not fire automatically on boot

The download works when triggered manually, but the phone's
`startAutoFileSyncDownload` reconciler is not firing on cold boot (the
`boot-auto-download-watch` scheduler phase never appears in the logcat).
The `startSyncSubsystems` boot chain completes (`outbox drain loop STARTED`
per boot-trace), but the auto-download-watch step — scheduled after the
delta transport — is not producing telemetry. The startup reconcile at
`autoFileSyncDownload.ts:178` (`for (const entry of manifest.getAllFiles())`)
should add all manifest entries to `pendingAutoDownloads` and call
`maybeAutoDownload`, but it's not running. Next session: trace why
`startAutoFileSyncDownload` isn't reached on boot (it's scheduled as
`boot-auto-download-watch` P2 in startSyncSubsystems.ts:255 — check whether
that scheduler task is dropped/quarantined, or whether the function returns
early at the `ensureFileSyncReady` / `isYjsSyncEnabled` gates).

### Fixes committed

Commit `2b613913` on main: Bug #12 + #13 + boot-trace diagnostics + this
HANDOFF update. The boot-trace probes in `startSyncSubsystems.ts` are
diagnostic-only (route via plugin-log) — strip before final merge.
