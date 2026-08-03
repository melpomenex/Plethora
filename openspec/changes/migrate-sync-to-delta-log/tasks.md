## 0. Phase 0 — stop the bleeding (independently shippable, revertible, discarded at task 9)

- [x] 0.1 Add a plaintext sub-type byte to the `0x10` envelope in `src/lib/sync/encryptedProvider.ts::encryptOutbound` (read the sync sub-type from the decoder before encrypting the remainder). Keep the ciphertext boundary exactly where it is.
- [x] 0.2 In `yjs-sync/utils.js` `default:` case, call `frameLog.appendFrame` only for `step2` / `update` sub-types. Never persist `step1` queries — this is what makes `K → 0`.
- [x] 0.3 Remove the relay's own `writeSyncStep1` from `setupWSConnection` (it advertises an empty state vector and provokes a whole-document upload to a server that discards it). Verify two peers still converge through opaque forwarding.
- [x] 0.4 Serialize outbound encryption in `EncryptingWebSocket.send` through a bounded queue (drop the fire-and-forget `encrypt(...).then(send)`), and bound `inboundReplayQueue` with pause/resume backpressure.
- [x] 0.5 In `yjs-sync/server.js`, lower `MAX_PAYLOAD_BYTES` from 256 MiB to a bounded value and set `--max-old-space-size` well under the 1 GB box budget in `docker-compose.yml`.
- [x] 0.6 Stream `frameLog.readFrames` instead of building the whole array; add per-connection send backpressure to the replay loop.
- [x] 0.7 Fix the room leak: `closeConn` only removes from `docs` when `persistence !== null`, and `YPERSISTENCE` is intentionally unset, so every room leaks a `WSSharedDoc` + `Awareness` forever.
- [ ] 0.8 Measure before/after: peak WebView heap on cold start with a large room, and relay RSS. Record both in this change before proceeding.

## 1. Measure the current shape (blocks design assumptions)

- [ ] 1.1 Instrument a one-off dev command that reports `Y.encodeStateAsUpdate(doc).byteLength` after a full boot — this is `S` in the design's memory arithmetic.
- [ ] 1.2 On a live relay, count `.frame` files per room and produce a size histogram — this is `K`, and it should confirm that tiny `step1` frames dominate by count while surviving byte-LRU eviction.
- [ ] 1.3 Record per-domain row counts from SQLite for a representative library; use them to size the P2 seed and to sanity-check the 100 MB/room storage estimate.
- [ ] 1.4 If `S` or `K` diverge materially from the design's 30 MB / 100 assumptions, update `design.md` §1.1 before continuing.

## 2. Envelope, keys, and crypto

- [x] 2.1 Derive a fourth sub-key `roomIndexKey` in `src/lib/sync/encryption.ts` via HKDF with info `incrementum-sync/index-v1`, alongside `stateKey` / `fileKey` / `manifestAuthKey`. Extend `SubKeys` and `getCachedSubKeys`.
- [x] 2.2 Implement `keyTag(domain, entityKey)` = HMAC-SHA256 under `roomIndexKey` over `domain || 0x00 || entityKey`. Add tests asserting stability within a room and non-correlation across rooms.
- [x] 2.3 Implement request signing: `HMAC(manifestAuthKey, method || path || body)`. Add tests for tamper rejection and replay window.
- [x] 2.4 Reuse `encryptState` / `decryptState` unchanged for the op blob. Assert the payload format is byte-identical to today so a blob is interchangeable between transports.

## 3. Delta-log server

