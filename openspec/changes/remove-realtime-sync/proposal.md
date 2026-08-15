# Proposal: remove-realtime-sync

## Why

Real-time cross-device (Yjs) sync is already hard-disabled in production
(`yjsSync.ts` `__forceDisabled = true`, commit `b036c854`) because it caused
severe startup and runtime lag — it can never connect today. Yet the full
subsystem still boots locally on every launch (Yjs doc, IndexedDB persistence,
nine entity replicators, outbox/cutover machinery), costing cold-start time and
memory, and ~18k lines of frontend code plus ~1.8k lines of Rust commands and
13 database tables remain under maintenance for a feature that cannot run.
Removing it converts a disabled liability into deleted code and a faster boot.

## What Changes

- **BREAKING** Remove the real-time sync subsystem entirely: `src/lib/sync/`
  (incl. `deltaLog/`, `entities/`), `yjsSync.ts`, `documentReplication.ts`,
  `startSyncSubsystems.ts`, `fileSyncRegistration.ts`, `useFileSync*.ts`,
  `autoFileSyncDownload.ts`, `file-transfer.ts`, `file-manifest.ts`,
  `yjs-file-service.ts`, `localStorageSync.ts`, and `src/components/sync/`.
- **BREAKING** Remove the Sync settings tab (desktop + mobile), the dashboard
  "deviceSync" card, `SyncQrScanner`, the delta-log migration panel, and all
  file-mirror UI (`ReaderFileDownload`, `DocumentFileSyncBadge`,
  file-sync status indicators). Cross-device file mirroring and reading-position
  sync cease to exist.
- Delete the ~55 best-effort publish hooks (`await import("./sync/entities/…")`)
  from domain write paths (`api/review.ts`, `api/queue.ts`,
  `api/learning-items.ts`, `api/extracts.ts`, `api/collections.ts`,
  `api/rss.ts`, `api/podcast.ts`, `api/documents.ts`, `undoableCommands.ts`,
  `ankiImport.ts`, `AssistantPanel.tsx`, `ImportExportSettings.tsx`).
- Remove sync journaling/clock calls (`enqueueSyncOperation`, `nowHLC`) from
  `api/position.ts`, `api/media-library.ts`, `api/rss-annotations.ts`,
  `api/rss.ts`; remove sync types leaked into `api/podcast.ts` exported
  signatures.
- Slim `sync-client.ts` to an auth-only API client (login/register/getUser/
  logout/isAuthenticated); delete its legacy REST push/pull sync endpoints.
  Login, profile, and the browser-extension offline queue keep working.
- Replace the sync-branded progressive scheduler used generically by
  `tabsStore` with a neutral module (moved/renamed, behavior preserved).
- Rust: delete `commands/sync.rs`, `commands/sync_journal.rs`,
  `commands/yjs_file.rs`, their ~35 `invoke_handler` registrations, and drop
  the 13 `sync_*` tables via a new migration.
- Remove the `wss://sync.readsync.org` / `https://sync.readsync.org` CSP
  entries from `tauri.conf.json` and delete the self-hostable `yjs-sync/`
  relay stack from the repo.
- Delete the ~26 dedicated sync test files and clean sync mocks out of the
  ~7 domain tests that stub them.
- Keep unchanged: cloud backup (`cloud_sync.rs`, `cloud/`, OAuth), the
  browser-extension pairing server (`browser_sync_server.rs`), the Express
  `server/` API (auth + extension offline queue), and the local name-colliding
  playback modules (`utils/epubSync.ts`, `TranscriptSync`, `activePaneSync`).

## Capabilities

### New Capabilities
- `local-data-plane`: The app operates with local SQLite as the sole data
  plane — no remote sync connections are ever made, boot performs no sync
  subsystem initialization, no sync UI surfaces exist, and the local database
  carries no sync bookkeeping tables, while auth and unaffected adjacent
  features (cloud backup, extension pairing) continue to work.

### Modified Capabilities
- `document-deletion-sync`: All requirements REMOVED — cross-device deletion
  propagation via Yjs tombstones no longer exists; deletion is a purely local
  operation.
- `yjs-sync-performance`: All requirements REMOVED — the Yjs sync subsystem
  these requirements bound no longer exists (batched replay, batched review
  projections, telemetry throttling requirements become moot; the
  target-gated GPU requirement, if still wanted, is unrelated to sync and
  should be re-homed before archive).

## Impact

- **Frontend**: ~16k lines deleted across `src/lib/sync/`, sync lib modules,
  `src/components/sync/`, `SyncSettings.tsx`, `SyncQrScanner.tsx`; surgery in
  ~13 files with static imports (`main.tsx`, `MainLayout.tsx`, `tabsStore`,
  `reviewStore`, `documentStore`, `startupStore`, `LoginModal`,
  `UserProfilePanel`, `api/*`, viewers, `DocumentsView`, `DashboardTab`,
  both `SettingsPage`s).
- **Rust**: `src-tauri/src/commands/{sync,sync_journal,yjs_file}.rs` deleted;
  `lib.rs` registrations removed; new migration drops `sync_config`,
  `sync_queue`, `sync_device_id`, `sync_tombstones`, `sync_outbox`,
  `sync_inbox`, `sync_applied_operations`, `sync_checkpoints`,
  `sync_dead_letters`, `sync_projection_hashes`, `sync_migration_state`,
  `sync_cutover_state`, `sync_cutover_domain_progress`.
- **Config**: `tauri.conf.json` CSP loses the sync relay origins; bundle size
  shrinks (sync subsystem + deps leave the chunk graph).
- **Server**: `yjs-sync/` directory deleted; hosted `sync.readsync.org` relay
  becomes unused by the app (decommissioning is out of scope for this repo).
- **Users**: anyone who relied on cross-device mirroring loses it (already
  non-functional in production since `b036c854`); data authored locally in
  SQLite is untouched.
- **Tests**: ~26 dedicated sync test files deleted; ~7 domain test files
  de-mocked; `scripts/perf-baselines.json` may need re-recording if boot
  benchmarks shift (intentional perf change per AGENTS.md protocol).
