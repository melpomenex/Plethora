## Context

Incrementum currently uses a singleton `Y.Doc` backed by `y-indexeddb`, an encrypted `y-websocket` provider, and independently initialized replicated maps. A `ReplicatedMap` observes a top-level Yjs map and projects remote values into SQLite through Tauri commands. The entity layer already covers collections, extracts, learning items, reviews, RSS feeds/article state, podcasts, and conversations, but startup warm-up, migration, IndexedDB replay, cryptographic setup, remote merge, and many individual SQLite calls can all compete with the UI thread.

The current lifetime room document also mixes hot state, long-lived history, and bulk metadata. As the product closes sync-coverage gaps, first sync and old-room replay become less bounded. Merely adding debounces or larger batches postpones the failure: the system needs an architectural performance boundary and an explicit answer for every persisted state domain.

Constraints include offline-first operation, Tauri desktop/mobile WebViews, mandatory state encryption, SQLite as the local application store, backward compatibility with existing rooms, and correct multi-device review scheduling. User data must remain available even if IndexedDB, the relay, encryption-key access, a map adapter, or a remote payload fails.

## Goals / Non-Goals

**Goals:**

- Render a usable app from the local database without waiting for sync initialization.
- Converge all UX-meaningful state while bounding main-thread, database, memory, network, and battery cost.
- Make sync work interruptible, resumable, idempotent, observable, and independently quarantinable by domain/shard.
- Prevent sync omissions by defining a machine-readable policy for every persisted user-facing domain and checking mutation paths.
- Keep CRDT history bounded through partitioning, snapshots, and conservative compaction.
- Preserve correct review/event semantics and deterministic conflict resolution across offline devices.

**Non-Goals:**

- Synchronizing secrets, access tokens, machine-specific paths, ephemeral component state, caches, embeddings, indexes, logs, or downloaded file bytes.
- Blocking navigation until remote state is current or promising instantaneous convergence on a backgrounded mobile app.
- Replacing SQLite, Yjs, the encrypted transport, or the existing durable file service.
- Collaborative text editing, shared cursors, team permissions, or server-side inspection of encrypted state.

## Decisions

### 1. Local-first startup has a hard dependency boundary

`main.tsx` will render after settings needed for the local shell and SQLite are ready. It will schedule `startProgressiveSync()` after first paint; no route loader or ordinary local mutation awaits global sync readiness. Sync returns per-domain readiness promises only for flows that explicitly require remote certainty, such as pairing validation or an integrity repair.

Every local mutation commits to SQLite first and appends a compact record to a durable sync outbox in the same logical operation. Publishing to Yjs drains the outbox asynchronously. Incoming records first enter a durable inbox and are then projected idempotently, so a crash or cancellation cannot lose acknowledged work.

Alternative rejected: making Yjs canonical and waiting for it before local reads. It gives a simpler abstract source of truth but turns persistence replay, crypto, and network health into availability dependencies.

### 2. Use Progressive Sync Lanes with deadline-based cooperative scheduling

The coordinator assigns work to four lanes:

| Lane | Content | Scheduling |
|---|---|---|
| P0 Immediate | room index, tombstones, recent review events/card schedule, RSS read/queued transitions, current reading/media positions | after first paint; short slices; preempts lower lanes |
| P1 Interactive | learning items, extracts, collections, bookmarks/annotations, subscriptions, safe preferences, recent conversations | while foreground and input is idle |
| P2 Library | document/feed/episode metadata, older history, bulk imports, manifests | idle slices; network/power aware |
| P3 Rebuildable | audits, snapshots, compaction, cache/index regeneration triggers | prolonged idle or explicit maintenance |

The scheduler uses `scheduler.postTask`/`isInputPending` when present and a `MessageChannel`/timer fallback. A work unit receives a deadline and processes bounded records/bytes before yielding. Initial budgets are conservative (target <= 4 ms main-thread work per slice, <= 50 records or 256 KiB decoded input, and <= 100 SQLite rows per transaction) and are adjusted from observed slice duration. Long tasks (>50 ms), input latency, memory pressure, page visibility, connection type, and mobile power hints reduce or suspend lower lanes. Correctness never depends on these exact constants; tests use configurable budgets.

Alternative rejected: a dedicated worker for all Yjs work. Yjs and crypto can move partly to a worker later, but Tauri IPC, WebSocket/provider ownership, IndexedDB, and existing adapters still require orchestration. Cooperative scheduling delivers the safety contract without a high-risk rewrite. CPU-heavy snapshot decoding/encryption will use a worker where transfer costs justify it.

