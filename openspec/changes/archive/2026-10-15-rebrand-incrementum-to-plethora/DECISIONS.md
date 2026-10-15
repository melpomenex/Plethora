# DECISIONS — rebrand-incrementum-to-plethora

Conservative defaults taken during implementation. Sections 1–2 (Phase A) were
executed on branch `plethora/rebrand`; sections 3–5 (Phase B — identifiers &
data migration, final notice release, validation) on branch
`plethora/rebrand-phase-b`. Every open question hit during implementation is
logged below with rationale. Product-owner sign-off items are marked
**[sign-off pending]**.

## 1.3 Decisions from the proposal's Open questions

### D1 — AMO gecko id: RETAINED (legacy)
`browser_specific_settings.gecko.id = "incrementum-browser-sync@melpomenex.dev"`
is kept verbatim. Changing it would orphan the existing AMO listing (the gecko id is
the immutable add-on identity). Only the display name changes → **"Plethora Capture"**.
Committed `.xpi` artifacts (`incrementum-browser-sync*.xpi`) are untouched — they are
signed release artifacts that embed the old brand; regenerating them requires AMO
signing and belongs to the extension release process (Phase B chain).

### D2 — Domain: `plethora.app` as provisional brand domain
`plethora.app` is used in outbound UA/Referer strings
(`Plethora/<version> (https://plethora.app)`, OpenRouter `HTTP-Referer: https://plethora.app`,
`X-Title: Plethora`) and as the brand URL in packaging metadata (`PKGBUILD url`).
Functional URLs are NOT switched in Phase A:
- `https://readsync.org` PWA references (CSP, server config) untouched — must keep working.
- `https://docs.incrementum.app` and `https://discord.gg/incrementum` links in the app's
  About panel keep pointing at the live sites until Plethora equivalents exist.
- `github.com/melpomenex/incrementum-tauri` links in README keep resolving; the repo
  move + updater/checker switch is Phase B (proposal item 12).
**[sign-off pending: final domains — see proposal Open question 3]**

### D3 — Android migration: fresh-install + `.incrementum` backup-import (record only)
Existing side-loaded `com.incrementum.app` installs are NOT auto-migrated. The new
`com.plethora.app` applicationId (Phase B) means a fresh install; users move data via
Export/Import (`.incrementum` backups stay importable forever). Recorded here and in
`BRANDING.md`; no Phase A action.

## Phase A scoping decisions (conservative defaults)

### D4 — Artifact names that derive from `productName` move in Phase A
Tauri names its bundles from `productName` (`Incrementum_2.7.0_am64.AppImage`,
`Plethora.app.tar.gz`, `Incrementum_2.7.0_x64-setup.exe`). Since task 2.1 renames
`productName` → "Plethora", every producer/consumer of those names had to move in the
same change or the release pipeline breaks:
- `.github/workflows/release.yml` — sign step, verify step, `create-update-manifest`
  platform map (`Plethora.app.tar.gz`, `Plethora_${v}_amd64.AppImage`,
  `Plethora_${v}_x64-setup.exe`).
- `scripts/ci-build-appimage.sh` — `Plethora.AppDir`, `Plethora.png`,
  `Plethora-x86_64.AppImage` (`EXPECTED_APPIMAGE` already reads `productName` from
  `tauri.conf.json`).
- `.github/workflows/build.yml` + `release.yml` arch-pkg steps — `pkgname=plethora`,
  desktop entry `Name=Plethora`, `Exec=plethora`, `Icon=plethora`,
  `StartupWMClass=Plethora`, install to `/usr/bin/plethora`,
  `plethora.desktop`, `plethora.png` hicolor icons.
The updater **endpoint** and **minisign pubkey** in `tauri.conf.json` are untouched
(Phase B). `scripts/verify-update-artifact.mjs` / `verify-release-updates.mjs` read
asset names from `latest.json`, so they needed no change (their doc comments still
show `Incrementum_*` examples — cosmetic only).

### D5 — Crate/binary-derived filenames stay until Phase B
`incrementum-tauri` binary (crate name) appears in build/release workflow commands,
`windows-test-build.yml` (`incrementum.exe`), `cross-build*.sh`, `PKGBUILD` build
source path, and `scripts/verify-macos-bundles.sh`. These are functional references to
the binary the toolchain actually produces; renaming the crate is Phase B task 3.10
(and `scripts/release.cjs` regex re-anchoring with it). Left as-is.

