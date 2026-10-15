# Implementation Tasks

> Phased per `docs/sync.prd` §58. Do not mark Phase 2+ complete until Phase 1 gates pass. All boxes start unchecked — unlike the superseded `implement-plethora-pro-end-to-end-encrypted-cloud-sync` change.

## 0. Planning hygiene

- [x] 0.1 Add cross-reference in `implement-plethora-pro-end-to-end-encrypted-cloud-sync/proposal.md` noting supersession by this change
- [x] 0.2 Audit and queue updates for stale Yjs sync docs (`docs/product/features/settings/encrypted-sync.md`, help index entries)
- [x] 0.3 Confirm next SQLite migration number at implementation time (expected 106+; re-anchor per repo rule)

## 1. Phase 1 — Local journal (no cloud dependency)

- [x] 1.1 Add SQLite migration: `sync_outbox`, `sync_cursor`, `sync_clock`, `sync_meta` (PRD §10)
- [x] 1.2 Define syncable entity registry (`EntityType` enum + whitelist + per-entity merge strategy pointer)
- [x] 1.3 Implement `mark_dirty(conn, entity_type, entity_id, operation, base_revision, payload)` in `src-tauri/src/sync/outbox.rs`
- [x] 1.4 Wire `mark_dirty` into review command path (`append_event` for `review_results`)
- [x] 1.5 Wire `mark_dirty` into learning item create/update/delete commands
- [x] 1.6 Persist device id in `sync_cursor` on first sync init (reuse domain `device_id` from migration 053)
- [x] 1.7 Implement HLC increment in `sync_clock.rs` on each outbox insert
- [x] 1.8 Unit tests: atomic outbox insert with domain write; rollback leaves no outbox row
- [x] 1.9 Unit tests: review append-only journaling; deterministic event id in payload
- [x] 1.10 Unit tests: outbox bounded status transitions (`pending` → `acknowledged`)

## 2. Phase 2 — Minimal sync backend (desktop ↔ desktop MVP)

- [x] 2.1 Replace in-memory `SyncEngine` in `src-tauri/src/sync/mod.rs` with SQLite-backed engine
- [x] 2.2 Implement `transport.rs`: authenticated HTTP to `POST /v1/sync/push`, `GET /v1/sync/pull` (reuse `plethora_auth` token)
- [x] 2.3 Map outbox rows to wire `SyncRecord` (+ PRD `change_id`, `base_revision`, `operation` in envelope)
- [x] 2.4 Implement push drain: batch up to 500 records / 5 MB; mark `uploading` → `acknowledged` on success
- [x] 2.5 Implement puller: paginate by `last_server_cursor`; streaming apply per page
- [x] 2.6 Implement `merge.rs` for MVP entities: `review_results` (append union), `learning_items` (field-LWW)
- [x] 2.7 Apply pulled records in SQLite transactions; advance `sync_cursor` only after successful apply
- [x] 2.8 Server: add `processed_changes(user_id, change_id)` idempotency table
- [x] 2.9 Server: add `entity_revisions` + conflict response shape (base/local/remote) for revision mismatch
- [x] 2.10 Server: write `sync_device_cursors` on push/pull success
- [x] 2.11 Server: add `sync_protocol_version` request header validation (default `1`)
- [x] 2.12 Server integration tests: push idempotency, pull pagination, cursor monotonicity
- [x] 2.13 Two-device test harness: A reviews offline → B reviews offline → both sync → converge
- [x] 2.14 Two-device test: same-field conflict returns conflict metadata; LWW resolution applied
- [x] 2.15 Two-device test: delete tombstone on A propagates to B after reconnect
- [x] 2.16 Feature flag `PLETHORA_SYNC_V2` gates worker startup (default off until harness green)

## 3. Phase 2b — Expand entity coverage

- [x] 3.1 Add `mark_dirty` for documents (metadata + `position_json`)
- [x] 3.2 Add `mark_dirty` for extracts, highlights, annotations
- [x] 3.3 Add `mark_dirty` for collections, categories, tags, taggings (set-like records)
- [x] 3.4 Add `mark_dirty` for whitelisted settings keys (denylist device-local keys)
- [x] 3.5 Extend merge.rs for documents, extracts, tags, settings, tombstones
- [x] 3.6 Implement `sync_issues` table + non-trivial conflict surfacing (keep mine / theirs / both)
- [x] 3.7 Initial sync bootstrap: resumable upload scan of local syncable rows + progress events
- [x] 3.8 Initial sync bootstrap: new device download apply path with resumable cursor
- [x] 3.9 Server: 90-day tombstone GC by min device cursor
- [x] 3.10 Retire mount of legacy `server/src/routes/sync.ts` once v1 parity verified

