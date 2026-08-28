# Change: Implement Plethora Pro Sync (from PRD)

> Source of truth: `docs/sync.prd` (Plethora Pro Sync PRD). Supersedes the delivery claims in `implement-plethora-pro-end-to-end-encrypted-cloud-sync` — that change captured the right architecture but its `tasks.md` does not match the codebase.

## Why

Plethora Pro needs cross-device sync that is **local-first, non-blocking, and reliable** — not the deleted Yjs/CRDT stack that caused multi-GB memory spikes and UI freezes. Users expect cards, reviews, documents, reading position, and preferences to follow them across macOS, Windows, Linux, iOS, and Android without waiting on the network for ordinary actions.

**Why now:** Production billing and the cloud API (`api.useplethora.com`) are in place. The server already exposes `/v1/sync/push` and `/v1/sync/pull` with idempotency and R2 blob offload — but the **client engine is a stub** (in-memory outbox, empty pull, UI that reports success without syncing). Without completing the client journal + worker, Pro sync is not a shippable feature despite surface-level scaffolding.

## What Changes

### Phase scope (this change tracks PRD §58)

This OpenSpec change covers the **full PRD**, delivered in ordered phases. Implementation MUST NOT skip Phase 1–2 (local journal + minimal desktop convergence) before claiming sync works.

| Phase | Scope | Deliverable |
|-------|--------|-------------|
| **0** | Cleanup | Done — Yjs removed; stale docs flagged for update |
| **1** | Local journal | SQLite `sync_outbox`, `mark_dirty`, revisions, tombstones, review append-only |
| **2** | Minimal backend | Wire Rust worker → existing `/v1/sync/*`; two-device convergence tests |
| **3** | Mobile | Background triggers, lifecycle, battery gates |
| **4** | Encryption | Account sync keys, E2EE pipeline, pairing, recovery |
| **5** | File sync | Content-addressed blobs, R2 direct upload/download, quotas |
| **6** | Pro gating | Entitlement checks on sync routes; signed offline grace |
| **7–8** | Beta / GA | Metrics, chaos tests, memory gates |

### Concrete deliverables

- **Local transactional outbox** — every syncable mutation journals in the same SQLite transaction (PRD Rule 3).
- **Rust background sync worker** — push/pull/apply/merge in `src-tauri/src/sync/`; frontend observes status only (PRD §46).
- **Server hardening** — extend existing v1 sync routes: device cursor persistence, conflict responses, Pro entitlement gate, protocol version, tombstone GC.
- **Wire protocol alignment** — reconcile PRD `change_id`/`base_revision`/`server_cursor` with deployed `hlc`/`seq_number` format (extend, do not break production).
- **Merge semantics** — per-entity strategies: append-only reviews, field-LWW for cards/documents, tombstone-wins deletes (PRD §16–20).
- **E2EE** — client-side encryption before upload; server stores ciphertext only (PRD §26).
- **Blob sync** — SHA-256 content addressing, presigned R2 upload/download, lazy retrieval (PRD §21–24).
- **Settings UI** — honest sync status, devices, storage, pairing, recovery key, manual sync (PRD §34).
- **Retire stubs** — replace in-memory `SyncEngine`, fake `syncStore.syncNow()`, legacy `server/src/routes/sync.ts` usage, orphaned `cloud_sync.rs` path for v2 sync.

### Non-goals (PRD §5, unchanged)

- Real-time collaborative editing, global CRDTs, syncing React/Zustand state
- Syncing local AI models, machine paths, API secrets by default
- Sub-second propagation SLA
- Making the remote server authoritative for normal app operation

## Capabilities

### New Capabilities

- `plethora-pro-sync`: Local journal, outbox, Rust sync worker, push/pull protocol, merge/conflict handling, scheduler, sync status UI, Pro entitlement integration, two-device convergence tests.
- `plethora-pro-sync-encryption`: Account sync key hierarchy, record encryption envelopes, device pairing (QR/code), recovery key flow, device-revocation epoch rotation.
- `plethora-pro-sync-blobs`: Content-addressed file metadata, presigned upload/download, deduplicated storage, quota enforcement, lazy download policies.

### Modified Capabilities

- `local-data-plane`: Reverse the post-Yjs-removal "no sync" requirements when Pro sync is enabled — restore sync bookkeeping tables, outbox hooks, and sync settings UI while preserving local-first and non-blocking guarantees.

## Impact

### Affected specs
- New: `plethora-pro-sync`, `plethora-pro-sync-encryption`, `plethora-pro-sync-blobs`
- Modified: `local-data-plane`

### Affected code
- **Client Rust:** `src-tauri/src/sync/` (rewrite), `src-tauri/src/database/migrations.rs` (106+ sync tables), command-layer `mark_dirty` call sites, `src-tauri/src/lib.rs`
- **Client TS:** `src/stores/syncStore.ts`, `src/components/settings/SyncSettingsPanel.tsx`, retire misleading success paths
- **Server:** `server/src/routes/v1/sync.ts`, `server/src/db/schema.ts`, `server/src/sync/blobStorage.ts`, new blob routes; deprecate `server/src/routes/sync.ts`
- **Tests:** two-device harness, merge property tests, chaos/retry tests, memory-bench scenario; update `noRealtimeSync.test.ts` scope (documented — blocks Yjs only, not delta sync)
- **Docs:** replace stale Yjs sync help copy; align with `docs/sync.prd`

### Dependencies (already satisfied or in progress)
- Plethora accounts + device registry (`server/src/routes/v1/auth.ts`, `plethora_auth`)
- Cloud API on production VPS
- Play billing / Pro entitlements (`cloud_sync` capability)
- Domain groundwork: migration `053_sync_state_columns`, deterministic review index, `file_manifest_entries` (069)

### Relationship to prior OpenSpec
- **Reuse architecture** from `implement-plethora-pro-end-to-end-encrypted-cloud-sync` (design decisions, HLC, merge table).
- **Do not trust** that change's completed `tasks.md` — this change replaces it as the honest delivery tracker.
- Historical context: `2026-08-15-remove-realtime-sync`, `migrate-sync-to-delta-log`, `bound-sync-boot-memory`.

### Hard architectural rules (PRD §67 — non-negotiable)
1. SQLite is operational source of truth on every client.
2. Sync never blocks interactive user actions.
3. Every syncable mutation is journaled atomically.
4. No global CRDTs.
5. Binary files do not travel through normal sync record payloads.
6. Review history is append-only.
7. All network operations are safely retryable.
8. Server treats mutations idempotently.
9. App remains useful during complete server outage.
10. Complexity must be justified by product requirement.
