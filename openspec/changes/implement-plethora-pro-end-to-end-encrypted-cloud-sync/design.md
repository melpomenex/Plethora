# Design: Bounded-Memory Encrypted Delta Sync

## Context

The deleted Yjs subsystem failed on unbounded memory (replicated docs held in RAM, eager caches, unbounded boot chains) and an unschedulable boot sequence. The delta-log followup (also deleted with it) had the right shape: cursor-addressed encrypted op log, HMAC auth, server GC by min device cursor. This design merges those lessons with the current codebase's reality (SQLite domain tables with `device_id`/`updated_at` groundwork from migration 053).

## Non-negotiable rules (from failure analysis)

1. **Sync never runs on the UI startup critical path.** Engine initializes lazy; first flush is idle-scheduled post-first-paint.
2. **Every buffer is bounded**: outbox cap (default 20k records, oldest-first spill-free drop only of *positions*, never of user content), pull page cap (500 records / 8 MB), in-flight map per table kind capped with streaming apply (apply-as-you-page, never materialize full pull).
3. **No CRDT documents.** Row-level typed records with deterministic merge functions per table kind. Simpler, testable, and the domain is not collaborative editing.
4. **Server is dumb storage.** Sequence numbers + ciphertext + envelope metadata. All intelligence client-side. This is what makes zero-knowledge cheap and the service cheap.

## Key hierarchy

```
RecoveryKey (32B, BIP39 words, user-held)
   └─ HKDF → SyncMasterKey (epoch-scoped: epoch n rotated on device revocation)
        └─ K_collection = HKDF(SyncMasterKey, "col:" + collection_uuid)
             └─ per-record AES-256-GCM(key=K_collection,
                  plaintext=record JSON, AAD=account|table_kind|record_id|hlc|epoch)
Enrollment: existing device wraps SyncMasterKey → X25519(new device pubkey)
```

- Epoch rotation on revocation: pusher includes `epoch`; pullers older than epoch are rejected by key_version mismatch → forces re-enrollment gate. No bulk re-encryption (per-collection data keys re-derived; new pushes use new epoch).

## Record & wire format

```rust
SyncRecord { table_kind: TableKind, record_id: String, hlc: u64,
             device_id: String, epoch: u32,
             ct: Vec<u8>, nonce: [u8;12], aad_hash: [u8;32] }
TableKind ∈ { Document, Extract, LearningItem, ReviewResult, ReviewLog,
              Collection, Category, Tag, Tagging, Setting, RssFeedState,
              PodcastEpisodeState, ImageAsset, DocumentBinaryChunk, Tombstone }
```

## Merge semantics (per TableKind)

| Kind | Strategy |
|---|---|
| Document | field-LWW by HLC (positions cheap; content fields immutable post-ingest) |
| Extract | field-LWW; `source_hash` immutability respected |
| LearningItem | field-LWW; `algorithm_state` merged by scheduler-owned rules (latest applied review wins via deterministic review union) |
| ReviewResult / ReviewLog | append-only union, dedupe on deterministic ids (`(device_id, reviewed_at_ms, item)` unique index already exists) |
| Collection / Category / Tag | additive union; rename = LWW; delete = tombstone-wins |
| Setting | field-LWW; per-key opt-out list (device-local settings excluded) |
| DocumentBinaryChunk | content-addressed; union; GC with tombstone |

Conflicts that LWW would make lossy (same extract edited meaningfully on two devices) → surfaced in sync issues list, never auto-discarded.

## Client engine layout

```
src-tauri/src/sync/
  mod.rs        // SyncEngine: scheduler, lanes, budget guards
  clock.rs      // persisted HLC
  crypto.rs     // hierarchy, epochs, pairing wrap/unwrap
  outbox.rs     // bounded outbox + mark_dirty ingestion
  puller.rs     // cursor paged pull, streaming apply
  merge.rs      // per-TableKind strategies (pure functions, heavily unit-tested)
  server.proto (or JSON) client over plethora_cloud transport
```

Lanes (progressive sync, resurrected as *priority classes* not startup gates): `fast` (settings, positions, review results) → `core` (extracts, items, collections) → `bulk` (binaries, backfill) — each with own cadence and network/battery constraints.

## SQLite additions (next free migration numbers; re-anchor at merge)

`sync_outbox(id, table_kind, record_id, hlc, lane, payload, attempts)`,
`sync_cursor(device_seq)`, `sync_clock(hlc)`, `sync_issues(id, kind, resolution_state, payload)`, `sync_meta(key,value)`.

## Server additions (Postgres, proposal-5 framework)

`sync_seq` allocator (per account, `UPDATE ... RETURNING` blocks like the old design), `sync_records(account, seq, epoch, table_kind, record_id, device_id, ct, nonce, aad_hash)`, `sync_device_cursors` for GC (records below min cursor older than 90 days pruned).

## Testing strategy

- Pure merge-function property tests (commutativity/associativity/idempotence of unions and LWW merges).
- Memory budget: synthetic 50k-record backlog → PSS ceiling scenario in `scripts/memory-bench/` with `check-memory-budget.mjs` gate.
- Chaos: pull interrupted mid-page; push partial batch; clock skew; epoch change mid-sync.
- Zero-knowledge scans: no plaintext columns, log scrubbing verified.
