# Tasks: remove-realtime-sync

## 1. Pre-removal verification

- [ ] 1.1 Grep the tree for consumers of `getYjsSync` / `getSyncRoomId` / imports from `lib/sync` / `lib/yjsSync` / `components/sync` outside the deletion set; confirm every hit is inside the sync cluster or the known surgery list (design D2 risk gate)
- [ ] 1.2 Grep `src-tauri/` for each of the 13 `sync_*` table names; confirm only `commands/sync.rs`, `commands/sync_journal.rs`, and `database/migrations.rs` reference them
- [ ] 1.3 Audit `settings.sync` keys (`enabled`, `provider`, `interval`, `onStartup`, `autoDownloadMode`) against `CloudStorageSettings.tsx` and `cloud_sync.rs` consumers; record which keys are cloud-owned and must survive

## 2. Rust backend

- [ ] 2.1 Delete `src-tauri/src/commands/sync.rs`, `commands/sync_journal.rs`, `commands/yjs_file.rs` and their ~35 `invoke_handler` registrations plus `save_synced_file` / `yjs_file_*` entries in `lib.rs`
- [ ] 2.2 Add a migration that `DROP TABLE IF EXISTS` all 13 `sync_*` tables; keep domain tables untouched
- [ ] 2.3 Remove any now-dead helper code the sync commands exclusively used (repositories, models, error variants); `cargo check` + `cargo clippy` clean
- [ ] 2.4 Remove the `wss://sync.readsync.org` / `https://sync.readsync.org` CSP entries from `src-tauri/tauri.conf.json` and any other config referencing the relay

## 3. Frontend core deletion

- [ ] 3.1 Delete `src/lib/sync/` (65 files) and the standalone sync lib modules: `yjsSync.ts`, `documentReplication.ts`, `startSyncSubsystems.ts`, `fileSyncRegistration.ts`, `sync-client.ts` sync endpoints (after D1 slimming), `useFileSync.ts`, `useFileSyncManifest.ts`, `useDocumentFileSync.ts`, `autoFileSyncDownload.ts`, `file-transfer.ts`, `file-manifest.ts`, `yjs-file-service.ts`, `localStorageSync.ts`, `epub-position sync helpers if sync-only`
- [ ] 3.2 Slim `src/lib/sync-client.ts` to auth-only (login/register/getUser/logout/isAuthenticated) per design D1; remove its `export * from './sync-client.js'` re-export in `offline-queue.ts` if it re-exports sync functions
- [ ] 3.3 Move the progressive scheduler and tab-switch/startup-phase measurement helpers to a neutral module (e.g. `src/lib/perf/`) verbatim per design D2; repoint `tabsStore` and keep `measureTabSwitch` behavior identical
- [ ] 3.4 Delete `src/components/sync/` and the sync UI surfaces: `SyncSettings.tsx`, `SyncQrScanner.tsx`, the `SettingsTab.Sync` entry in desktop `SettingsPage.tsx`, the mobile `SettingsPage.tsx` sync entry, the dashboard "deviceSync" card in `DashboardTab.tsx`
- [ ] 3.5 Remove sync UI usage from viewers and library: `ReaderFileDownload` mounts in `DocumentViewer.tsx` / `EPUBViewer.tsx` / `PDFViewer.tsx`, `DocumentFileSyncBadge` in `DocumentsView.tsx`, `clearInvalidSyncedFilePath` call in `DocumentViewer.tsx`
- [ ] 3.6 Remove i18n keys for the removed sync UI across all six locales (`de`, `en`, `es`, `fr`, `ja`, `zh`)

## 4. Frontend write-path and store surgery

- [ ] 4.1 Remove the ~55 dynamic publish hooks from domain write paths: `api/review.ts`, `api/queue.ts`, `api/learning-items.ts`, `api/extracts.ts`, `api/collections.ts`, `api/rss.ts`, `api/podcast.ts`, `api/documents.ts`, `commands/undoableCommands.ts`, `utils/ankiImport.ts`, `components/assistant/AssistantPanel.tsx`, `components/settings/ImportExportSettings.tsx` (incl. `triggerReSeed`)
- [ ] 4.2 Remove `enqueueSyncOperation` / `nowHLC` calls from `api/position.ts`, `api/media-library.ts`, `api/rss-annotations.ts`, `api/rss.ts`; keep the domain writes
- [ ] 4.3 Remove sync types from exported signatures in `api/podcast.ts` (`SyncedPodcastEpisode` at the two type-only import sites)
- [ ] 4.4 Unwind `main.tsx`: drop `markSyncPhaseStart`, the deferred `startSyncSubsystems()` call, `initLocalStorageSyncLazy`, and the Yjs decode-failure → `incrementum:sync-corruption` dispatch; remove the matching listener in `MainLayout.tsx`
- [ ] 4.5 Drop `markSyncPhaseStart` telemetry calls from `documentStore.ts`, `startupStore.ts`, `api/startup.ts`; delete the sync telemetry ring buffer module
- [ ] 4.6 Strip `sync.yjs` and `sync.autoDownloadMode` from `settingsStore.ts` defaults and add a settings migration that removes them (and a stale persisted `yjs.enabled: true`) from existing installs
- [ ] 4.7 Add one-time residue cleanup on boot: delete the sync-scoped IndexedDB databases and the `incrementum_sync_room`, `incrementum-yjs-corruption-detected`, `incrementum.sync.feature-flags` localStorage keys, guarded by an already-ran flag
- [ ] 4.8 `npm run build` (tsc) clean; fix any import the deletion broke that the sweep missed

## 5. Repo cleanup

- [ ] 5.1 Delete the `yjs-sync/` directory (relay server, file-service, Caddy, deploy scripts); confirm nothing in CI or docs references it
- [ ] 5.2 Search docs/README for sync instructions (room join, QR, self-hosting) and remove or update them
- [ ] 5.3 Decide and record the fate of the orphaned "Target-Gated GPU Acceleration" requirement (re-home or drop) — see design Open Questions

## 6. Tests and gates

- [ ] 6.1 Delete the ~26 dedicated sync test files (`src/lib/__tests__/sync.*`, `syncJournal*`, `deltaLog.*`, `yjsSync.*`, `replicatedMap.*`, `progressiveScheduler` if replaced, `startSyncSubsystems`, `localStorageSync.deltaLog`, `documentReplication`, `fileSyncRegistration`, `autoFileSyncDownload`, `fileManifest`, `fileTransfer.*`, `largeRoomResponsiveness`, `SyncSettings.join`, `SyncQrScanner`, `components/sync/__tests__/DeltaLogMigrationPanel`)
- [ ] 6.2 De-mock sync paths in the domain tests that stub them (`stores/__tests__/{documentStore,reviewStore,tabsStore}`, `api/__tests__/{positionProgress,learning-items,extracts.extractCount}`, `src/__tests__/noNativeDialogs`, `pages/__tests__/QueueScrollPage.rebuild`); assertions must not depend on publish side-effects
- [ ] 6.3 Add/keep a regression test asserting boot performs no sync module loads and no sync network/IndexedDB access (guards the `local-data-plane` spec)
- [ ] 6.4 Run the full suite (`npm run test`), `npm run bench:check`, and the bundle budget check; re-record `scripts/perf-baselines.json` and `scripts/bundle-budgets.json` in this change citing the removal (AGENTS.md protocol)
- [ ] 6.5 Manual smoke: fresh-install cold start, login/profile, flashcard review, document open (EPUB + PDF), cloud backup "Sync now", browser-extension push — all behave as before with no sync UI present