### D6 — Env vars and keychain/CI secrets stay until Phase B
`INCREMENTUM_TAURI` (ci-regression.yml, tauri-wrapper.sh, vite.config.ts),
`INCREMENTUM_*` OAuth client ids, mobile-build self-signed keystore credentials
(`incrementum-ci` alias/passwords, `CN=Incrementum CI` dname — ephemeral CI test
keystore, not user-facing), and keyring service constants are functional identifiers
renamed in Phase B tasks 3.4/3.10. Only workflow display names and upload-artifact /
release-asset names changed in Phase A.

### D7 — Extension scope: display strings only, protocol untouched
Renamed: manifest `name`/`default_title` → "Plethora Capture", manifest `description`,
command descriptions, `popup.html` `<h1>` + `options.html` `<title>`/`<h1>`/body copy,
and clearly user-visible strings in `popup.js`/`options.js`/`background.js`/`content.js`
(context-menu titles, notifications, toasts, AI panel labels, aria-labels).
NOT renamed (cross-boundary protocol, Phase B task 3.6): postMessage sources
`incrementum-extension`/`incrementum-pwa`, `data-incrementum-app` marker +
`document.title.includes('Incrementum')` detection, DOM ids (`incrementum-save-indicator`,
…), `incrementum-highlight` class, `incrementum_extracts_*` / `incrementum_settings`
storage keys, `incrementum://` notification-action scheme, JS identifiers
(`sendToIncrementum`, `IncrementumExtensionShared`, …) and `[Incrementum]` console
prefixes. `index.html` keeps `data-incrementum-app="true"` for the same reason.

### D8 — Service worker: strings only + content-version bump
User-visible strings renamed (offline-page title, push default title, header comments).
Cache name `incrementum-v7`, `incrementum-*` purge sweep, and IDB `incrementum-sw` are
retained (Phase B task 3.3 renames the namespace to `plethora-v1`). `VERSION` was bumped
`incrementum-v7` → `incrementum-v8` so deployed PWAs drop precached Incrementum icons
in favor of the regenerated Plethora ones (established content-rotation pattern; keeps
the legacy prefix sweep working). `index.html` icon/manifest `?v=` cache-busters bumped
to `2026-08-17`.

### D9 — Backup/export format identity untouched
`appStateExport.ts` writes `metadata.app: "Incrementum"` and
`appStateImport.ts:96` validates `metadata.app !== "Incrementum"`; the `.incrementum`
backup extension, `incrementum-collection-export` marker, and the Anki note-model name
`"Incrementum Basic"` (`ankiExport.ts`) are round-trip data identities. All stay until
Phase B task 3.5 adds `.plethora` + dual-format read. The save-dialog label
("Incrementum Backup") also stays so the dialog matches what import accepts.

### D10 — Integration defaults stay legacy (migration-sensitive)
Default Anki deck name `Incrementum` (`defaultSettings.ts`, `settingsValidation.ts`,
`IntegrationSettings.tsx` initial state + placeholders), Obsidian default folders
`Incrementum` / `Incrementum Assets` (`IntegrationSettings.tsx`, `IntegrationsPage.tsx`),
and Dropbox/GoogleDrive/OneDrive `/Incrementum/` folder names are stored-data
identities shared with external systems; renaming the default would orphan existing
users' decks/folders. Phase B must decide (rename-with-migration vs keep). Placeholders
were left matching the real defaults so they don't lie.

### D11 — Theme colors unchanged
`theme_color`/`background_color` (`#6daa2c` green) in `manifest.json`/`index.html` stay:
the app's UI palette is still green app-wide, and changing only the PWA status-bar
color would be inconsistent. A palette migration is a design decision outside this
change's "behavior-preserving" mandate. Follow-up recorded in BRANDING.md.

### D12 — Docs handbooks: full brand-name sweep (scope extended during execution)
Initially scoped to front matter only, but `src/components/settings/handbookContent.ts`
imports the six `docs/USER_HANDBOOK*.md` files via Vite `?raw` and renders them
in-app — the bodies ARE user-visible. All brand-name mentions were rebranded across
all six languages (Latin `Incrementum` → `Plethora`, fr `d'Incrementum` → `de
Plethora`, de `Inkrementum`, ja `インクリメンタム`, zh brand-only uses of `增量`
such as `添加到增量` — feature vocabulary like 增量阅读/增量备份 is untouched).
Deliberately retained in the handbooks: the `.incrementum` backup-extension
references (legacy format docs) and functional `github.com/melpomenex/incrementum-tauri`
links. Repo-only docs (INSTALL.md, PROJECT_SUMMARY.md, …) are not bundled and keep
their historical wording for the Phase B docs pass.

