# Tasks: remove-realtime-sync

## 1. Pre-removal verification

- [x] 1.1 Grep the tree for consumers of `getYjsSync` / `getSyncRoomId` / imports from `lib/sync` / `lib/yjsSync` / `components/sync` outside the deletion set; confirm every hit is inside the sync cluster or the known surgery list (design D2 risk gate)
- [x] 1.2 Grep `src-tauri/` for each of the 13 `sync_*` table names; confirm only `commands/sync.rs`, `commands/sync_journal.rs`, and `database/migrations.rs` reference them
- [x] 1.3 Audit `settings.sync` keys (`enabled`, `provider`, `interval`, `onStartup`, `autoDownloadMode`) against `CloudStorageSettings.tsx` and `cloud_sync.rs` consumers; record which keys are cloud-owned and must survive — **finding: no cloud consumer reads `settings.sync`; the whole subtree is removable**

## 2. Rust backend

- [x] 2.1 Delete `src-tauri/src/commands/sync.rs`, `commands/sync_journal.rs`, `commands/yjs_file.rs` and their ~35 `invoke_handler` registrations plus `save_synced_file` / `yjs_file_*` entries in `lib.rs` — **note: `get_learning_item_ids_modified_since` + `get_learning_items_for_postpone` (+`PostponeLearningItem`) were domain-serving and moved to `commands/learning_item.rs`; `count_review_results` had zero callers and was deleted**
- [x] 2.2 Add a migration that `DROP TABLE IF EXISTS` all 13 `sync_*` tables; keep domain tables untouched (migration `087_drop_sync_tables`)
- [x] 2.3 Remove any now-dead helper code the sync commands exclusively used (repositories, models, error variants); `cargo check` + `cargo clippy` clean — **removed `upsert_synced_document`/`upsert_synced_extract`/`upsert_synced_collection` repo methods, the `upsert_synced_document` command, `save_synced_file`, `update_document_file_path`, and the sync-specific repo test; `cargo check` clean**
- [x] 2.4 Remove the `wss://sync.readsync.org` / `https://sync.readsync.org` CSP entries from `src-tauri/tauri.conf.json` and any other config referencing the relay — **`https://readsync.org` (Express API) retained**

## 3. Frontend core deletion

- [x] 3.1 Delete `src/lib/sync/` (65 files) and the standalone sync lib modules: `yjsSync.ts`, `documentReplication.ts`, `startSyncSubsystems.ts`, `fileSyncRegistration.ts`, `sync-client.ts` sync endpoints (after D1 slimming), `useFileSync.ts`, `useFileSyncManifest.ts`, `useDocumentFileSync.ts`, `autoFileSyncDownload.ts`, `file-transfer.ts`, `file-manifest.ts`, `yjs-file-service.ts`, `localStorageSync.ts`, `epub-position sync helpers if sync-only`
- [x] 3.2 Slim `src/lib/sync-client.ts` to auth-only (login/register/getUser/logout/isAuthenticated) per design D1; remove its `export * from './sync-client.js'` re-export in `offline-queue.ts` if it re-exports sync functions
- [x] 3.3 Move the progressive scheduler and tab-switch/startup-phase measurement helpers to a neutral module (e.g. `src/lib/perf/`) verbatim per design D2; repoint `tabsStore` and keep `measureTabSwitch` behavior identical — **DEVIATION from D2: after telemetry removal the scheduler had zero production consumers (tabsStore only used it for the telemetry queued-count), so it was deleted outright along with `syncTelemetry`; tabsStore drops the measureTabSwitch wrapper**
- [x] 3.4 Delete `src/components/sync/` and the sync UI surfaces: `SyncSettings.tsx`, `SyncQrScanner.tsx`, the `SettingsTab.Sync` entry in desktop `SettingsPage.tsx`, the mobile `SettingsPage.tsx` sync entry, the dashboard "deviceSync" card in `DashboardTab.tsx`
- [x] 3.5 Remove sync UI usage from viewers and library: `ReaderFileDownload` mounts in `DocumentViewer.tsx` / `EPUBViewer.tsx` / `PDFViewer.tsx`, `DocumentFileSyncBadge` in `DocumentsView.tsx`, `clearInvalidSyncedFilePath` call in `DocumentViewer.tsx`
- [x] 3.6 Remove i18n keys for the removed sync UI across all six locales (`de`, `en`, `es`, `fr`, `ja`, `zh`)

## 4. Frontend write-path and store surgery

