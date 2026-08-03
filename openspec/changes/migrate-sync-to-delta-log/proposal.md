## Why

Cross-device sync currently rides a Yjs CRDT over a deliberately zero-knowledge relay. That combination has a structural cost problem, not a tuning problem.

**The immediate symptom.** Cold-start sync spikes to roughly 20 GB of WebView heap. The relay never applies encrypted frames (`yjs-sync/utils.js` refuses type-0 and only forwards type-`0x10`), so its `WSSharedDoc` is permanently empty — yet `setupWSConnection` still sends `writeSyncStep1` with an empty state vector. y-websocket answers an empty state vector with `Y.encodeStateAsUpdate(doc)`: the whole document, on every connect. `frameLog.appendFrame` persists that reply *and* persists every `syncStep1` query, and `readFrames` replays all of them to the next joiner — so each replayed query provokes another whole-document encode, seal, and send. `EncryptedWebsocketProvider.send` is fire-and-forget with no queue, so they all run concurrently at roughly 6–7 live buffers apiece. K replayed queries × document size is the 20 GB. Commit `70a8a38a` compacted the local y-indexeddb log, which is the symptom; the generator refills it on the next connect.

**The structural problem.** Because merging *is* decrypting, a zero-knowledge relay can never deduplicate. Server storage and client cold-start are therefore both O(accumulated history), bounded only by a 64 MiB byte-LRU cap that preferentially evicts large useful frames and preserves tiny harmful ones — and by a 30-day frame TTL that silently desyncs any device offline longer than that. Cold start is also atomic: the entire document must materialize in the heap before anything is usable.

**We are not using what we are paying for.** All fourteen maps on the shared doc merge as `row-lww`, `field-lww`, or `append-only` on an HLC clock, with SQLite as the source of truth on every device and the Y.Map explicitly documented as "only a delivery buffer". There is no text co-editing anywhere in the app. Meanwhile `sync_outbox`, `sync_inbox`, `sync_checkpoints`, and `sync_dead_letters` already exist in migration `056_add_progressive_sync_journal`, `nowHLC()` already stamps every synced row, and `manifestAuthKey` is already derived. The client half of a log-shipping sync engine is built and sitting behind `journaledProjection: false`, wired as a satellite of the CRDT instead of a replacement for it.

Target deployment is a 1-core / 1 GB / 25 GB VPS. The current relay is configured with `--max-old-space-size=4096` and `maxPayload: 256 MiB`, and loads a room's entire 64 MiB frame log into a JS array on every connect — over budget for that box before any client connects.

## What Changes

Replace the CRDT transport with an **encrypted delta log addressed by per-device cursors**, without changing the merge semantics any entity already relies on, and without ever making the Yjs document the source of a migration read.

- **New sync service** (`sync-log`): one SQLite table of ops, each row an AES-GCM blob plus a small plaintext envelope (`key_tag`, `hlc`, `kind`). `key_tag = HMAC(roomIndexKey, domain || entityKey)` — stable within a room, opaque, uncorrelatable across rooms. The envelope lets the server keep only the newest row per key **without decrypting anything**, so storage becomes O(live rows) rather than O(history).
- **Paged, resumable cold start.** `GET /rooms/{room}/ops?since=N&limit=…` returns each entity at most once. Clients project a page, advance `sync_checkpoints.cursor`, repeat. Replaces the all-or-nothing whole-document materialization.
- **Server-side GC by minimum device cursor.** Append rows (reviews) and tombstones are deleted once every registered device has read past them. Removes the 30-day TTL desync cliff: a device offline for two years pulls from cursor 0 and receives the current live set.
- **Authentication.** Every request is authenticated with an HMAC under the existing `manifestAuthKey`. The current relay has no authentication at all — anyone who learns a room id can read the ciphertext stream and inject frames that are persisted and replayed to every device.
- **Data-preserving cutover.** A drain → seed → dual-run → verify → retire sequence in which SQLite is the only migration source, the delta log is seeded from SQLite (never from the Yjs document), seeding is idempotent because HLCs are carried verbatim, and no Yjs data is deleted until an explicit post-verification step.
- **Phase 0 stop-gap** (independently shippable, independently revertible): stop persisting `syncStep1` frames, stop sending `syncStep1` from a stateless relay, and bound the outbound encrypt path. These cut the 20 GB spike while the migration proceeds and are discarded when Yjs is retired.