### D13 — Hardcoded user-visible strings in `src/` rebranded
Beyond i18n: `constants.ts APP_NAME`, `documentStore.ts` save-notification title,
`Breadcrumb.tsx` home label, `NotificationSettings.tsx` test notification + helper
copy, `pdfErrors.ts`/`pdfReflowOcr.ts` messages, `OCROnboarding.tsx` description,
`feedback/orchestrator.ts` default toast/notification titles, `rss.ts` OPML title,
`VoiceBrowser.tsx` sample phrase, `PwaAssistantButton.tsx` permission text (now
"Apps → Plethora"), `collectionArchive.ts` export deck label. `sponsorblock.ts` UA
default `"Incrementum/1.0"` → `"Plethora/1.0"` (outbound UA branding, spec
"Network-facing identifiers use Plethora").

### D14 — Icon pipeline driven by existing tooling
`scripts/generate-icons.mjs` previously rasterized `src-tauri/icons/sprout.svg` via
ImageMagick `magick`, which is not installed here and is not a repo dependency. Per the
"drive the existing tooling" rule, the script was rewritten to rasterize via the
already-pinned `@tauri-apps/cli` (`tauri icon -p <sizes>`), sourcing the masters from
`assets/brand/` (default + a derived 80%-scale maskable variant written to a temp dir).
No new devDependencies. Desktop/icns/ico/StoreLogo/iOS/Android targets are generated by
`tauri icon` with a temp manifest (`default` = master SVG, `android_fg` = foreground
SVG, `android_bg` = generated solid-white SVG). PWA/extension icon **filenames**
(`sprout-*.png`, `icon-*.png`, `badge-72x72.png`, `icon16..128.png`,
`apple-touch-icon.png`, `public/icon.png`, `icon.svg`) are kept — they are resource
URLs, not brand surfaces — only their content is regenerated. `src-tauri/icons/sprout.svg`
is replaced in place by the Plethora master (keeps `public/icons/icon.svg`/other legacy
references coherent).

### D15 — Android launcher strings rebranded, identifiers retained
`res/values/strings.xml` `app_name`/`main_activity_title` → "Plethora" (user-visible
launcher label; required by the brand-identity spec). `applicationId`/`namespace`
`com.incrementum.app`, theme `Theme.incrementum_tauri`, and Java packages stay (Phase B
tasks 3.1/3.9). Adaptive-icon background drawable switched from the legacy cream
gradient to solid white to match the Plethora master; mipmaps regenerated via
`tauri icon`.

### D16 — Non-goals confirmed
`CHANGELOG.md` history, git tags, `scripts/perf-baselines.json` provenance string,
`server/package.json`/`api/pyproject.toml` package names, docker-compose Postgres
credentials, `README` functional URLs, and code comments/Rust doc-comments keep their
legacy mentions (historical or Phase B internal renames). No license change.

## Execution notes (micro-checklist — files touched per task)

- 1.1 `BRANDING.md` (new)
- 1.3 `openspec/changes/rebrand-incrementum-to-plethora/DECISIONS.md` (this file)
- 1.2 / 2.6 `src/__tests__/brandInventory.test.ts` (new: brand-string scan + icon registry)
- 2.1 `src-tauri/tauri.conf.json`, `index.html`, `public/manifest.json`, `public/sw.js`
- 2.2 `src/lib/i18n/locales/{en,zh,es,de,fr,ja}.ts` + 7 `t()` call sites
  (`SettingsPage.tsx`, `IntegrationSettings.tsx`, `OCRSettings.tsx`,
  `NotebookLMWorkspace.tsx`, `ImportExportSettings.tsx`, `NotebookLMStudio.tsx`,
  `NotebookLMPage.tsx`) + hardcoded strings from D13
- 2.3 `README.md`, `docs/USER_HANDBOOK{,.zh,.ja,.es,.de,.fr}.md`, `PKGBUILD`,
  `docker-compose.yml` (no labels exist — credentials left per D16, noted),
  `.github/workflows/{build,release,mobile-build,testing-build,windows-test-build}.yml`,
  `scripts/ci-build-appimage.sh`
