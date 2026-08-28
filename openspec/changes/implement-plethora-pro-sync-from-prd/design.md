## Context

**Product source:** `docs/sync.prd` — local-first Plethora Pro Sync via transactional outbox, batched push/pull, monotonic server cursors, deterministic merge, optional E2EE, content-addressed blobs.

**Current state (honest audit, Aug 2026):**

| Component | Status |
|-----------|--------|
| Yjs/CRDT sync | Removed (`2026-08-15-remove-realtime-sync`); migration `087` dropped all local sync tables |
| Server `/v1/sync/*` | Implemented: idempotent push by `(user_id, device_id, hlc)`, paged pull by `seq_number`, R2 offload for large ciphertext |
| Client `SyncEngine` | Stub: in-memory `Vec` outbox; `sync_pull` returns empty; no HTTP |
| `syncStore.syncNow()` | Calls stub + POST `{ records: [] }`; marks success without syncing |
| Crypto | `crypto.rs` has AES-GCM helpers; not wired to transport |
| UI | `SyncSettingsPanel` exists; shows "Ready & Up to date" regardless |
| Pro gate | `cloud_sync` entitlement exists; sync routes do not enforce it |
| Domain prep | Migration `053`: `device_id`, `updated_at`, `reviewed_at_ms`, deterministic review unique index |

**Constraints from prior failure:**
- Sync must not run on startup critical path (15+ GB RSS / multi-minute freezes from Yjs).
- Pull pages must be bounded (500 records / 8 MB default).
- No materializing full account state in memory.
- Network calls never inside SQLite transactions.

**Production constraint:** `/v1/sync/push` and `/pull` are deployed. Wire format changes must be **backward-compatible extensions**, not breaking rewrites.

## Goals / Non-Goals

**Goals:**
- Deliver PRD Phase 1+2 MVP first: persistent outbox + desktop↔desktop convergence for `learning_items` and `review_results`.
- Extend to full PRD scope in phased tasks (mobile, E2EE, blobs, Pro gate, beta gates).
- Reuse existing server scaffold and auth/billing infrastructure.
- Meet PRD §66 acceptance criteria before GA.

**Non-Goals:**
- Resurrecting Yjs, WebSocket-as-canonical-transport, or realtime co-editing.
- Syncing React/Zustand, local AI models, OS paths, API keys by default.
- Server-side plaintext search over user content (incompatible with E2EE target).

## Decisions

### D1 — Wire format: extend deployed schema, align with PRD semantics

**Decision:** Keep deployed fields (`tableKind`, `recordId`, `hlc`, `deviceId`, `payloadCiphertext`, `aad`, `keyVersion`, `seq_number`) and **add** PRD fields in envelope JSON inside ciphertext and in optional push metadata:

- `change_id` (UUIDv7) — maps to client outbox primary key; server idempotency key becomes `(user_id, change_id)` **in addition to** existing `(device_id, hlc)` for transition.
- `base_revision` / `revision` — per-entity version for conflict detection; stored server-side in new `entity_revisions` table.
- `operation` — `create | update | delete | append_event`.
- `sync_protocol_version` — header on push/pull (default `1`).

**Rationale:** Avoid breaking production API; PRD conflict model requires revisions — add without removing HLC ordering.

**Alternatives rejected:** Full protocol rewrite (requires coordinated client+server deploy); using only HLC without revisions (insufficient for PRD §19 field-merge conflicts).

### D2 — Local journal schema (SQLite migration 106+)

**Decision:** Recreate sync tables dropped in `087`:

```sql
sync_outbox (
  change_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  base_revision INTEGER,
  payload BLOB NOT NULL,          -- serialized row delta (plaintext locally; encrypted at push)
  created_at INTEGER NOT NULL,
  attempt_count INTEGER DEFAULT 0,
  last_attempt_at INTEGER,
  sync_status TEXT DEFAULT 'pending'  -- pending|uploading|acknowledged|failed
)

sync_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_server_cursor INTEGER NOT NULL DEFAULT 0,
  last_successful_sync INTEGER,
  device_id TEXT NOT NULL
)

sync_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  hlc INTEGER NOT NULL DEFAULT 0
)

sync_meta (key TEXT PRIMARY KEY, value TEXT)
sync_issues (id TEXT PRIMARY KEY, ...)  -- phase 2b
```

**Rationale:** Matches PRD §10; separate from domain tables; compacted after ack.

**Hook pattern:** `mark_dirty(conn, entity_type, entity_id, operation)` called from command layer inside existing write transactions — **not** DB triggers (explicit, testable, matches repo conventions).

### D3 — Sync worker lives in Rust (Tauri)

**Decision:** Replace in-memory `SyncEngine` with:

```
src-tauri/src/sync/
  mod.rs       — SyncEngine, Tauri commands, coarse events to frontend
  outbox.rs    — mark_dirty, drain batch, ack/fail
  transport.rs — HTTP client to api.useplethora.com (reuse auth token from plethora_auth)
  puller.rs    — paginated pull, streaming apply
  merge.rs     — pure per-entity merge functions
  scheduler.rs — debounced triggers, backoff, connectivity
  crypto.rs    — extend existing AES-GCM + key hierarchy (phase 4)
```