## 4. Phase 3 — Scheduler, retry, mobile lifecycle

- [x] 4.1 Implement `scheduler.rs`: debounced post-mutation trigger (PRD §14)
- [x] 4.2 Triggers: app foreground, connectivity restored, periodic interval, manual sync invoke
- [x] 4.3 Exponential backoff with jitter on failures; reset on network restore (PRD §36)
- [x] 4.4 Emit `plethora-sync-status-changed` coarse events to frontend (no per-record React churn)
- [x] 4.5 Replace fake `syncStore.syncNow()` with Rust invoke + honest status from worker
- [x] 4.6 Update `SyncSettingsPanel`: pending count, last sync, error state, offline state (PRD §34)
- [x] 4.7 Mobile: integrate foreground/background hooks (Tauri mobile lifecycle)
- [x] 4.8 Mobile: battery/network gates for bulk lane (reuse `battery.rs` patterns)
- [x] 4.9 Optional: WebSocket `changes_available` notification → trigger pull (non-required for correctness)

## 5. Phase 4 — End-to-end encryption

- [x] 5.1 Extend `crypto.rs`: RecoveryKey generation (user-display format), HKDF master key, epoch counter
- [x] 5.2 Encrypt outbox payload at push boundary; decrypt at pull apply boundary
- [x] 5.3 Store master key in platform secure storage (AuthStore namespace) — remove localStorage key storage
- [x] 5.4 Pairing flow: QR + 6-digit code; X25519 wrap/unwrap of master key to device public key
- [x] 5.5 Device revocation → epoch increment; reject pulls/pushes from old epoch
- [x] 5.6 Recovery key UX: one-time display, acknowledgment, restore flow
- [x] 5.7 Crypto tests: AAD tamper, epoch rotation, pairing negative cases, recovery restore
- [x] 5.8 Server zero-knowledge tests: no plaintext in `sync_records`, logs, or R2 payloads

## 6. Phase 5 — File / blob sync

- [x] 6.1 Client: SHA-256 hash + `sha256:` reference in document/media metadata records
- [x] 6.2 Server: `POST /v1/blobs/check`, `POST /v1/blobs/upload-url`, `GET /v1/blobs/:hash/download-url`
- [x] 6.3 Client: presigned direct upload to R2; skip if hash exists
- [x] 6.4 Client: lazy download with integrity verify + optional decrypt
- [x] 6.5 Connect `file_manifest_entries` (069) to blob pipeline where applicable
- [x] 6.6 Server: storage quota accounting (5–10 GB default) + enforcement on upload
- [x] 6.7 Settings: storage usage display; Wi‑Fi-only / on-demand download prefs (mobile defaults)
- [x] 6.8 Tests: duplicate hash skipped; corrupt download rejected; quota exceeded surfaced

## 7. Phase 6 — Pro gating and production hardening

- [x] 7.1 Server middleware: require `cloud_sync` entitlement on `/v1/sync/*` and blob routes
- [x] 7.2 Client: gate sync worker start on Pro entitlement + signed offline grace cache
- [x] 7.3 SyncSettings: show upgrade prompt for free users; hide enable toggle without Pro
- [x] 7.4 Rate limits: sync requests/min, batch size, payload size (measure, don't guess)
- [x] 7.5 Device limit enforcement (if product requires)
- [x] 7.6 Pin production deploy docs: env, CORS, feature flag rollout on VPS

## 8. Phase 7 — Beta gates (PRD §51–52, §66)

- [x] 8.1 Chaos tests: mid-page pull abort, partial push, dropped responses, clock skew, process crash
- [x] 8.2 Memory-bench scenario: 50k outbox backlog PSS ceiling in `scripts/memory-bench/`
- [x] 8.3 Performance tests: 1k / 10k / 100k records incremental sync; update baselines if needed
- [x] 8.4 Update `noRealtimeSync.test.ts`: document v2 delta sync allowed; Yjs still forbidden
- [x] 8.5 Retire or redirect `src-tauri/src/cloud_sync.rs` v2 commands to new engine
- [x] 8.6 Update help/docs to describe delta sync (remove Yjs CRDT claims)
- [x] 8.7 Privacy-preserving sync telemetry: success rate, duration, conflict count (no plaintext)

## 9. Phase 8 — GA readiness checklist (PRD §66)

- [x] 9.1 Walk PRD §66 acceptance criteria; link each to a test or manual verification
- [x] 9.2 Enable `PLETHORA_SYNC_V2` by default for Pro users after all gates green
- [x] 9.3 Rollback verified: disable flag → local app unchanged, outbox preserved
- [x] 9.4 Archive or mark superseded: `implement-plethora-pro-end-to-end-encrypted-cloud-sync`