- 2.4 `assets/brand/*` (git add; zip verified byte-identical to loose files — sha256
  match on all five entries, recorded in BRANDING.md)
- 2.5 `scripts/generate-icons.mjs` (rewrite, D14), regenerated: `src-tauri/icons/*`
  (icns/ico/png/StoreLogo/Square*), `src-tauri/icons/ios/*`,
  `src-tauri/gen/android/app/src/main/res/mipmap-*/*` + `drawable/ic_launcher_background.xml`,
  `public/icons/*`, `public/apple-touch-icon.png`, `public/icon.png`,
  `public/icons/icon.svg`, `browser_extension/icons/*`
- 2.7 `src-tauri/src/commands/document.rs`, `src-tauri/src/browser_sync_server.rs`,
  `src-tauri/src/commands/podcast.rs`, `src-tauri/src/ai/providers.rs`,
  `src-tauri/src/ai/embeddings.rs`, `src-tauri/src/commands/llm.rs`,
  `api/youtube/transcript.py`, `src/lib/browser-backend.ts` (2 sites),
  `src/api/sponsorblock.ts`
- 2.8 `browser_extension/manifest.json`, `popup.html`, `options.html`, `popup.js`,
  `options.js`, plus display strings in `background.js`/`content.js` (D7)

## Late decisions during execution

### D17 — Android legacy launcher icons rendered at exact density buckets
The pinned `@tauri-apps/cli` 2.10.0 emits a 49x49 `ic_launcher.png` for hdpi
(its composite size table); the repo historically shipped the exact bucket
sizes (48/72/96/144/192). `generate-icons.mjs` therefore renders the legacy
(non-adaptive) launcher PNGs explicitly from the square master at exact bucket
sizes; adaptive foregrounds still come from the manifest run (108–432px, correct).

### D18 — Vestigial inputs removed
`src-tauri/icons/incrementum-android.png` / `incrementum-android-foreground.png`
(old-brand icon sources for the previous manual Android icon flow; referenced by
nothing after the pipeline rewrite) were deleted. Extension code comments
(`// … for Incrementum Browser Sync`, `[Incrementum]` log prefixes) and other
developer-facing comments keep legacy wording — internal-only, Phase B sweep.

### D19 — Test fixtures keep legacy URLs/paths
`src/lib/__tests__/shareTarget.test.ts` (`https://incrementum.app` as arbitrary
shared-URL fixture) and `src/utils/__tests__/imageAcquisition.test.ts`
(`/data/user/0/com.incrementum.app/...` Android path fixtures) are parser test
data, not brand surfaces — left untouched so the tests keep exercising the
exact production paths that exist today (com.incrementum.app until Phase B).

### D20 — Quirks noted
- `browser_extension/icons/` matches a gitignore advisory; the four tracked
  icon PNGs stage fine when addressed by file path.
- `icon.icns` bytes are nondeterministic across pipeline runs (embedded
  timestamps); regeneration commits should stage it once, not repeatedly.

---

# Phase B — sections 3–5 (branch `plethora/rebrand-phase-b`)

## Micro-checklist (files per task — written BEFORE coding)

- **3.1 Bundle identifier + desktop app-data migration**
  `src-tauri/tauri.conf.json` (identifier), `src-tauri/gen/android/app/build.gradle.kts`
  (applicationId/namespace), `src-tauri/gen/android/app/src/main/AndroidManifest.xml` +
  `res/values/themes.xml` if they reference the theme, `src-tauri/src/lib.rs`
  (new `legacy_data` module: detection, consent dialog, copy-tree migration, marker,
  window-state path logic, quarantine-detection compat, StartupNotice variant),
  `src/types/index.ts` + `src/components/layout/MainLayout.tsx` + 6 locales
  (migration notice strings), `src/__tests__/` Rust tests inside `lib.rs`.
- **3.2 DB filename**: `src-tauri/src/database/connection.rs` (filename constants +
  journal-protected adopt), `src-tauri/src/lib.rs` (db_path resolution +
  `restore_local_db_backup` path).
