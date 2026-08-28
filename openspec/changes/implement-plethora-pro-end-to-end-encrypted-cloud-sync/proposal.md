# Change: Implement Plethora Pro End-to-End Encrypted Cloud Sync

> **Superseded for delivery tracking** by `implement-plethora-pro-sync-from-prd` (Aug 2026). That change resets honest task status against `docs/sync.prd` and the current codebase audit. Architecture here remains a useful reference; do not treat `tasks.md` in this folder as complete.

> Wave 2 — Cloud Capabilities (critical path). Hard-depends on proposals 3 (accounts/devices) and 5 (cloud service framework). Capability: `cloud_sync`.

## Why

Plethora Sync is a flagship Pro differentiator: application-aware, end-to-end-encrypted, multi-device consistency for reading position, highlights, extracts, notes, queues, review state, flashcard scheduling, settings, and metadata — substantially better than dropping an app directory into Dropbox (no whole-DB swaps, per-record granularity, conflict resolution, tombstones, privacy from the server itself).

**Critical history**: this repository *had* a Yjs-based realtime sync subsystem (~35.9k lines) that was hard-disabled and then **deleted entirely** (commit `b42a9743`, archived change `2026-08-15-remove-realtime-sync`) after causing 15+ GB RSS spikes and ~5-minute freezes; migration `087_drop_sync_tables` removed all 13 `sync_*` tables. The failure modes are documented in `openspec/changes/bound-sync-boot-memory/proposal.md` and the design lessons in `overhaul-cross-device-sync`, `migrate-sync-to-delta-log`, `introduce-progressive-sync-lanes`, `encrypt-sync-by-default`, and `sync-everything-v1/README.md` (HLC clocks, deterministic review ids, tombstone TTL, replicated-map merge semantics). **This proposal deliberately does not resurrect Yjs.** It builds a bounded-memory, record-based delta sync engine informed by those lessons.

## What exists today
- **No sync at all.** `cloud_sync.rs` (525 lines) is a skeleton (`get_local_changes()` returns empty; force-upload/download are TODOs) wired to 4 stub commands. `src/__tests__/noRealtimeSync.test.ts` guards against the old subsystem's return; `syncResidueCleanup.ts` deletes its residue.
- **Surviving domain groundwork**: `device_id`, `reviewed_at_ms` (unique deterministic index), and `updated_at` HLC-style columns on domain tables from migration 053; deterministic review ids (for idempotent replay); `file_manifest_entries` table (069).
- **Encryption precedents**: backup AES-256-GCM + PBKDF2 (`backup/manager.rs`); historical Argon2id room-key derivation + per-frame AES-GCM (deleted, documented); AuthStore keychain.
- **Cloud service** (proposal 5): jobs, storage, quotas, auth — sync rides on it.
- **What syncs conceptually** maps cleanly onto existing tables: documents (incl. `position_json` reading positions per format), extracts (+ highlights/notes fields), learning_items (cards + scheduling), review_results/review_log (append-only), collections, categories, tags, settings KV, rss feed state, podcast episode state, image_assets metadata, deletion tombstones.

## What Changes

### 1. Sync model — encrypted record delta log per account
- **Unit of sync = typed record** (`SyncRecord`: `{ table_kind, record_id, hlc, device_id, payload_ciphertext, aad }`) — NOT documents, NOT CRDT frames. Records are per-row deltas of whitelisted tables.
- **Hybrid Logical Clocks** per device (`sync_clock` persisted) for ordering (pattern proven in deleted `syncClock.ts`; server assigns monotonic sequence numbers on ingest — server never sees plaintext).
- **Transport**: `POST /v1/sync/push` (batched op log, idempotent by `(device_id, hlc)`), `GET /v1/sync/pull?cursor=` (paged delta log addressed by server sequence), `DELETE /v1/sync/data` (account data wipe). Pull is cursor-addressed and **bounded page size** (hard cap, default 500 records / 8 MB per page) — the anti-memory-disaster rule.
- **Tombstones** with 90-day GC (server-side min-device-cursor rule from the delta-log design); deletions never resurrect (the `fix-deleted-documents-reappearing` class of bug).