### 3. Separate a tiny room index from bounded domain shards

The existing room becomes a backward-compatible bootstrap source. New rooms use an encrypted index document named from the room plus schema generation. It contains only shard descriptors, device acknowledgements, snapshot hashes, and migration state—never entity payloads.

Payloads live in independently loaded Yjs documents keyed by `{domain}:{bucket}:{epoch}`. Domain policies choose the bucket:

- mutable entities: stable hash buckets (initially 16) so only one bounded shard changes per entity;
- event logs such as reviews: calendar epochs plus deterministic event IDs;
- recency state such as RSS and positions: recent/current epoch, with older state folded into snapshots;
- settings and small control state: a single small P0 shard.

The coordinator opens P0 shards first and subscribes to P1/P2 shards lazily. A shard exceeding configured encoded-update, item-count, or replay-time thresholds is snapshotted and rolls to a new epoch. A snapshot is accepted only after hash verification and is retained alongside the prior epoch until all active devices acknowledge it or a conservative retention window expires. Yjs tombstones are never deleted merely because wall-clock time elapsed.

Alternative rejected: subdocuments inside one provider. They improve organization but the parent update history and provider/persistence replay remain a shared failure and performance domain.

### 4. Treat sync as state-based replication over a durable local journal

The app does not synchronously mirror every rapid local transition into Yjs. The outbox coalesces mutable entity updates by entity/field while preserving append-only review events and deletes. Each record includes operation ID, entity key, HLC, schema version, origin device, and payload hash. Inbox application records the operation ID and projection hash in SQLite, making replay safe.

Local SQLite remains the immediate UX source of truth. Remote values merge according to the domain policy, then update SQLite and notify relevant UI stores. A failed entity is dead-lettered without stopping its shard; after a threshold, the shard is quarantined and lower-priority work continues.

Alternative rejected: observing every Yjs change and immediately issuing one IPC call per entry. It is simple but creates unbounded startup fan-out and cannot resume at a precise point.

### 5. Establish a machine-readable Sync Coverage Registry

Each persisted domain registers:

```ts
interface SyncPolicy<T> {
  domain: string;
  classification: "user-state" | "intent" | "metadata" | "derived" | "secret" | "device-local";
  lane: "P0" | "P1" | "P2" | "P3";
  shard: ShardPolicy;
  maxRecordBytes: number;
  conflict: ConflictPolicy<T>;
  deletion: "tombstone" | "append-only" | "local-only";
  exportLocal(cursor: Cursor): AsyncIterable<T>;
  applyRemote(batch: T[], checkpoint: Checkpoint): Promise<void>;
  audit(): Promise<CoverageAudit>;
}
```

Initial policies:

- full replicated user state: collections, documents/source metadata, extracts/highlights, learning items, immutable reviews, bookmarks/annotations, reading sessions/positions, RSS subscriptions and article read/unread/queued state, podcast subscriptions/played/position/transcript availability, conversations, safe profile/preferences;
- replicated intent/metadata: file manifest and availability/download intent, import provenance, device-neutral sort/order choices;
- derived locally: queues, forecasts, streaks/statistics, search/vector indexes, embeddings, summaries reproducible from synced source unless the summary itself was explicitly saved as user content;
- never replicated: credentials/API tokens, encryption secrets, local file paths, window geometry, audio device, cache, debug/telemetry state, transient selections/modals.

CI compares registered Rust persistence domains and frontend mutation APIs against the registry. Tests require create/update/delete/bulk/import mutation coverage and conflict fixtures for every `user-state` policy. Runtime audits compare counts/hashes by bucket without exposing plaintext to the server.

Queue-aware file prefetch uses a separate `fileAvailabilityIntent` map keyed by `{requestingDeviceId}:{fileId}`. The queue publishes only a small horizon (the current item plus the next two document items), refreshes intents with a short expiry, and tombstones keys that leave that device's horizon. Receivers aggregate active intents but never delete bytes when an intent expires; each receiver still applies its own `always`, `wifi-only`, or `manual` policy. This makes queue readiness cross-device without turning queue traversal into an unbounded file download job.

### 6. Conflict semantics are domain-specific, not generic row-LWW

- Reviews are immutable, append-only events with deterministic unique IDs; card schedule is recomputed from the ordered merged review log when projections disagree.
- Independent booleans/transitions (RSS read/unread, queued/unqueued, played/unplayed) use field-level HLC transition clocks.
- Monotonic progress uses a session-aware rule: newest active session wins, while within one session forward progress wins; explicit restart/reset is a separately timestamped intent.
- Mutable content uses field-LWW where independent edits are safe and row-LWW otherwise; deletions use tombstones that dominate older updates.
- Collections/order use fractional position identifiers with deterministic device-ID tie breaking.
- Preferences sync only if marked device-neutral; device-local overrides remain local and inherit the synced default.