- **3.3 localStorage + SW**: new `src/lib/brandMigration.ts`, `src/main.tsx` (run first),
  `src/lib/syncResidueCleanup.ts` (settings key), key constants in
  `settingsStore.ts`, `tabsStore.ts`, `ThemeContext.tsx`, `feedback/orchestrator.ts`,
  `useRecallPrompts.ts`, `updateChecker.ts`, `ttsCache.ts`, `conversationalReview.ts`,
  `demoContent.ts`, `notificationService.ts`, `pushSubscription.ts`, `readingSpeed.ts`,
  `soundService.ts`, `wave4Social.ts`, `collectionArchive.ts`, `audiobooks.ts`,
  `podcast.ts`, `browser-backend.ts` (5 keys), `public/sw.js` (`plethora-v1` + purge),
  `browser_extension/background.js` (extension-storage one-shot migration).
- **3.4 Keychain**: `src-tauri/src/cloud/auth_store.rs`, `src-tauri/src/commands/ai_key_store.rs`
  (new service names, legacy read-through + migrate-on-read via injectable keyring IO),
  `src-tauri/src/lib.rs` (pass legacy dir), `src-tauri/src/utils/keychain.rs` (env rename).
- **3.5 Formats**: `src/utils/appStateExport.ts`, `src/utils/appStateImport.ts`,
  `src/components/settings/ImportExportSettings.tsx`,
  `src/components/settings/AppStateBackupDialog.tsx`, `src-tauri/src/integrations.rs`
  (plethora-id write + dual read + `migrate_obsidian_vault_ids` command),
  `src/components/settings/IntegrationSettings.tsx` (button) + 6 locales,
  `src-tauri/src/lib.rs` (register command).
- **3.6 Protocol**: `src/lib/extension-bridge.ts`, `src/components/common/RichContentRenderer.tsx`,
  `src/lib/webview-extract-bridge.ts` (internal ids), `index.html` (`data-plethora-app`),
  `src/utils/notificationService.ts` (scheme), `browser_extension/{content.js,background.js,shared.js,popup.js,options.js}`
  (dual-token send/listen, storage keys, DOM ids, class).
- **3.7 Plugin crates**: `git mv src-tauri/plugins/{folder-import→plethora-folder-import,
  android-tts→plethora-android-tts, android-genai→plethora-android-genai}`, their
  `Cargo.toml` (name/links/description), `permissions/**` (autogenerated refs),
  Kotlin package dirs `com/plethora/…` + package lines + `PLUGIN_IDENTIFIER` +
  `ios_plugin_binding!` names, root `src-tauri/Cargo.toml` (dep names/paths), root
  `src-tauri/Cargo.lock` (via cargo), plugin `Cargo.lock`s, `src-tauri/capabilities/default.json`,
  `src/api/documents.ts`, `src/utils/updateChecker.ts`, Kotlin plugin registration in
  `src-tauri/gen/android` (RustPlugin variants if referenced).
- **3.8 Updater**: `src-tauri/tauri.conf.json` (endpoint, pubkey),
  `src/utils/updateChecker.ts` (repo), `scripts/release.cjs` (crate regex),
  `scripts/release-downloads.sh` (defaults/docs), `scripts/verify-release-updates.mjs`,
  `scripts/verify-update-artifact.mjs` (repo expectations), new minisign keypair
  (private uncommitted, gitignore), `.github/workflows/release.yml` (secret names —
  keep `TAURI_SIGNING_*`, document new key upload).
- **3.9 Android keystore**: `src-tauri/gen/android/app/build.gradle.kts` (env/properties
  signing, no plaintext), delete `src-tauri/gen/android/app/release.keystore`,
  `keystore.properties.example` + `.gitignore`, `lib.rs` (backup watch paths),
  `FolderImportPlugin.kt` (backup writer path + legacy read), `themes.xml`/manifest
  (`Theme.plethora_tauri`), `.github/workflows/mobile-build.yml` (self-signed fallback
  credentials rename).
- **3.10 Internal renames** (dedicated commits): `IncrementumError`→`PlethoraError`
  (`src-tauri/src/**`, ~1,092 sites); crate `plethora-tauri`/`plethora_tauri_lib`
  (`Cargo.toml`, `main.rs`, `bin/pdf-reflow-diag.rs`, `Cargo.lock`, workflows,
  cross-build scripts, PKGBUILD, verify-macos-bundles.sh, release.cjs);
  `package.json`/`server/package.json` names; env `PLETHORA_*` + read-fallback helper
  (`vite.config.ts`, `scripts/tauri-wrapper.sh`, `.github/workflows/*`, Rust readers);
  log/temp strings (`plethora-startup.log`, `plethora-backups`, UA `plethora-updater`);
  MCP `mcp_get_app_tools`/`mcp_call_app_tool` + deprecated aliases (`commands/mcp.rs`,
  `api/mcp.ts`, call sites + test mocks); Dropbox `/Plethora/` + legacy fallback
  (`cloud/dropbox.rs`); TS `getAppMCPTools`/`callAppMCPTool` + aliases.