### 2. E2E encryption
- **Key hierarchy**: account `RecoveryKey` (32 bytes, shown once as BIP39-style words) → HKDF → `SyncMasterKey`. Per-collection (library) data keys `K_collection = HKDF(SyncMasterKey, collection_id)`; per-record AES-256-GCM with AAD binding `(account, table_kind, record_id, hlc)` — ciphertext is moveable but not malleable across records. Server stores ciphertext + envelope metadata only (`key_version`); **zero-knowledge**: server cannot read payloads, only sizes/timing (documented threat model).
- **New device enrollment**: signed-in device generates keypair (proposal 3 registry); an existing device approves via **pairing code (QR or 6-digit)** and wraps `SyncMasterKey` to the new device's public key (X25519). **Device revocation**: revoking rotates the sync key via a new epoch — revoked devices keep ciphertexts they hold but cannot read future epochs; epoch re-wrap re-encrypts nothing (envelope re-issuance at next push per collection).
- **Recovery**: RecoveryKey restores the master key; lost key + zero enrolled devices = unreadable cloud data (explicit, user-acknowledged).

### 3. Client engine (`src-tauri/src/sync/` — new module; name is safe, old subsystem lived in frontend)
- **Outbox/inbox with strict budgets**: dirty-row triggers write to a bounded `sync_outbox` (new migration, next free number — expected 088+; re-anchor at implementation time per repo rule). Push drains in batches with backoff; **startup never blocks on sync** (lesson: progressive lanes — small-state records (settings, positions, review results) sync first, bulk content (document binaries) later, idle-time).
- **Merge semantics per table kind** (from `sync-everything-v1` replicatedMap patterns): field-level LWW-HLC for documents/extracts/settings; append-only deterministic-id union for review_results/review_log; additive union + tombstone-wins for tags/collections membership; **no automatic merge** for conflicting simultaneous position edits (last-writer-wins per device — positions are cheap; annotations never lost).
- **Conflict resolution UX**: silent LWW for cheap fields; a **sync issues list** surfaces non-trivial conflicts (e.g. same extract edited on two devices) with a resolution sheet (keep mine / keep theirs / both).
- **Optional document binary sync**: opt-in per document or collection; chunked encrypted blob upload via the storage quota; local-file documents stay local by default. **Storage quota** (`cloud_sync` capability envelope in bytes) surfaces in settings.
- **Sync scheduler**: opportunistic (app focus, after mutations, network-available events), never a busy loop; full battery-gate reuse (`battery.rs`) for bulk phases on mobile; airplane-mode safe.

### 4. UI
- Settings → Sync: status (devices, last sync, pending counts), storage usage, encryption explainer, RecoveryKey management, device management (proposal 3 registry), "sync now", pause. Subtle status surface reuses patterns from the (now orphaned) `SyncStatusIndicator.tsx` component — either revive or replace; the `noRealtimeSync.test.ts` guard is updated intentionally (scoped amendment, documented).

### 5. Migration from "no sync" status quo
- First enablement: initial upload streams whitelisted records in batches (resumable; progress in UI; bandwidth caps). Users of the old deleted system have nothing to migrate (server-side data was on the decommissioned relay; residue cleanup already handled locally).

## Impact

### Affected Specs
- `plethora-sync` — New (record model, E2E encryption, enrollment/revocation, merge semantics, budgets).

### Affected Code Areas
- New: `src-tauri/src/sync/` (engine, crypto, outbox, merge), `server/src/routes/sync.ts` (rewrite of deprecated route), Postgres `sync_*` v2 tables; SQLite migrations (outbox/cursors/clock); `src/components/settings/SyncSettings*.tsx`; `src/stores/syncStore.ts`.
- Modified: `lib.rs` (state + commands), `noRealtimeSync.test.ts` (scoped update), repository hooks for dirty tracking (event-based, not triggers on every write — explicit `mark_dirty(table, id)` calls in command layer).
- Untouched: reader internals; scheduling algorithms; all sync-free local behavior.