Frontend `syncStore` subscribes to `plethora-sync-status-changed`; **does not** implement protocol.

**Rationale:** PRD §46; keeps network off JS thread; SQLite access already in Rust.

### D4 — Merge semantics (PRD §16–20)

| Entity | Strategy | Phase |
|--------|----------|-------|
| `review_results` | Append-only; dedupe by deterministic id `(device_id, reviewed_at_ms, item_id)` | MVP |
| `learning_items` | Field-LWW by server sequence; scheduler replays review union | MVP |
| `documents`, `extracts` | Field-LWW; positions cheap-merge | Phase 2b |
| `tags`, memberships | Additive records + tombstone-wins | Phase 2b |
| `settings` | Per-key LWW; denylist device-local keys | Phase 2b |
| Deletes | Tombstone records with `deleted_at` + revision | Phase 2b |

Conflicts on same field → last accepted write wins + `sync_issues` row (PRD §19.3 initial policy).

### D5 — Server extensions (Postgres)

**Decision:** Extend existing tables; add:

- `entity_revisions (user_id, entity_type, entity_id, revision, updated_at)`
- `processed_changes (user_id, change_id)` for idempotency by change_id
- Write `sync_device_cursors` on successful push/pull (currently unused)
- `POST /v1/blobs/check`, `/upload-url`, `GET /v1/blobs/:hash/download-url` (phase 5)
- Middleware: require `cloud_sync` entitlement on all `/v1/sync/*` and blob routes (phase 6)

**Tombstone GC:** 90-day retention below min device cursor (from prior delta-log design).

### D6 — Encryption (phase 4, design now)

**Decision:** Account `RecoveryKey` (high-entropy, user-displayed once) → HKDF → `SyncMasterKey` (epoch-scoped on device revoke) → per-record AES-256-GCM with AAD `(account_id, entity_type, entity_id, change_id, epoch)`.

Pairing: existing device wraps master key to new device public key (X25519); QR or 6-digit code exchange.

Store master key in platform keychain via `AuthStore` pattern — **not** `localStorage` (current `syncStore` bug).

Until phase 4 ships internal beta: MVP may use **transport-only TLS** with server-side ciphertext columns populated but keys managed in phase 4 — **GA blocked** until E2EE complete (PRD §58 phase 4 before GA).

### D7 — Progressive lanes (not startup gates)

**Decision:** Priority classes for scheduler — `fast` (settings, positions, reviews) → `core` (items, extracts) → `bulk` (files). Lanes affect **batch ordering**, not whether app boots.

**Rationale:** Lessons from `introduce-progressive-sync-lanes` and Yjs boot disaster — never block first paint.

### D8 — Retire legacy paths

| Asset | Action |
|-------|--------|
| `src-tauri/src/cloud_sync.rs` | Stop routing v2 sync here; deprecate commands or redirect to new engine |
| `server/src/routes/sync.ts` | Remove from mount after v1 parity; keep until migration complete |
| Fake `syncStore.syncNow()` | Replace with invoke Rust worker + honest error states |
| Stale help/Yjs docs | Update in phase 7 |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Reintroducing memory spikes | Bounded outbox, paged pull, streaming apply, memory-bench gate (`scripts/memory-bench/`) |
| SQLite write contention from outbox INSERT | WAL mode (already), short transactions, benchmark on low-end Android |
| `mark_dirty` missed on a code path | Entity registry checklist in tasks; integration test per entity family |
| Protocol drift vs deployed server | `sync_protocol_version`; integration tests against production schema |
| False confidence from old OpenSpec tasks | This change's `tasks.md` starts unchecked; archive old change when done |
| E2EE delay vs MVP | Internal desktop beta may use TLS-only; public GA requires phase 4 |
| Revision conflicts overwhelm users | Start with LWW + conflict metadata; UI sheet only for non-trivial cases |
| Blob storage cost | 5–10 GB Pro quota (PRD §42); server-side enforcement |

## Migration Plan

1. **Phase 1** — Ship SQLite migration 106+; add `mark_dirty` to review + learning_item commands; no cloud required.
2. **Phase 2** — Enable worker push/pull against staging then production; feature flag `PLETHORA_SYNC_V2=1`.
3. **Phase 4** — Enable encryption; require re-bootstrap or key migration for beta testers.
4. **Phase 6** — Enforce Pro gate server-side; free users keep local-only (unchanged).
5. **Rollback** — Feature flag disables worker; local SQLite unaffected; outbox preserved for retry (PRD §59).

## Open Questions

1. **MVP entity set:** Confirm starting with `learning_items` + `review_results` only, or include `documents.position_json` in phase 2?
2. **Auth provider:** PRD lists Supabase/Clerk; current stack uses custom JWT — stay with current auth for sync?
3. **WebSocket notifications:** Defer to post-MVP or include lightweight `changes_available` in phase 3?
4. **Internal beta TLS-only window:** Acceptable duration before E2EE mandatory?
5. **Archive prior OpenSpec change:** Mark `implement-plethora-pro-end-to-end-encrypted-cloud-sync` superseded when phase 2 lands?