- **4.1 Notice release**: `docs/legacy/final-incrementum-notice.md` + handcrafted
  `.patch` verified with `git apply --check` against the last Incrementum tag.
- **5.1 Tests**: `src/lib/__tests__/brandMigration.test.ts`, Rust tests in
  `lib.rs`/`connection.rs`/`auth_store.rs`/`ai_key_store.rs`, extension
  `browser_extension/tests/brandProtocol.test.cjs`.
- **5.2 Gates**: `npm run test:run`, `cargo test --lib`, `npm run bench:check`,
  `npm run build:check`, `node --test browser_extension/tests/`.
- **5.3 Dry-run**: documented procedure in this file (macOS automated via tests;
  Windows/Linux manual-pending).
- **5.4 Release-channel verification**: fixture-based unit test for
  `verify-update-artifact.mjs`/`verify-release-updates.mjs` logic (no network).

## Phase B decisions

### D21 — DB rename is journal-protected at path-resolution time, not post-open
tasks.md 3.2 words the rename as "after successful open + migration check".
A live sqlx pool re-opens connections from the original connect-string, so
renaming files under an open pool risks a fresh empty DB being created at the
old path by the next lazily-opened connection. Instead the rename happens
before any open, guarded by a journal file (`.db-rename-journal`):
write journal → rename `-wal` → rename `-shm` → rename db → remove journal.
At boot, journal recovery completes (or no-ops) idempotently before the path
decision, so every crash point converges to "whole set under the new name"
with the WAL content preserved. The spec's observable behavior (old name
adopted, migrations verified, subsequent launches open new name directly) is
unchanged; only the internal ordering differs, for pool-safety.

### D22 — Desktop app-data migration copies the WHOLE legacy tree (superset)
The task enumerates db+wal/shm, settings, `ai_keys/`, `tokens/`, media/document
dirs, whisper models, custom themes. The app-data dir also holds `memories/`,
`ocr/`, `models/`, `imports/`, `artifacts/`, `runtime/`, `profiles`,
`nougat-runtime/`, `glm-runtime/`, `notebooklm-imports/`, `storage_state.json`,
`MEMORY.md`, source snapshots and the integrity-notice marker. Copying
everything (recursive, copy-never-move, skip nothing but `logs/` and
`temp_transcription/` which are disposable) is strictly safer than an allowlist
that can miss a store. The db file set is renamed to the new stem during the
copy (`incrementum.db*` → `plethora.db*`) so task 3.2's adopt finds the new
name directly. A completion marker (`.incrementum-migration.json`) records
source path, time, and copied-file count; the legacy directory is NEVER
deleted by app code.

### D23 — Consent dialog is native (tauri-plugin-dialog), pre-webview
The webview has not booted when the data dir is resolved in `setup()`, and the
DB must not be created before the migration decision. A blocking native dialog
(Ask: "Copy my data" / "Start fresh") runs in `setup()` on desktop only.
Declining proceeds with an empty library; the first run then creates files in
the new dir, so the "new dir absent/empty" predicate never re-triggers the
prompt. A successful migration surfaces `StartupNotice::LegacyDataMigrated`
so the frontend can tell the user where the preserved legacy folder lives.

### D24 — Desktop localStorage caveat (documented, not engineered)
Desktop release builds serve the frontend from `http://localhost:9527`, but
the WebView's on-disk website-data store is keyed by the app identity (bundle
id / WebView2 UDF). Changing the identifier therefore starts desktop users
with a fresh localStorage even after the app-data migration copies every
file. Migrating WKWebView/WebView2 private storage from Rust is out of scope
(fragile, platform-private formats). Impact is limited: settings/themes/tabs
fall back to defaults; the library, review history, API keys, and integrations
(all SQLite + files) are migrated. Recorded here and in BRANDING.md.