### Non-goals
- No realtime collaborative editing, no Yjs/CRDT re-introduction, no sync of media binaries by default, no cross-account sharing, no server-side search over synced data (E2E precludes it), no folder-watch sync (the old Dropbox-style cloud_sync.rs skeleton is retired).

## Dependencies

### Hard dependencies
- Proposals 3 (accounts/devices/keypairs), 5 (service/storage/quota framework), rebrand.

### Soft dependencies
- Proposal 22 (privacy disclosures reference sync's threat model; crypto review).

### May run concurrently
- 16–20 (parallel cloud capabilities on the same framework); 7 (local intelligence — independent).

### Must not start yet
- Proposal 23's sync-marketing claims; multi-account sync.

## Shared interfaces (owned here)
- `/v1/sync/*` endpoints; `SyncRecord` wire format + encryption envelope; `sync/` Rust engine API (`SyncEngine::enqueue/mark_dirty/flush/status`); `syncStore`; sync capability quota unit (bytes).

## Ownership boundaries
- **May modify**: new sync modules, sync routes, its tables, SyncSettings UI, dirty-tracking call sites in command layer, `noRealtimeSync.test.ts` (documented amendment).
- **Must treat as external**: account/device registry (3), job framework internals (5), reader/scheduling internals, backup system (stays independent — DB backup ≠ sync).

## Collision risks
- `src-tauri/src/lib.rs` + repository command layer (dirty-tracking hooks touch many command files — keep the `mark_dirty` primitive tiny and additive); migration numbering (re-anchor rule); `server/src/routes/sync.ts` (owned here, deleted-deprecated version replaced).

## Integration contract
- Consumes proposal-3 device keypairs + AuthStore; proposal-5 transport conventions (error envelope, rate limits) but sync uses its own paged endpoints (not the job system — sync is request/response, not long-running compute); exposes `plethora-sync-status-changed` event for UI; declares storage-quota usage to proposal-5 metering.

## Testing & acceptance

### Tests
- **Crypto**: round-trip encrypt/decrypt with AAD tamper rejection; key rotation epoch (revoked device cannot decrypt new epoch); recovery-key restore; pairing wrap/unwrap.
- **Engine**: outbox batching/backoff/bounded memory (RSS ceiling under a 50k-record backlog — memory-bench scenario added to `scripts/memory-bench/`); cursor pagination correctness; tombstone GC; no-resurrect deletion tests; offline mutation queue replay; conflict matrices per table kind (LWW field merges, append-union dedupe by deterministic id, position cheap-merge).
- **Startup budget**: time-to-interactive with sync enabled vs disabled within existing memory/time baselines (extend `bench:memory` scenarios; update baselines per AGENTS.md protocol).
- **Server**: zero-knowledge assertion (no plaintext at rest or in logs — enforced by test scanning stored rows/logs); paging bounds; idempotent push; min-cursor GC.
- **E2E (two simulated devices)**: create→sync→edit→sync→conflict→resolve; revoke device mid-sync.

### Acceptance criteria
- Two devices converge on reading positions, extracts, cards, review history, settings within seconds of connectivity; deletion stays deleted; a fresh device enrolls via pairing and catches up without blocking UI; airplane mode queues and replays; revoking a device locks it out; server stores no readable content; app with sync disabled behaves identically to today.

### Must remain unchanged
- All local behavior with sync off (guarded by tests); perf gates for non-sync paths.

## Open questions
1. Sync of AI-derived indices (semantic chunks/embeddings): re-derive locally vs sync vectors (default: re-derive; bandwidth vs compute tradeoff — revisit with proposal 7).
2. Encrypted-backup-of-sync-key ergonomics (paper copy vs optional cloud escrow).
3. Whether settings sync includes AI provider keys (default NO — keys stay device-local).
