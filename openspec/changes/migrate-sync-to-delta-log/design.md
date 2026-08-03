# Design: delta-log sync

## 1. Root cause of the current cost model

### 1.1 The amplification loop

```
  ┌──────────────────────────────────────────────────────────────────┐
  │ RELAY (yjs-sync/utils.js) — Y.Doc is PERMANENTLY EMPTY           │
  │   case messageSync (0):  refuse, never apply                     │
  │   case messageAwareness: forward only, never apply               │
  │   default (0x10):        forward + frameLog.appendFrame          │
  └──────────────────────────────────────────────────────────────────┘
                  │  yet setupWSConnection still runs
                  ▼  writeSyncStep1(encoder, doc) → EMPTY state vector
  ┌──────────────────────────────────────────────────────────────────┐
  │ y-websocket.js:141                                               │
  │   const encoder = readMessage(provider, data, true)              │
  │   if (encoding.length(encoder) > 1) websocket.send(...)          │
  │                                    └─ Y.encodeStateAsUpdate(doc) │
  │                                       = THE ENTIRE DOCUMENT      │
  └──────────────────────────────────────────────────────────────────┘
                  │
                  ▼  that reply is 0x10 → relay default: → appendFrame
  ┌──────────────────────────────────────────────────────────────────┐
  │ FRAME LOG — 64 MiB cap, LRU by mtime, evicts by BYTES            │
  │  [step1 40B] [step2 30MB] [step1 40B] [update 2KB] [step1 40B]…  │
  │       ▲ tiny → survives eviction → costs a FULL DOC ENCODE each  │
  └──────────────────────────────────────────────────────────────────┘
                  │  readFrames() replays ALL of them on next connect
                  ▼
        K replayed step1 frames ⇒ K whole-document encode+seal+send,
        all concurrent (EncryptedWebsocketProvider.send is
        fire-and-forget), ≈6–7 live buffers each.
```

Per reply, with document size `S`: `encodeStateAsUpdate` (S) + lib0 encoder buffers (S) + `toUint8Array` (S) + `crypto.subtle.encrypt` output (S) + `sealAesGcm`'s `out` (S) + outer `0x10` encoder and its `toUint8Array` (2S) ≈ **6–7 × S**, all simultaneously live. `S = 30 MB`, `K = 100` → ~20 GB.

Two secondary contributors:
- `fetchUpdates` wraps the whole IndexedDB replay in one `Y.transact` with the persistence instance as origin. That is `!== provider`, so y-websocket's `_updateHandler` fires once with the entire document and broadcasts it — another full snapshot per boot, whenever the socket connected first (it usually has).
- y-indexeddb's `_storeUpdate` guards on `origin !== this`; remote frames arrive with the *provider* as origin, so **every replayed frame writes a new IndexedDB row**. Its auto-trim is on a 1 s debounce that keeps resetting during a replay burst, so it never fires during exactly the storm it exists for. This is why `70a8a38a` did not hold: it compacted the log without touching the generator.

### 1.2 Why this is not fixable within the CRDT

Merging *is* decrypting. A zero-knowledge relay therefore cannot deduplicate, cannot compact, and cannot answer "what has this client not seen?". Its only bounding mechanism is a byte cap that evicts by age, which preferentially discards large useful frames and preserves small harmful ones. Cold start is O(accumulated history) and atomic — the whole document must materialize before any of it is usable.

Phase 0 (§7) removes the loop and buys ordinary CRDT behaviour back. It does not change the O(history) cost model.

## 2. What the shared document actually does

Fourteen maps, every one of them a keyed row with a timestamp:

| Map | Module | Mode | Becomes |
|---|---|---|---|
| `documents` | `documentReplication.ts` | row-lww | domain `documents` |
| `learningItems` | `entities/flashcards.ts` | row-lww | domain `learningItems` |
| `reviews` | `entities/flashcards.ts` | append-only (`maxAgeDays: 30`) | domain `reviews`, `kind=append` |
| `extracts` | `entities/extracts.ts` | row-lww | domain `extracts` |
| `collections` | `entities/collections.ts` | row-lww | domain `collections` |
| `assistantConversations` | `entities/conversations.ts` | row-lww | domain `assistantConversations` |
| `rssFeeds` | `entities/rss.ts` | row-lww | domain `rssFeeds` |
| `rssArticlesState` | `entities/rss.ts` | field-lww | domain `rssArticlesState` |
| `podcastFeeds` | `entities/podcasts.ts` | row-lww | domain `podcastFeeds` |
| `podcastEpisodes` | `entities/podcasts.ts` | field-lww | domain `podcastEpisodes` |
| `fileAvailabilityIntent` | `sync/fileAvailabilityIntent.ts` | row-lww | domain `fileAvailabilityIntent` |
| `localStorage` | `localStorageSync.ts` | LWW on `updatedAt` | domain `localStorage` |
| `fileManifest` | `file-manifest.ts` | keyed rows | domain `fileManifest` |
| `devicePresence` | `file-manifest.ts` | **ephemeral** | server device roster, not durable |