### D25 — Extension dual-token protocol: duplicate-send + requestId dedupe
App accepts requests sourced `plethora-extension` OR `incrementum-extension`,
deduping by `requestId` (each extension message carries one). The app emits
every response/announcement twice (sources `plethora-pwa` and
`incrementum-pwa`); the extension's response map deletes the handler on first
delivery, so the duplicate is a no-op. The extension sends each request twice
(old + new source, same requestId) so both old and new apps accept it.
Highlight spans carry BOTH classes (`plethora-highlight incrementum-highlight`)
so old-app CSS keeps styling new captures; the app styles both classes.
`data-plethora-app` is written; `data-incrementum-app` and either product
title are accepted for detection. Extension DOM ids (`plethora-save-indicator`
etc.) are extension-internal and renamed outright.

### D26 — Extension storage keys migrated inside the extension
`incrementum_extracts_*` / `incrementum_settings` live in the EXTENSION's own
`chrome.storage.local`, unreachable from the app. A one-shot migration in
`background.js` copies them to `plethora_*` names (keep old until copy
verified, then remove), mirroring the app-side brandMigration module.

### D27 — Keychain read-through never deletes; migration writes forward
New services `com.plethora.app` / `com.plethora.app.ai`. Read order: new
service → legacy service → new-dir encrypted file → legacy-dir encrypted file.
On a legacy hit the credential is written forward to the new location
(best-effort; failure only logs) and the legacy entry/file is left untouched.
`remove_*` (explicit user disconnect/delete) removes BOTH new and legacy
entries — that is the user asking for deletion, not a migration path.
Keyring IO is behind a tiny injectable adapter so tests can mock it.

### D28 — Export format: dual-write identity, legacy read forever
Exports use `.plethora` and `metadata.app: "Plethora"`; import accepts
`.plethora` and `.incrementum` and validates `app` ∈ {Plethora, Incrementum}.
The collection-archive marker stays `incrementum-collection-export` (retained
legacy: old exports must keep matching; old apps cannot read new exports
anyway once metadata says Plethora) — see BRANDING.md. Obsidian writes
`plethora-id`/`plethora-type`, reads either (new wins on conflict); the
opt-in "migrate vault ids" button rewrites frontmatter keys in place
(temp-file + rename per note, idempotent, default off).

