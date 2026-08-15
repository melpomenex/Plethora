# Design: remove-realtime-sync

## Context

The real-time sync subsystem is a Yjs CRDT replication layer over a
WebSocket relay (`wss://sync.readsync.org`, self-hostable stack in `yjs-sync/`).
It was opt-in, then force-enabled by a migration, then hard-disabled in
production (`b036c854`) after causing severe startup/runtime lag and multi-GB
cold-start RAM spikes. Today `isYjsSyncEnabled()` always returns false, but
`main.tsx` still boots the whole chain offline: local Yjs doc + y-indexeddb
persistence + nine entity replicators + compaction sweeps.

Architecture fact that makes removal tractable: **SQLite is authoritative;
sync is a side-channel.** Domain code writes via Tauri commands to SQLite
first, then fires best-effort `void`-wrapped *dynamic* imports to publish.
Inbound replication ran Yjs→`upsert_synced_*`→SQLite from inside
`src/lib/sync/entities/`. No domain store touches Yjs maps directly.

## Goals / Non-Goals

**Goals:**
- Delete the entire real-time sync subsystem (frontend, Rust commands, DB
  tables, server stack, CSP entries, tests) with zero behavior change for
  local-first usage — the feature is already dead in production.
- Recover the residual boot cost (offline Yjs doc, persistence, replicators).
- Keep user auth (login/profile), cloud backup, and browser-extension
  pairing fully functional.
- Leave every user's SQLite data untouched.

**Non-Goals:**
- Removing accounts/auth or the Express `server/` API (serves auth + the
  extension offline queue).
- Removing cloud backup (`cloud_sync.rs`, `cloud/`, OAuth providers).
- Removing `browser_sync_server.rs` (extension pairing, loopback-only).
- Decommissioning the hosted `sync.readsync.org` deployment (ops task outside
  this repo; the relay simply loses its client).
- Building any replacement cross-device mechanism (import/export and cloud
  backup remain the data-portability story).

## Decisions

### D1: Keep auth, delete transport (scope of `sync-client.ts`)

`sync-client.ts` is both the legacy REST sync client and the app's only auth
client (`getUser`/`login`/`register`/`logout`/`isAuthenticated`), consumed by
`LoginModal`, `UserProfilePanel`, and `reviewStore`.

**Decision**: slim it to an auth-only client in place (delete push/pull/sync
endpoints, keep auth functions byte-identical), keep the path `lib/sync-client.ts`
to avoid churning importers. Rename later if desired.

**Alternative rejected**: removing accounts entirely — the Express server and
extension offline queue depend on user identity; deleting auth cascades into a
surviving feature. **Alternative rejected**: extracting a new `lib/auth.ts` —
pure churn with no behavioral benefit at removal time.

### D2: Re-home generic perf utilities, delete sync-branded ones

`tabsStore` uses `getProgressiveSyncScheduler`/`measureTabSwitch` from
`src/lib/sync/progressiveScheduler` as its *generic* tab-switch perf
scheduler. Startup-phase measurement (`markSyncPhaseStart`) is called from
`documentStore`, `startupStore`, `api/startup.ts`, `main.tsx`.

**Decision**: move the scheduler module (and the tab-switch/startup-phase
measurement helpers it needs) to a neutral home (`src/lib/perf/`), preserving
behavior exactly; delete the sync-specific telemetry ring buffer and drop the
`markSyncPhaseStart` call sites along with it. Move, don't rewrite — the
benchmark gate must stay green.

### D3: SQLite data needs no migration; sync bookkeeping tables are dropped

All 13 `sync_*` tables are replication bookkeeping (outbox, inbox,
checkpoints, cutover state, tombstones), not user data. User data lives in
domain tables written by domain commands.

**Decision**: one new migration `DROP TABLE IF EXISTS` for all 13, executed
after the Rust commands referencing them are removed in the same change.
Before writing it, grep the Rust tree for each table name to prove zero
remaining readers. `sync_device_id` goes too — nothing else consumes a
sync-scoped device identity.

### D4: One-time client-side residue cleanup