- [x] 4.1 Remove the ~55 dynamic publish hooks from domain write paths: `api/review.ts`, `api/queue.ts`, `api/learning-items.ts`, `api/extracts.ts`, `api/collections.ts`, `api/rss.ts`, `api/podcast.ts`, `api/documents.ts`, `commands/undoableCommands.ts`, `utils/ankiImport.ts`, `components/assistant/AssistantPanel.tsx`, `components/settings/ImportExportSettings.tsx` (incl. `triggerReSeed`)
- [x] 4.2 Remove `enqueueSyncOperation` / `nowHLC` calls from `api/position.ts`, `api/media-library.ts`, `api/rss-annotations.ts`, `api/rss.ts`; keep the domain writes
- [x] 4.3 Remove sync types from exported signatures in `api/podcast.ts` (`SyncedPodcastEpisode` at the two type-only import sites)
- [x] 4.4 Unwind `main.tsx`: drop `markSyncPhaseStart`, the deferred `startSyncSubsystems()` call, `initLocalStorageSyncLazy`, and the Yjs decode-failure → `incrementum:sync-corruption` dispatch; remove the matching listener in `MainLayout.tsx`
- [x] 4.5 Drop `markSyncPhaseStart` telemetry calls from `documentStore.ts`, `startupStore.ts`, `api/startup.ts`; delete the sync telemetry ring buffer module
- [x] 4.6 Strip `sync.yjs` and `sync.autoDownloadMode` from `settingsStore.ts` defaults and add a settings migration that removes them (and a stale persisted `yjs.enabled: true`) from existing installs
- [x] 4.7 Add one-time residue cleanup on boot: delete the sync-scoped IndexedDB databases and the `incrementum_sync_room`, `incrementum-yjs-corruption-detected`, `incrementum.sync.feature-flags` localStorage keys, guarded by an already-ran flag
- [x] 4.8 `npm run build` (tsc) clean; fix any import the deletion broke that the sweep missed

## 5. Repo cleanup

- [x] 5.1 Delete the `yjs-sync/` directory (relay server, file-service, Caddy, deploy scripts); confirm nothing in CI or docs references it
- [x] 5.2 Search docs/README for sync instructions (room join, QR, self-hosting) and remove or update them
- [x] 5.3 Decide and record the fate of the orphaned "Target-Gated GPU Acceleration" requirement (re-home or drop) — see design Open Questions

## 6. Tests and gates

- [x] 6.1 Delete the ~26 dedicated sync test files (`src/lib/__tests__/sync.*`, `syncJournal*`, `deltaLog.*`, `yjsSync.*`, `replicatedMap.*`, `progressiveScheduler` if replaced, `startSyncSubsystems`, `localStorageSync.deltaLog`, `documentReplication`, `fileSyncRegistration`, `autoFileSyncDownload`, `fileManifest`, `fileTransfer.*`, `largeRoomResponsiveness`, `SyncSettings.join`, `SyncQrScanner`, `components/sync/__tests__/DeltaLogMigrationPanel`)
- [x] 6.2 De-mock sync paths in the domain tests that stub them — **all 373 remaining suites pass; only tabsStore.test needed edits (scheduler/telemetry mocks + the sync-backlog stress test)** (`stores/__tests__/{documentStore,reviewStore,tabsStore}`, `api/__tests__/{positionProgress,learning-items,extracts.extractCount}`, `src/__tests__/noNativeDialogs`, `pages/__tests__/QueueScrollPage.rebuild`); assertions must not depend on publish side-effects
- [x] 6.3 Add/keep a regression test asserting boot performs no sync module loads and no sync network/IndexedDB access (guards the `local-data-plane` spec) — **added `src/__tests__/noRealtimeSync.test.ts`**
- [x] 6.4 Run the full suite (`npm run test`), `npm run bench:check`, and the bundle budget check; re-record `scripts/perf-baselines.json` and `scripts/bundle-budgets.json` in this change citing the removal (AGENTS.md protocol) — **3151 FE tests + 696 Rust tests pass; perf gate OK after removing the deleted file-manifest baseline entry and re-recording 4 stale entries (2 tabs-dom entries are genuine speedups from dropping the telemetry wrapper); bundle budget OK unchanged; also uninstalled yjs/y-websocket/y-indexeddb/lib0/hash-wasm/ws**
- [ ] 6.5 Manual smoke: fresh-install cold start, login/profile, flashcard review, document open (EPUB + PDF), cloud backup "Sync now", browser-extension push — all behave as before with no sync UI present
