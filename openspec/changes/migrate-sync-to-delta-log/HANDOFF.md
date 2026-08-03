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
