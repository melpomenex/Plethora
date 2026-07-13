## Why

Incrementum's increasingly complete Yjs room can replay, decrypt, merge, and project a large CRDT history during app startup, risking a frozen first frame precisely as more UX state is added to sync. Sync must become both comprehensive and invisible: local data should be usable immediately, while cross-device convergence proceeds within explicit CPU, memory, I/O, and network budgets.

## What Changes

- Introduce a non-blocking startup contract: opening the local database and rendering the usable shell never waits for Yjs persistence, encryption setup, WebSocket connection, migration, or remote projection.
- Replace eager all-map warm-up with a **Progressive Sync Lanes** coordinator. Small, user-visible state is reconciled first; bulk/library state follows opportunistically; derived, cacheable, or binary state is regenerated or transferred outside the CRDT.
- Add an adaptive work budget that slices decode, merge, migration, and SQLite projection into interruptible batches, yields to user input and animation frames, pauses under memory/thermal pressure, and resumes from durable checkpoints.
- Partition future sync history by bounded logical shards and epochs instead of allowing one lifetime `Y.Doc` to grow without limit. Maintain a tiny encrypted room index that lets devices subscribe only to relevant shards and compact superseded history safely.
- Define a sync coverage registry for every persisted user-facing domain. Each domain must explicitly declare its sync policy, conflict semantics, deletion behavior, priority lane, payload limits, and whether bytes, intent, metadata, or no state should replicate.
- Guarantee UX-meaningful replication for learning items and immutable review events, documents and extracts, collections, RSS subscriptions plus read/unread/queued state, reading and media positions, bookmarks and annotations, podcast state, conversations, safe user preferences, and file availability intent.
- Exclude secrets, device-only preferences, transient UI state, disposable caches, downloaded bytes, search indexes, embeddings, and other reproducible derivatives; synchronize safe intent or source metadata where that recreates the same experience.
- Add deterministic reconciliation and audit tooling that detects uncovered mutation paths, projection drift, duplicate reviews, missing tombstones, and shard/index inconsistencies without blocking startup.
- Add measurable performance gates and a degraded-mode circuit breaker: slow/corrupt sync is quarantined and retried in the background while the app remains fully usable offline, with concise status and recovery controls.

## Capabilities

### New Capabilities
- `progressive-sync-runtime`: Non-blocking, budgeted, prioritized, resumable CRDT synchronization with shard lifecycle, compaction, circuit breaking, and startup/performance service-level objectives.
- `sync-coverage-governance`: A complete registry and enforceable contract for UX-meaningful state replication, conflict resolution, tombstones, mutation-path coverage, projection integrity, and privacy exclusions.

### Modified Capabilities

## Impact

- Frontend sync lifecycle in `src/main.tsx`, `src/lib/yjsSync.ts`, `src/lib/sync/migrate.ts`, `src/lib/sync/replicatedMap.ts`, entity adapters under `src/lib/sync/entities/`, and sync status/recovery UI.
- Tauri projection commands and SQLite migrations for durable sync cursors, inbox/checkpoints, idempotent batch application, and integrity audits.
- The encrypted Yjs transport and relay/file service gain a small room index, shard/epoch naming, snapshot/compaction support, and backward-compatible migration from the current monolithic room.
- Mutation APIs across learning, review, RSS, reader, podcast, document, extract, collection, conversation, and settings domains must publish through registered sync policies.
- New performance, convergence, chaos, migration, and coverage tests; no new user-facing startup dependency and no requirement that the network be available.