Long-lived installs carry: y-indexeddb databases (potentially large), the
`incrementum_sync_room` / `incrementum-yjs-corruption-detected` /
`incrementum.sync.feature-flags` localStorage keys, the
`incrementum:sync-corruption` custom-event listener in `MainLayout`, and
possibly a persisted `sync.yjs.enabled: true` in the settings blob.

**Decision**: delete the IndexedDB databases and localStorage keys once on
boot (guarded by a "cleanup already ran" flag), strip the `sync.yjs` and
`sync.autoDownloadMode` subtrees via a settings migration, and remove the
corruption-event plumbing. IndexedDB deletion reclaims real disk space on
installs that ran the now-disabled sync.

### D5: Settings store surgery — Yjs keys only

`settings.sync` mixes two features: `provider`/`interval`/`onStartup`/
`enabled` configure **cloud backup** (kept — audited against
`CloudStorageSettings.tsx` usage); `yjs.*` and `autoDownloadMode` configure
**real-time sync** (deleted).

**Decision**: remove only the Yjs-related subtrees; audit the remaining keys
against actual cloud-settings consumers and drop any that are dead.

### D6: Single-change removal, no feature flag

The feature is already hard-disabled in production; there is no live behavior
to phase out and no user-visible regression surface. A flag would only delay
deleting code that cannot run.

**Decision**: one change removes frontend + Rust + migration + CSP + server
stack together. Rollback is `git revert` of the release commit.

### D7: Repo hygiene boundaries

`yjs-sync/` (relay + file-service + Caddy + deploy scripts) is deleted — its
only client is the removed feature. `server/` (Express API) is kept. Dead
cloud-owned code (`SyncConflictDialog.tsx`, `common/SyncStatusIndicator.tsx`
— both currently have zero importers) is cloud backup's business, not this
change's; noted for a separate cleanup unless trivially adjacent.

## Risks / Trade-offs

- [Yjs/IndexedDB layer might be load-bearing somewhere the sweep missed — a
  code comment calls it "the app's offline data layer"] → Before deleting,
  grep for `getYjsSync`/`getSyncRoomId`/`lib/sync` consumers outside the
  deletion set; require the full test suite green; the entanglement audit
  found reads only inside the sync cluster, but this must be re-verified at
  implementation time, not trusted.
- [Dropping tables breaks a forgotten Rust reader] → D3's grep gate; compile
  fails loudly if a command outlives its table.
- [Tab-switch or boot perf regresses from the re-homed scheduler] → move
  code verbatim; `npm run bench:check` gate; re-record
  `scripts/perf-baselines.json` in the same PR (intentional perf change per
  AGENTS.md).
- [Bundle budgets shift when sync chunks leave the graph] → update
  `scripts/bundle-budgets.json` alongside, citing the removal.
- [A user re-enables an old client build against the relay after
  decommissioning] → out of scope here; hosted relay decommissioning is an
  ops decision taken after this ships.
- [Domain tests mock sync modules that no longer exist] → de-mock the ~7
  affected test files; their assertions must not depend on publish
  side-effects (they were best-effort `void` blocks, so they don't).

## Migration Plan

1. Verify no hidden consumers (D3 grep, Yjs consumer audit).
2. Rust: remove the 3 command modules + registrations; add the table-drop
   migration.
3. Frontend: delete the sync core directories; slim `sync-client.ts`; re-home
   the scheduler; unwind the ~13 static-import files and ~55 dynamic publish
   hooks; remove sync UI surfaces and settings subtrees.
4. Residue cleanup (D4) + CSP trim + delete `yjs-sync/`.
5. Tests: delete dedicated suites, de-mock domain tests, run full suite +
   `bench:check` + bundle budget; re-record baselines.

Rollback: revert the release; the dropped tables are re-created empty by the
old schema on next boot (`CREATE TABLE IF NOT EXISTS` style migrations), and
user data was never touched.

## Open Questions

- Does the "Target-Gated GPU Acceleration" requirement in
  `openspec/specs/yjs-sync-performance/spec.md` still matter? It is unrelated
  to sync and will be orphaned when that spec's requirements are removed —
  re-home it into its own spec or let it die with the archive.
- Should the dead cloud-owned components (`SyncConflictDialog.tsx`,
  `common/SyncStatusIndicator.tsx`) be deleted in this change as adjacent
  dead code, or left for a cloud-backup-scoped cleanup?