- [x] 3.1 Scaffold the service (language/runtime chosen against the 1-core / 1 GB budget; see `design.md` §9 on whether to fold into the existing file-service). SQLite in WAL mode with a fixed page cache.
- [x] 3.2 Create the schema from `design.md` §4.1: `ops`, the partial unique index `ops_live ON ops(room, key_tag) WHERE kind IN (0,1)`, `room_seq`, `device_cursor`.
- [x] 3.3 Implement `POST /rooms/{room}/ops` with the compaction upsert, including re-issuing `seq` on update so cursor readers observe the change, and the `WHERE excluded.hlc > ops.hlc` LWW guard.
- [x] 3.4 Implement `GET /rooms/{room}/ops?since=N&limit=…` with the 500-row / 4 MiB page cap; assert each entity appears at most once per cold start.
- [x] 3.5 Implement `GET /rooms/{room}/head` returning head seq plus the device roster (`device_tag`, `cursor`, `seen_at`).
- [x] 3.6 Implement `POST /rooms/{room}/cursor`.
- [x] 3.7 Implement `WS /rooms/{room}?since=N` pushing new seq values only (no payloads on the socket; clients pull).
- [x] 3.8 Enforce auth on every route; reject unauthenticated requests. Confirm rooms are not enumerable.
- [x] 3.9 Implement min-cursor GC for `kind=2` appends and aged `kind=1` tombstones, with `DEVICE_STALE_DAYS` excluding abandoned devices from holding the log back. Assert upsert rows are never collected.
- [ ] 3.10 Load test on the target box shape: steady-state RSS < 128 MiB with many rooms and concurrent cold starts; confirm no per-room in-memory state.

## 4. Client transport

- [x] 4.1 Add `src/lib/sync/deltaLog/client.ts`: `push(ops)`, `pull(domain, since, limit)`, `head()`, `reportCursor()`, `subscribe()`. All requests signed per 2.3.
- [x] 4.2 Persist cursors in `sync_checkpoints` (one row per domain); reset to 0 on room switch so a new room does a clean paged cold start.
- [x] 4.3 Wire the pull loop through `scheduleProgressiveSyncWork` so paging yields to input, checkpoints after each page, and resumes at the last completed page after a kill.
- [x] 4.4 Wire `drainSyncOutboxBatch` in `src/lib/sync/syncJournal.ts` to publish to `POST /ops` and mark rows applied; reuse the existing `attempts` / `status` / `sync_dead_letters` retry model.
- [x] 4.5 Add `deltaLogSync` and `deltaLogDualWrite` to `src/lib/sync/featureFlags.ts` (both default false) with `VITE_` overrides matching the existing pattern.
- [x] 4.6 Add Rust commands / migration for per-domain cursor storage and cutover state in `src-tauri/src/database/migrations.rs`.

## 5. Transport-neutral projection

- [x] 5.1 Extract `createProjector(config)` from `src/lib/sync/replicatedMap.ts` — keep `handleRemote` conflict checks, `runApply`, `appliedClocks`, `appliedTombstoneClocks`, `mergeFieldLww`, `enqueueBatch`/`flushBatch`, `syncClockCache`, and `measureSyncPhase`. Leave `map.observe`, `map.set`, `gcTombstonesMap`, `pruneAgedAppendEntries`, and doc rebinding on the Yjs side.
- [x] 5.2 Add unit tests asserting the projector produces byte-identical `upsert_synced_*` calls when driven from either transport for all three modes (`row-lww`, `field-lww`, `append-only`).
- [x] 5.3 Replace the `enqueue` linear scan in `src/lib/sync/progressiveScheduler.ts` (`queue.some(existing => existing.id === item.id)`) with a Set-backed index — it is O(n²) across a cold-start replay.
- [x] 5.4 Retarget the entity modules to the projector: `documentReplication.ts`, `entities/{collections,extracts,flashcards,conversations,rss,podcasts}.ts`, `sync/fileAvailabilityIntent.ts`. Merge modes and `upsert_synced_*` commands unchanged.
- [x] 5.5 Port `localStorageSync.ts` to the `localStorage` domain keyed by storage key, preserving the blocklist and the 8 KiB / data-URL guards.
- [x] 5.6 Port `file-manifest.ts`'s `fileManifest` to a domain; move `devicePresence` off durable storage onto the server device roster (it is ephemeral and never belonged in a monotonically-growing document).

## 6. Cutover machinery

