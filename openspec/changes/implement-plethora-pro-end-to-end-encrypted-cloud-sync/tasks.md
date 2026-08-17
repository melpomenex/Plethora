# Implementation Tasks

## 1. Contracts first (unblocks parallel UI + server work)
- [ ] 1.1 `SyncRecord`/`TableKind`/envelope types + wire format doc
- [ ] 1.2 `/v1/sync/*` endpoint contracts + Postgres tables (`sync_records`, seq allocator, device cursors)
- [ ] 1.3 `SyncEngine` Rust API surface (`mark_dirty`, `flush`, `status`) for command-layer integration

## 2. Crypto
- [ ] 2.1 `crypto.rs`: RecoveryKey (word list), HKDF hierarchy, per-record AES-GCM + AAD, epochs
- [ ] 2.2 Pairing wrap/unwrap (X25519) + enrollment protocol; device-revocation epoch rotation
- [ ] 2.3 Key storage via AuthStore namespace; recovery flow UX
- [ ] 2.4 Crypto unit tests: tamper, epoch, recovery, pairing negative cases

## 3. Client engine
- [ ] 3.1 SQLite migrations: outbox/cursor/clock/issues/meta (next free numbers; re-anchor rule)
- [ ] 3.2 `clock.rs` HLC; `outbox.rs` bounded + lanes (fast/core/bulk); `mark_dirty` call sites in command layer (additive)
- [ ] 3.3 `puller.rs`: cursor paging, streaming apply, page caps
- [ ] 3.4 `merge.rs` per-TableKind strategies + property tests (commutative/idempotent)
- [ ] 3.5 Scheduler: focus/mutation/network triggers, battery gates for bulk lane, backoff
- [ ] 3.6 Sync issues conflict list + resolution sheet

## 4. Server
- [ ] 4.1 Rewrite `routes/sync.ts`: push (idempotent), pull (paged), seq allocation, cursors
- [ ] 4.2 90-day tombstone GC by min device cursor; account data wipe endpoint
- [ ] 4.3 Storage-quota accounting (bytes) via proposal-5 metering
- [ ] 4.4 Zero-knowledge enforcement tests (storage + log scans)

## 5. UI
- [ ] 5.1 `syncStore.ts` + `plethora-sync-status-changed` event
- [ ] 5.2 SyncSettings: status/devices/storage/pause/sync-now; pairing dialog (QR + code); RecoveryKey display/acknowledgment
- [ ] 5.3 Amend `noRealtimeSync.test.ts` scope (documented); remove/retire `SyncStatusIndicator` orphan or revive
- [ ] 5.4 i18n: 6 locales

## 6. Validation
- [ ] 6.1 Two-device E2E harness (simulated devices in tests): converge/conflict/revoke/offline-replay
- [ ] 6.2 Memory-budget scenario in `scripts/memory-bench/` + gate; startup-parity benchmark vs sync-disabled
- [ ] 6.3 Chaos: mid-page pull abort, partial push, clock skew, epoch change mid-sync
- [ ] 6.4 Full gates: vitest, cargo test, bench:check (update `perf-baselines.json` if any measured path shifts, per AGENTS.md)