`devicePresence` is the only genuine change of nature: it is presence state that never belonged in a monotonically-growing document. It becomes a side effect of cursor reporting (§4.4).

Nothing here needs convergence stronger than "newest HLC wins", and `mergeFieldLww` already runs client-side on apply for the two `field-lww` entities. Merge semantics are carried over unchanged.

## 3. Wire format

```
op := envelope || blob

envelope (plaintext, server-readable):
  key_tag   32 bytes   HMAC-SHA256(roomIndexKey, domain || 0x00 || entityKey)
  hlc       20 chars   "<13-digit ms>.<6-digit counter>"  (nowHLC(), verbatim)
  kind      1 byte     0 = upsert, 1 = delete (tombstone), 2 = append

blob (opaque to server):
  nonce(12) || AES-GCM(stateKey, JSON(row))     -- unchanged from encryptState
```

`roomIndexKey` is a fourth HKDF sub-key alongside `stateKey` / `fileKey` / `manifestAuthKey`, derived with info `incrementum-sync/index-v1`. It never leaves the device.

**Privacy delta.** The server learns: how many distinct entities a room holds, and how often each is updated. It cannot enumerate them (`key_tag` is a keyed hash of an id it does not know), cannot read them, and cannot correlate a `key_tag` across rooms. Compare against today, where the relay sees frame sizes, frame timing, and a full-document snapshot on every connect. Judged an acceptable trade for the compaction it buys; §8 records the variant that avoids it.

## 4. Server

Target: 1 core, 1 GB RAM, 25 GB disk, shared with the existing file-service.

### 4.1 Storage

```sql
CREATE TABLE ops (
  room     TEXT    NOT NULL,
  seq      INTEGER NOT NULL,
  key_tag  BLOB    NOT NULL,
  hlc      TEXT    NOT NULL,
  kind     INTEGER NOT NULL,
  blob     BLOB    NOT NULL,
  PRIMARY KEY (room, seq)
);

-- The compaction invariant: at most one live row per (room, key_tag)
-- for upserts and tombstones. Appends are exempt.
CREATE UNIQUE INDEX ops_live ON ops(room, key_tag) WHERE kind IN (0, 1);

CREATE TABLE room_seq     (room TEXT PRIMARY KEY, next_seq INTEGER NOT NULL);
CREATE TABLE device_cursor(room TEXT, device_tag BLOB, cursor INTEGER,
                           seen_at INTEGER, PRIMARY KEY (room, device_tag));
```

Push is one statement per op inside one transaction:

```sql
INSERT INTO ops (room, seq, key_tag, hlc, kind, blob)
VALUES (?, next_seq(?), ?, ?, ?, ?)
ON CONFLICT (room, key_tag) WHERE kind IN (0,1) DO UPDATE SET
  seq  = next_seq(room),      -- re-issue so cursor readers see the change
  hlc  = excluded.hlc,
  kind = excluded.kind,
  blob = excluded.blob
WHERE excluded.hlc > ops.hlc;  -- LWW, decided on plaintext clock alone
```

Re-issuing `seq` on update is what keeps `since=N` correct while storing one row per key.

### 4.2 Endpoints

| | |
|---|---|
| `POST /rooms/{room}/ops` | batch push; returns `{head}` |
| `GET  /rooms/{room}/ops?since=N&limit=500` | paged pull; each entity appears at most once |
| `GET  /rooms/{room}/head` | `{head, devices:[{device_tag, cursor, seen_at}]}` |
| `POST /rooms/{room}/cursor` | report `{device_tag, cursor}`; drives GC and the roster |
| `WS   /rooms/{room}?since=N` | push new `seq` values as they land |

Every request carries `HMAC(manifestAuthKey, method || path || body)`. Rooms are not enumerable and unauthenticated requests are rejected — closing the current relay's open-room hole.

### 4.3 Resource bounds

No per-room in-memory document; no CRDT runtime; no per-room state beyond an open socket. Per connection ≈ one buffered page. Page size capped at 500 rows / 4 MiB. Body size capped at 8 MiB. SQLite in WAL mode with a fixed page cache (~48 MiB). Steady-state RSS target < 128 MiB regardless of room count.