Non-goals: changing any entity's merge semantics; introducing concurrent text editing; migrating file blob storage (the existing file-service is untouched); supporting more than one room per device.

## Capabilities

### New Capabilities
- `delta-log-sync`: the cursor-addressed encrypted delta-log protocol, its server-side resource bounds, and the client transport and projection path that replaces the Yjs provider.
- `sync-cutover-safety`: the data-preservation guarantees for the transition — drain completeness, idempotent seeding, dual-run bridging for not-yet-upgraded devices, convergence verification before cutover, and gated teardown with rollback.

### Modified Capabilities
- `yjs-sync-performance`: its batched-projection and telemetry-throttling requirements are retargeted to be transport-neutral so they continue to apply to the delta-log projection path; the Yjs-specific replay requirement is removed at retirement.

## Impact

**New**
- `yjs-sync/sync-log/` (or a sibling service) — delta-log server: ops table, push/pull/head/cursor endpoints, WebSocket seq notifications, min-cursor GC.
- `src/lib/sync/deltaLog/` — client transport (push, paged pull, cursor persistence, live subscribe), envelope construction, `key_tag` derivation.
- `src/lib/sync/cutover.ts` — drain, seed, convergence digest, phase state machine.

**Modified**
- `src/lib/sync/replicatedMap.ts` — factor the merge/projection half (`handleRemote`, `runApply`, `mergeFieldLww`, `enqueueBatch`, tombstone and append-prune logic) away from the Yjs half so both transports drive the same projection.
- `src/lib/documentReplication.ts`, `src/lib/sync/entities/{collections,extracts,flashcards,conversations,rss,podcasts}.ts`, `src/lib/sync/fileAvailabilityIntent.ts` — retarget to the transport-neutral factory. Merge modes unchanged.
- `src/lib/localStorageSync.ts` — `localStorage` map becomes a delta-log domain keyed by storage key.
- `src/lib/file-manifest.ts` — `fileManifest` becomes a delta-log domain; `devicePresence` is ephemeral and moves to the server's device roster rather than durable storage.
- `src/lib/startSyncSubsystems.ts` — boot chain selects transport by flag; y-indexeddb compaction becomes stop-gap-only.
- `src/lib/sync/featureFlags.ts` — add `deltaLogSync` and `deltaLogDualWrite`; `journaledProjection` becomes the delta-log write path rather than a CRDT satellite.
- `src/lib/sync/syncJournal.ts` + `src-tauri/src/commands/sync_journal.rs` — outbox drain publishes to the delta log.
- `src/components/settings/SyncSettings.tsx` — migration status, device check-in roster, explicit "finish migration" action.
- `src-tauri/src/database/migrations.rs` — add per-domain cursor and cutover-state columns/tables.
- `yjs-sync/utils.js`, `yjs-sync/frameLog.js`, `yjs-sync/server.js`, `yjs-sync/docker-compose.yml` — Phase 0 stop-gap, then retirement.

**Removed at retirement (Phase 7, gated)**
- `yjs`, `y-websocket`, `y-indexeddb`, `y-protocols` from `package.json`; `src/lib/yjsSync.ts`; `src/lib/sync/{encryptedProvider,yjsCompaction}.ts`; the forked relay and its frame logs; per-room `incrementum-yjs:*` IndexedDB databases.

**Unchanged**
- All SQLite schemas for user data. All `upsert_synced_*` commands. `nowHLC()` wire format. AES-GCM payload format and the room key / sub-key derivation. The file-service and its blob storage.
