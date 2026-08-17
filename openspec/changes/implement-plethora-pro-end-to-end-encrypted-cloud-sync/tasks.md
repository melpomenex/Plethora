# Implementation Tasks

## 1. Contracts first (unblocks parallel UI + server work)
- [x] 1.1 `SyncRecord`/`TableKind`/envelope types + wire format doc
- [x] 1.2 `/v1/sync/*` endpoint contracts + Postgres tables (`sync_records`, seq allocator, device cursors)
- [x] 1.3 `SyncEngine` Rust API surface (`mark_dirty`, `flush`, `status`) for command-layer integration

## 2. Crypto
- [x] 2.1 `crypto.rs`: RecoveryKey (word list), HKDF hierarchy, per-record AES-GCM + AAD, epochs
- [x] 2.2 Pairing wrap/unwrap (X25519) + enrollment protocol; device-revocation epoch rotation
- [x] 2.3 Key storage via AuthStore namespace; recovery flow UX
- [x] 2.4 Crypto unit tests: tamper, epoch, recovery, pairing negative cases

## 3. Client engine
- [x] 3.1 SQLite migrations: outbox/cursor/clock/issues/meta (next free numbers; re-anchor rule)
- [x] 3.2 `clock.rs` HLC; `outbox.rs` bounded + lanes (fast/core/bulk); `mark_dirty` call sites in command layer (additive)
- [x] 3.3 `puller.rs`: cursor paging, streaming apply, page caps
- [x] 3.4 `merge.rs` per-TableKind strategies + property tests (commutative/idempotent)
- [x] 3.5 Scheduler: focus/mutation/network triggers, battery gates for bulk lane, backoff
- [x] 3.6 Sync issues conflict list + resolution sheet

## 4. Server
- [x] 4.1 Rewrite `routes/sync.ts`: push (idempotent), pull (paged), seq allocation, cursors
- [x] 4.2 90-day tombstone GC by min device cursor; account data wipe endpoint
- [x] 4.3 Storage-quota accounting (bytes) via proposal-5 metering
- [x] 4.4 Zero-knowledge enforcement tests (storage + log scans)

## 5. UI
- [x] 5.1 `syncStore.ts` + `plethora-sync-status-changed` event
- [x] 5.2 SyncSettings: status/devices/storage/pause/sync-now; pairing dialog (QR + code); RecoveryKey display/acknowledgment
- [x] 5.3 Amend `noRealtimeSync.test.ts` scope (documented); remove/retire `SyncStatusIndicator` orphan or revive
- [x] 5.4 i18n: 6 locales

## 6. Validation
- [x] 6.1 Two-device E2E harness (simulated devices in tests): converge/conflict/revoke/offline-replay
- [x] 6.2 Memory-budget scenario in `scripts/memory-bench/` + gate; startup-parity benchmark vs sync-disabled
- [x] 6.3 Chaos: mid-page pull abort, partial push, clock skew, epoch change mid-sync
- [x] 6.4 Full gates: vitest, cargo test, bench:check (update `perf-baselines.json` if any measured path shifts, per AGENTS.md)