Storage per room ≈ Σ(live row ciphertext) — flat over time, a function of library size, not of usage duration. ~50k flashcards at ~1.5 KB ≈ 75 MB, plus documents/extracts/collections ≈ 25 MB → ~100 MB/room. Sync metadata is a rounding error next to the file-service blobs already sharing the disk.

### 4.4 Garbage collection

Appends and tombstones do not compact by key.

```
keep := min(cursor) over device_cursor rows for the room
        with seen_at within DEVICE_STALE_DAYS (default 90)

DELETE FROM ops WHERE room=? AND kind=2 AND seq <= keep;           -- appends
DELETE FROM ops WHERE room=? AND kind=1 AND seq <= keep
                  AND hlc < now - TOMBSTONE_MIN_AGE;               -- tombstones
```

Kafka consumer-group retention. A device stale past `DEVICE_STALE_DAYS` stops holding the log back; when it returns it pulls from cursor 0 and receives the current live set — correct for upserts and tombstones, and lossy only for appends already projected into its own permanent local revlog.

Upsert rows are never GC'd. They *are* the state.

## 5. Client

### 5.1 Split `replicatedMap.ts`

Today the file interleaves two concerns. The migration factors them:

```
  KEEP (transport-neutral)              REPLACE (Yjs-specific)
  ────────────────────────              ──────────────────────
  handleRemote conflict checks          map.observe / map.forEach replay
  runApply + appliedClocks              map.set / writeTombstoneHelper
  mergeFieldLww                         gcTombstonesMap
  enqueueBatch / flushBatch             pruneAgedAppendEntries
  syncClockCache integration            room-change doc rebinding
  measureSyncPhase / telemetry
```

The kept half becomes `createProjector(config)`, fed by either transport. Every `upsert_synced_*` command and every merge mode is untouched — which is what makes the entity modules a retarget rather than a rewrite, and what makes dual-run possible at all.

### 5.2 Read path

```
  WS "new head N"  ──┐
  boot / reconnect ──┴─► pull(since = cursor, limit = 500)
                            │
                            ▼
                     sync_inbox (durable)
                            │  progressive scheduler, P1
                            ▼
                     decrypt → projector.handleRemote → upsert_synced_*
                            │
                            ▼
                     sync_checkpoints.cursor = page.last_seq
                            │
                            └─► loop while more
```

Bounded, resumable, and checkpointed per page. A kill mid-cold-start resumes at the last completed page instead of restarting a whole-document materialization — the property that makes this viable inside a mobile WebView's memory budget.

### 5.3 Write path

`sync_outbox` already exists and is already written by `enqueueSyncOperation`. The drain publishes batches to `POST /ops` and marks rows applied. Offline queues naturally; retries and dead-lettering are already modelled by the existing `attempts` / `status` / `sync_dead_letters` columns.

### 5.4 Cursors

`sync_checkpoints` gains a row per domain. Cursors are per room; a room switch resets them to 0, which triggers a clean paged cold start against the new room.

## 6. Migration

The single governing rule: **SQLite is the only migration source. The Yjs document is never read as an authority — it is drained into SQLite first, and SQLite is what seeds the log.**

```
 P1 DRAIN          replay every Yjs map entry through the existing
                   handleRemote path; wait for scheduler quiescence;
                   record per-domain counts.        → state = drained
 P2 SEED           for every SQLite row in every synced domain, enqueue an
                   outbox op carrying its EXISTING hlc verbatim. Push.
                   Server compacts by key_tag.       → state = seeded
 P3 DUAL-RUN       publish every mutation to BOTH transports; read from
                   both; projection is idempotent so double-delivery is a
                   no-op.                            → state = dual
 P4 VERIFY         per-domain digest over (entityKey, hlc); compare across
                   devices via the log. Converged + all devices checked in
                   ⇒ offer cutover.                  → state = verified
 P5 CUTOVER        stop publishing to Yjs; keep reading it.
                                                     → state = cutover
 P6 QUIESCE        ≥14 days with no Yjs-only rows observed.
                                                     → state = quiesced
 P7 RETIRE         user-confirmed: disable Yjs, drop IndexedDB, delete
                   frame logs, remove deps.          → state = retired
```

**Why seeding cannot corrupt.** Seeding carries each row's existing HLC verbatim and every merge is LWW on that clock. Re-running the seed produces `excluded.hlc > ops.hlc` = false for every already-seeded row, so it is a no-op. Order does not matter. A partially-completed seed is a correct prefix, not a corrupt state. There is no reachable interleaving in which seeding moves a row *backwards*.

**Why dual-run is required.** A user with three devices may upgrade them weeks apart. During P3 an upgraded device bridges: it publishes to both transports, so a not-yet-upgraded device on Yjs still receives everything, and its writes still reach the new devices. Retirement is user-confirmed against the device roster from `GET /head`, not inferred.