### D29 — Minisign: single-pubkey limitation accepted, documented
tauri.conf.json accepts ONE updater pubkey. Switching to the new Plethora
key means the FINAL old-key release is the last auto-updatable one; the final
Incrementum notice release (§4) directs users to a manual download instead of
flipping the updater — consistent with the spec ("without silently switching
the old updater"). New keypair generated locally; private key uncommitted
(`src-tauri/keys/`, gitignored), public key wired into tauri.conf.json and
documented in `docs/legacy/updater-key-rotation.md`.

### D30 — Env vars: new-name-first with silent legacy fallback
`PLETHORA_*` is canonical; a shared Rust helper (`env_or_legacy`) falls back
to `INCREMENTUM_*` for one release. CI workflows set the new names.
`scripts/tauri-wrapper.sh` exports the new names; `vite.config.ts` reads
`PLETHORA_TAURI || INCREMENTUM_TAURI`.

### D31 — Dropbox folder: `/Plethora/` write, `/Incrementum/` read fallback
`ensure_app_folder` creates `/Plethora`; every read/list falls back to the
legacy `/Incrementum/` path when the new folder lacks the object. Existing
remote backups keep working; new writes land under `/Plethora/`.

### D32 — MCP commands renamed with deprecated aliases (one release)
Rust: `mcp_get_app_tools` / `mcp_call_app_tool` are the commands; the old
names remain registered as thin deprecated wrappers (log-once deprecation
warning). TS: `getAppMCPTools` / `callAppMCPTool` primary; old names
re-exported as deprecated aliases. Internal call sites and test mocks move
to the new names mechanically.

### D33 — Desktop upgrade dry-run (task 5.3)
macOS is covered AUTOMATICALLY by the Rust test suite (every migration path
executes against real temp directories):

- `legacy_data::tests::detection_arms_on_first_boot_and_rearms_from_marker`,
  `::detection_ignores_missing_or_empty_legacy_dir`,
  `::perform_migration_copies_renames_db_and_preserves_legacy`,
  `::completion_notice_is_surfaced_exactly_once` — the exact first-run
  scenario: a populated `com.incrementum.app` sibling, an empty
  `com.plethora.app`, consent→copy→db-rename→marker flow, legacy dir
  untouched, `.pre-migration-backup` of the fresh db, failure rollback.
- `database::connection::tests::resolve_*` — legacy `incrementum.db`
  adoption (real SQLite open + migrate + rename), new-name preference,
  journal-recovery from an interrupted adoption, fresh-install path.
- `cloud::auth_store::tests` / `commands::ai_key_store::tests` — keychain
  read-through + migrate-forward with a mock keyring, legacy-dir encrypted
  files.
- `integrations::brand_migration_tests` — Obsidian `incrementum-id`
  round-trip.

A full manual macOS dry-run (build Plethora, populate ~/Library/Application
Support/com.incrementum.app from a real Incrementum 2.7.0 install, launch,
accept, verify library + themes + keys, verify legacy dir untouched) should
still be performed ONCE on the release candidate by a human — recorded as
release-day checklist item, not blocking this change.

**Windows/Linux: manual-pending.** The Rust migration code is
platform-neutral `std::fs` against `dirs`-resolved paths and the detection
logic is unit-tested, but no Windows (`%APPDATA%\com.incrementum.app`) or
Linux (`~/.local/share/com.incrementum.app`) end-to-end run was performed
from this environment (single macOS host). Verification procedure for the
release owner (both OSes):

1. Install Incrementum 2.7.0, import/queue a few documents, set a theme,
   store one provider API key, create extracts + review once.
2. Install the Plethora build. First launch must show the localized
   migration consent dialog.
3. Accept → app restarts → documents, extracts, review history, theme, API
   key all present; `plethora.db` exists; legacy directory byte-identical
   (compare a recursive hash before/after).
4. Decline path: reinstall fresh → decline → empty library, legacy dir
   untouched, offer never repeats.
5. Repeat 2–4 with the legacy app RUNNING (expect the copy to still succeed
   or fail loudly with the legacy dir intact — never a half-copied db).

### D34 — Collection-archive marker: dual-write decision amended
D28 initially kept `incrementum-collection-export` as the only marker;
implementation instead WRITES `plethora-collection-export` and accepts both
(the type union in `src/types/archive.ts` carries both). Old-app compat of
Plethora exports is already impossible via `metadata.app`, so the legacy
marker buys nothing on write; accepting it keeps every legacy archive
importable.

### D35 — Desktop app-data subdirectory kept legacy
`<app_data>/incrementum/` (media/epub/youtube/sponsorblock/browser-sync
roots) and the anki `incrementum-` system-tag prefix are on-disk data
identities; the 3.1 migration copies the tree verbatim, so renaming the
lookup paths would orphan existing files. Documented retained-legacy in
BRANDING.md.

### D36 — Gate notes (task 5.2, branch `plethora/rebrand-phase-b`)
- `npm run test:run`: 409 files / 3522 tests passed (1 skipped).
- `cargo test --lib`: 840 passed, 0 failed (1 ignored).
- `npm run bench:check`: 21 benchmarks compared, ALL PASS (max ratio 1.04×);
  one stale-baseline WARN where `tabs-dom/mount-12-tab-workspace` measured
  FASTER than baseline (0.58×) — not a regression, baseline left untouched
  per the AGENTS.md rule (no intentional perf change; identifier lookups did
  not measurably shift any hot path, so no `perf-baselines.json` update).
  The bundle-budget leg initially reported ENOENT because `dist/` had not
  been built yet in that run order; `build:check` (which runs the same
  `check-bundle-budget.mjs` after `vite build`) and a standalone re-run both
  pass: entry 2614 KB, 1 PDF worker, total 22.1 MB.
- `npm run build:check`: tsc + vite build + bundle budget OK.
- Extension tests: `browser_extension/tests/` — 19 tests (shared + new
  brandProtocol contract) all pass.
- `npm run test:scripts`: 107 tests, 106 pass, 0 fail (1 skipped).

### D37 — window.confirm replaced by useModal
The first implementation of the migration consent dialogs used
`window.confirm`; the repo's `noNativeDialogs` guard caught it — wry's
WKUIDelegate never shows native JS dialogs and `confirm` returns false in
packaged builds, which would have silently declined every migration. Both
consent flows (legacy-data offer in MainLayout, vault-id migration in
IntegrationSettings) now use the in-app `useModal()` Promise-based dialog.