- [x] 6.1 Add `src/lib/sync/cutover.ts` with the phase state machine from `design.md` §6 (`drained → seeded → dual → verified → cutover → quiesced → retired`), persisted in SQLite.
- [x] 6.2 Implement **P1 drain**: force-replay every one of the 14 maps through the existing `handleRemote` path, wait for scheduler quiescence, record per-domain counts. Gate advancement on every map enumerated, every enqueued task drained, and zero dead-letter rows for the run — otherwise retry next boot.
- [x] 6.3 Implement **P2 seed** reading exclusively from SQLite, carrying each row's existing HLC verbatim. Add a test that running the seed twice is a no-op and that a partial seed is a correct prefix.
- [x] 6.4 Implement **P3 dual-run**: publish every mutation to both transports; read from both. Assert double-delivery is a projection no-op via `appliedClocks`.
- [x] 6.5 Implement **P4 verify**: per-domain digest over `(entityKey, hlc)` pairs, published to the log so peers can compare. Converged + all roster devices checked in ⇒ surface cutover as available.
- [x] 6.6 Implement **P5–P6**: stop Yjs publishing while still reading; track days since the last Yjs-only row observed.
- [x] 6.7 Implement **P7 retire** behind explicit user confirmation with a backup prompt (reuse `backup-core-operations` / `backup-encryption`): disable Yjs, drop `incrementum-yjs:*` IndexedDB, request frame-log deletion.
- [x] 6.8 Verify rollback at every phase before P7: flipping `deltaLogSync` off leaves SQLite intact and returns the device to working Yjs sync.
- [x] 6.9 Wire the cutover phases into the app boot chain so a real room can actually be driven through the state machine. Adds `src/lib/sync/deltaLog/cutoverOrchestrator.ts` (builds config, registers room, starts pull loop + WS + presence, advances one phase per boot up to `verified`), `src/lib/sync/cutoverTargets.ts` (drain-target registry), `src/lib/sync/deltaLog/seedReaders.ts` (per-domain SQLite seed readers carrying each row's existing HLC verbatim), and the boot-time call in `src/lib/startSyncSubsystems.ts`. Also widens the `enqueueSyncOperation` + outbox-drain gates to run when `deltaLogSync` is on so P2 seed rows reach the server. `deltaLogSync` stays default `false`; rollback path untouched. Tested in `deltaLog.cutoverOrchestrator.test.ts`.
- [x] 6.10 Phase 9 prep — make the app function without Yjs (no deletion yet). Resolves the three blockers a naive deletion hit: (1) restructured `replicatedMap.ts`/`documentReplication.ts` publish+delete so the outbox enqueue precedes the Yjs map null-check (writes survive without a bound map); (2) added a SQLite projection for file-manifest (migration `069_add_file_manifest_entries` + `upsert/delete/get_file_manifest_entries` Rust commands + an in-memory cache hydrated by `FileManifest.hydrateFromSqlite`, so reads survive a restart); (3) wired the previously-uncalled delta-log presence helpers (`setDeltaLogPresenceSource` + `refreshOnlineDevicesFromDeltaLog`, called from the orchestrator's presence tick). Yjs is still present and active; `deltaLogSync` still defaults `false`. The one remaining Yjs coupling — file-BYTE transport in `FileTransferManager` — is deliberately deferred and documented in HANDOFF.md. Tested in `deltaLog.phase9Prep.test.ts`.

## 7. UI

- [x] 7.1 Add a migration panel to `src/components/settings/SyncSettings.tsx` showing the current phase, per-domain drain/seed progress, and the device roster from `GET /head` with last check-in.
- [x] 7.2 Gate the "Finish migration" action on P4-verified plus explicit confirmation; explain in plain language that not-yet-upgraded devices will stop syncing.
- [x] 7.3 Surface convergence failures and dead-lettered operations with a retry action rather than failing silently.
- [x] 7.4 Leave pairing untouched: `src/lib/sync/qrFormat.ts` keeps `SYNC_QR_FORMAT_VERSION = 1` and the `incrementum-sync:v1:<roomId>:<secret>` payload, and `SyncSettings.tsx` keeps its room-code display, copy, QR canvas, scanner, join-by-code field, and rotate action. Add a regression test asserting a v1 QR string produced before the migration still joins successfully after it.
- [x] 7.5 Migrate the endpoint setting: `settings.sync.yjs.url` (a single `wss://` value, user-editable, default `wss://sync.readsync.org`) must become the delta-log service base with derived HTTP and WS URLs. Preserve any custom self-hosted value by upgrading it in place rather than silently resetting it to the default, and keep the field labelled as one endpoint in the UI.
- [x] 7.6 Update the diagnostics panel: drop Yjs provider/replay phases and add delta-log phases (pull page, projection, cursor advance, push drain), keeping `copyDiagnostics` output useful for support.

## 8. Verification

- [ ] 8.1 Cold-start memory: peak WebView heap on a large room under the delta log, compared against the pre-Phase-0 and post-Phase-0 numbers from 0.8. Target is a flat profile bounded by page size, not by library size. **Needs a live app + a real large room — not automatable in this environment; not done.**
- [x] 8.2 Resumability: kill the app mid-cold-start repeatedly; confirm each restart resumes at the last completed page and converges. Automated: `deltaLog.validation.test.ts` repeatedly restarts the pull loop against the real server and confirms every key is delivered exactly once across restarts.
- [x] 8.3 Long-offline device: take a device offline past `DEVICE_STALE_DAYS`, mutate on another, reconnect. Confirm it converges from cursor 0 — the case today's 30-day frame TTL silently breaks. Automated against the real server.
- [ ] 8.4 Three-device staged upgrade: upgrade one device, leave two on Yjs, mutate on all three, confirm convergence through the bridge; then upgrade the rest and cut over. **Partially automated** (`deltaLog.validation.test.ts` proves the bridge *mechanism* — a not-yet-upgraded device's Yjs-shaped projector receives an upgraded device's delta-log write via the shared domain-registry handler) but the real y-websocket relay + real EncryptedWebsocketProvider end-to-end path needs live multi-device infrastructure this environment doesn't have; not fully done.
- [x] 8.5 Conflict semantics per mode: concurrent edits on two devices for `row-lww`, `field-lww`, and `append-only` produce the same result as they do today. Automated.
- [x] 8.6 Data preservation: full-library digest comparison before P1 and after P5 on every device — no row lost, no row resurrected, no tombstone reverted. Automated against the real server (digest + row-for-row seed verification + tombstone-not-reverted-by-stale-reseed).
- [x] 8.7 Server storage: confirm it is flat over a simulated month of usage rather than growing with operation count. Automated against the real server (100 pushes across 5 entities → 5 live rows).
- [x] 8.8 Auth: confirm unauthenticated and tampered requests are rejected, and that a room id alone grants no access. Already covered exhaustively by `yjs-sync/file-service/test/sync-log.mjs` (task 3.8): unauthenticated rejection, tampered-signature rejection, TOFU registration hijack rejection, wrong-key rejection.

## 9. Retirement (gated on 8.x passing and P6 quiesced)

- [ ] 9.1 Remove `yjs`, `y-websocket`, `y-indexeddb`, `y-protocols` from `package.json`; delete `src/lib/yjsSync.ts`, `src/lib/sync/encryptedProvider.ts`, `src/lib/sync/yjsCompaction.ts`, and the Phase 0 stop-gap code.
- [ ] 9.2 Retire the forked relay: `yjs-sync/{server.js,utils.js,frameLog.js}` and its `docker-compose.yml` service; delete persisted frame logs.
- [ ] 9.3 Update `openspec/project.md` — Yjs is listed under Key Libraries, Architecture Patterns, and External Dependencies.
- [ ] 9.4 Re-run 8.1 and 8.7 on the retired configuration and record the final numbers in this change before archiving.