**Rollback.** Reverting to `deltaLogSync: false` is safe at any phase before P7 because SQLite is untouched by transport choice, both transports carry the same LWW-on-HLC rows, and no Yjs data is deleted before P7. P7 is the only irreversible step and is gated on explicit user confirmation with a backup prompt (the existing `backup-core-operations` / `backup-encryption` capabilities).

**Drain completeness.** P1 must not advance on a partially-drained document. The gate is: every map's `forEach` enumerated, every enqueued projection task drained from the scheduler, zero dead-letter rows for the run. If any domain fails the check, the phase stays at `drained=false` and retries next boot rather than proceeding.

## 7. Phase 0 stop-gap

Independently shippable and independently revertible; discarded at P7. It removes the loop but not the O(history) cost model, so it is a bridge, not an alternative.

1. **Do not persist `syncStep1` frames.** Add a plaintext sub-type byte to the `0x10` envelope; the relay appends only `step2` / `update` frames. Collapses `K → 0` and kills the feedback loop outright.
2. **Do not send `syncStep1` from a stateless relay.** In opaque-forward mode the relay's own `writeSyncStep1` provokes a whole-document upload to a server that discards it. Peers still handshake with each other through forwarding.
3. **Bound the encrypt path.** Serialize outbound encryption through a bounded queue; bound `inboundReplayQueue` with pause/resume. Removes the concurrent 6–7×S multiplication.
4. **Right-size the relay for the box.** `--max-old-space-size` well under 1 GB; `maxPayload` down from 256 MiB; stream `readFrames` rather than loading the log into an array.
5. **Free empty rooms.** `closeConn` only deletes from `docs` when `persistence !== null`, and `YPERSISTENCE` is deliberately unset — so every room leaks a `WSSharedDoc` + `Awareness` forever.

## 8. Alternatives considered

| Option | Why not |
|---|---|
| Keep Yjs, fix only Phase 0 | Removes the 20 GB spike but leaves cold start and server storage O(history), the 30-day TTL desync cliff, and atomic non-resumable cold start |
| Automerge or another CRDT | Same O(history) cost model, heavier runtime |
| Yjs + y-sweet / y-redis | Server must decrypt to merge — abandons the zero-knowledge property |
| Operational Transform | Requires an authoritative smart server; designed for text |
| CouchDB / PouchDB replication | Closest shipping product, but rev-trees are a heavier conflict model than needed and the Erlang VM idles ~200 MB — untenable at 1 GB alongside the file-service |
| ElectricSQL / PowerSync / Replicache | Server must understand rows (Postgres) — abandons E2EE; Postgres is uncomfortable at 1 GB |
| Litestream / libSQL embedded replicas | Single-writer; this is multi-master |
| Git-style content-addressed sync | Merge remains the client's problem and the object store grows like the CRDT |
| Delta log **without** `key_tag` | Avoids the §3 privacy delta, but loses server-side compaction: storage becomes O(ops since the slowest device) instead of O(live rows). Recorded as the fallback if the envelope leak is judged unacceptable |

## 9. Open questions

- **Clock skew.** `nowHLC()` is `Date.now()` plus a local counter; it never ingests a remote maximum, so it is not a true HLC. A device with a badly wrong clock wins every conflict permanently. The bug predates this change and exists identically under Yjs, but the delta log provides the first place to fix it — a server receive-timestamp plus client-side clamping of far-future clocks. Decide whether to fix in-scope or track separately.
- **Domain granularity of cursors — RESOLVED (one per room).** The server (§4.1) has one `seq` counter per room, not per domain — `ops.key_tag` is opaque by design (§3's non-correlation requirement), so the server cannot filter `GET /ops` by domain even if asked to. A per-domain `since` would therefore require either N separate room-wide streams read redundantly (defeats compaction/paging) or a server-side domain index (reintroduces the correlation the envelope deliberately avoids). Decision: `GET /rooms/{room}/ops?since=N` is the single resumable pull cursor, stored as one `sync_checkpoints` row (domain `deltaLog:room`) driving cold start (task 4.2/4.3). Per-entity-domain rows in `sync_checkpoints` remain, but as a record of last-applied seq per domain for diagnostics/UI only — never as an independent fetch cursor.
- **Service boundary.** Fold the delta log into the existing file-service (one process, one disk budget, shared auth) or run it beside the relay during dual-run? Folding is likely right at 1 GB, but complicates the P0–P7 overlap.
- **`localStorage` domain scope.** The bridge currently syncs whatever is not blocklisted. Migration is a natural point to invert it to an allowlist, but that changes user-visible behaviour and may belong in its own change.