### 7. Circuit breakers preserve app availability

Startup sync records phase timings and heartbeats. If IndexedDB replay, shard decode, migration, or projection exceeds its deadline, throws repeatedly, produces an oversized record, or misses coordinator heartbeats, that component is cancelled and quarantined. The provider for unrelated shards remains available.

The user sees a small status (`Up to date`, `Catching up`, `Paused to keep Incrementum responsive`, `Needs attention`) rather than a blocking modal. Automatic retries use backoff and only resume in idle time. Recovery supports retrying a shard, rebuilding its local persistence from a verified snapshot, exporting diagnostics without content, and disabling sync while retaining all local data. Automatic recovery never wipes the full room or all Yjs IndexedDB databases.

### 8. Performance and integrity are release contracts

Automated fixtures model small, large, ten-year, corrupt, and offline-divergent rooms. On the reference low-tier mobile profile, sync-enabled startup must not delay first usable local UI by more than 100 ms versus sync-disabled startup, must introduce no sync-attributable >50 ms main-thread long task before usability, and must stay within configured peak-memory and database-transaction bounds. Exact reference hardware and baselines are recorded by the benchmark harness.

Convergence tests randomly interleave offline mutations, reconnects, cancellation, duplicate delivery, shard rollover, and crashes. They assert equivalent user state, review-log uniqueness, tombstone preservation, outbox/inbox drainage, and deterministic derived schedules.

## Risks / Trade-offs

- [Multiple Yjs documents increase provider and operational complexity] -> Limit concurrently open shards, pool connections where relay support permits, centralize lifecycle in one coordinator, and expose per-shard diagnostics.
- [Local-first writes can briefly show state later superseded by a remote conflict] -> Use domain-aware merges, targeted UI notifications only for material conflicts, and never roll back an immutable local review event.
- [Compaction could strand a long-offline device or resurrect deleted data] -> Keep old epochs through acknowledgements plus retention, include tombstone frontier in snapshots, and test years-offline recovery before enabling deletion.
- [Static priorities can starve large libraries] -> Age queued work upward, reserve a small background share for P2, and show honest catch-up status.
- [Coverage checks cannot infer every dynamic mutation path] -> Combine static registry checks, API contract tests, runtime outbox auditing, and periodic local-vs-replicated hash audits.
- [Cross-document updates are not atomically visible] -> Encode related operation IDs and dependency edges; inbox projection holds dependent operations until prerequisites arrive, while local transactions remain atomic per domain.
- [Migration temporarily duplicates storage] -> Roll shards incrementally, enforce storage headroom, and delete legacy persistence only after verified checkpoints and a rollback window.

## Migration Plan

1. Add instrumentation, startup benchmarks, durable inbox/outbox tables, policy registry, and coordinator behind disabled feature flags; preserve current replication.
2. Route current entity adapters through budgeted batch projection and prove local-first startup without changing the room schema.
3. Fill registry gaps and hook all mutation/import/bulk paths. Run shadow audits comparing legacy maps and new journal output.
4. Introduce the encrypted room index and dual-write to legacy maps plus new P0 shards. New clients prefer shards after verified parity; old clients continue using legacy maps.
5. Migrate P1/P2 domains incrementally, create verified snapshots, and record per-domain cutover in the index. Never migrate all domains in one startup session.
6. Stop legacy writes only after active supported clients advertise shard capability and parity telemetry/tests pass. Retain read fallback for at least one release.
7. Enable conservative compaction separately after offline-device and restore drills pass.

Rollback switches reads/writes back to legacy maps while retaining inbox/outbox records and shards. Schema changes are additive until the rollback window closes; local SQLite data is never removed by rollback.

## Open Questions

- Can the deployed relay efficiently multiplex shard documents over one physical socket, or should the first release cap concurrent providers and accept a few sockets?
- Which Tauri/mobile APIs reliably expose memory and power pressure across Android, iOS, macOS, Windows, and Linux? The scheduler must work correctly when hints are unavailable.
- What active-device acknowledgement and retention window is safe before old shard epochs can be deleted for users with rarely used devices?
- Should explicitly saved AI summaries be first-class user content in P1, or remain regenerable metadata until a dedicated summary model exists?
