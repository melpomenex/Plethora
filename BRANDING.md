# BRANDING.md — Plethora brand & identifier inventory

**Product:** Plethora — *Read anything. Learn everything.*
**Integration contract for every later proposal:** product name **Plethora** · bundle
identifier **`com.plethora.app`** (Phase B) · prefix **`plethora-`** for new storage
keys / caches / protocol tokens · env prefix **`PLETHORA_`** · keychain services
`com.plethora.app` / `com.plethora.app.ai` · export extension **`.plethora`** ·
brand domain (provisional) **`plethora.app`** · extension display name
**"Plethora Capture"**.

> **Consult this file before naming anything.** The repo intentionally still contains
> `incrementum*` identifiers; each one below is either a documented compatibility
> surface (do not "clean it up") or a historical artifact. Phase B of
> `openspec/changes/rebrand-incrementum-to-plethora/` is COMPLETE (branch
> `plethora/rebrand-phase-b`) — every former "Phase-B-pending" item is now
> **safe-renamed** (with its migration noted) or **retained-legacy**.
> See `DECISIONS.md` in that change for the rationale behind each call.

## Categories

- **safe-renamed** — user-visible branding; already renamed in Phase A.
- **retained-legacy** — kept deliberately (compatibility with existing installs,
  user-authored files, or external stores). Renaming breaks users. Do not touch
  without a migration design.
- **Phase-B-pending** — internal identifier scheduled for rename with data migration
  in change `rebrand-incrementum-to-plethora` tasks 3.x. Not user-visible.

## Identifier inventory

| Identifier | Where | Category |
|---|---|---|
| Product name in UI, installers, store copy, i18n values | `tauri.conf.json` productName/publisher/copyright/descriptions, `index.html`, `public/manifest.json`, `public/sw.js` strings, all 6 locales, README/docs front matter, workflow display names | **safe-renamed** |
| i18n keys embedding the old name (7) | `settings.aboutPlethora`, `notebooklm.syncToPlethora`, `notebooklmStudio.syncToPlethora`, `notebooklm.syncedToPlethora`, `ocrSettings.managedByPlethora`, `importExport.plethoraPackage`, `integrations.syncFlashcardsFromPlethoraToAnki` (all locales + `t()` sites) | **safe-renamed** |
| Outbound UA / attribution | `Plethora/1.0 (https://plethora.app)`, `Plethora/1.31.0`, OpenRouter `HTTP-Referer: https://plethora.app` + `X-Title: Plethora` (`commands/document.rs`, `commands/podcast.rs`, `browser_sync_server.rs`, `ai/providers.rs`, `ai/embeddings.rs`, `commands/llm.rs`, `api/youtube/transcript.py`, `lib/browser-backend.ts`, `api/sponsorblock.ts`) | **safe-renamed** |
| Icon set | masters in `assets/brand/` → `src-tauri/icons/*`, `src-tauri/icons/ios/*`, `src-tauri/gen/android/**/mipmap-*`, `public/icons/*`, `browser_extension/icons/*`, `public/apple-touch-icon.png`, `public/icon.png` | **safe-renamed** (see icon registry below) |
| Release artifacts derived from productName | `Plethora_${v}_amd64.AppImage`, `Plethora.app.tar.gz`, `Plethora_${v}_x64-setup.exe` (`release.yml`, `ci-build-appimage.sh`, arch-pkg heredocs in `build.yml`/`release.yml`) | **safe-renamed** (follows productName) |
| Android launcher label | `res/values/strings.xml` `app_name`/`main_activity_title` = "Plethora" | **safe-renamed** |
| Bundle identifier | `com.plethora.app` everywhere (`tauri.conf.json`, Android `applicationId`/`namespace`/MainActivity package, `.window-state.json`) | **safe-renamed** (3.1; one-time desktop app-data migration with consent + rollback — see `src-tauri/src/legacy_data.rs`; legacy dir read-through for keychain files) |
| DB filename `incrementum.db` (+ `.corrupt.*`) | quarantine/quarantine-scan history; `restore_local_db_backup` uses `plethora.db` | **safe-renamed** (3.2; journal-protected adopt of the legacy file set at `database/connection.rs`; `.corrupt.*` siblings of both stems recognized) |
| localStorage keys | all app keys now `plethora-*` (settings v6 store, tabs, themes, feedback, recall, skip-update, community, browser-mode, feature flags, internal events) | **safe-renamed** (3.3; one-shot migrator `src/lib/brandMigration.ts` + dual-read `migratedGetItem`; PWA IndexedDB library `incrementum`→`plethora` record-copied) |
| Sync-residue keys | `incrementum_sync_*`, `incrementum-yjs:*`, `incrementum.sync-residue-cleaned` flag | **retained-legacy** (owned by `syncResidueCleanup`; deleted there, never migrated) |
| Extension page-storage keys | `incrementum_extracts_<host>`, `incrementum_settings` page-localStorage caches | **retained-legacy (read)** — extension writes `plethora_*` and dual-reads legacy during the compat window (D26) |
| Service-worker storage | cache `plethora-v1`; activate purges legacy `incrementum-*` caches and migrates then deletes `incrementum-sw` | **safe-renamed** (3.3) |
| Backup format | exports `.plethora` + `metadata.app: "Plethora"`; import accepts `.plethora` AND legacy `.incrementum`/`metadata.app: "Incrementum"` forever | **retained-legacy (read)** (3.5; D28) |
| Obsidian frontmatter | writes `plethora-id`/`plethora-type`; reads both (new wins); opt-in "migrate vault ids" settings action (default off) | **retained-legacy (read)** (3.5; D28) |
| Anki identities | note model `Incrementum Basic` (`ankiExport.ts`), default deck name `Incrementum` (settings defaults) | **retained-legacy** (external data round-trip; Phase B decision D10) |
| Obsidian/Dropbox/GDrive/OneDrive default folders | `Incrementum`, `Incrementum Assets`, `/Incrementum/` | **retained-legacy** (stored-data identity; Phase B decision D10) |
| App↔extension protocol | sources `plethora-extension`/`plethora-pwa`, `data-plethora-app`, class `plethora-highlight`, `plethora://` scheme; dual-token compat window (both sides accept both, requestId dedupe, dual-class spans) | **safe-renamed** (3.6; drop legacy tokens after one release — D25) |
| Extension store identity | AMO gecko id `incrementum-browser-sync@melpomenex.dev`, committed `.xpi` artifacts | **retained-legacy** (orphaning the AMO listing; display name is "Plethora Capture") |
| Plugin crates/IPC | `src-tauri/plugins/plethora-*`, `plugin:plethora-*|…`, Kotlin `com.plethora.*` | **safe-renamed** (3.7; Android TTS notification channel id stays legacy — on-device persistence) |
| Updater chain | endpoint + checker → `melpomenex/Plethora`; new minisign key (private uncommitted, `src-tauri/keys/`); release.cjs anchored on `plethora-tauri` | **safe-renamed** (3.8; single-pubkey limitation documented in `docs/legacy/updater-key-rotation.md` — D29) |
| Rust error enum | `PlethoraError` everywhere | **safe-renamed** (3.10) |
| Crate/package names | `plethora-tauri` / `plethora_tauri_lib` / `plethora-tauri` (package.json) / `plethora-sync-server` | **safe-renamed** (3.10; `api/pyproject.toml` stays `incrementum-api` — infra config, D16) |
| Env vars | canonical `PLETHORA_*` everywhere; Rust reads fall back to `INCREMENTUM_*` for one release (`utils/keychain::env_or_legacy`) | **safe-renamed** (3.10; D30) |
| Keychain services | write `com.plethora.app[.ai]`; read-through to legacy services + legacy-dir encrypted files, migrate-forward on read | **safe-renamed** (3.4; legacy entries never deleted by a read — D27) |
| MCP command names | `mcp_get_app_tools` / `mcp_call_app_tool` + `getAppMCPTools`/`callAppMCPTool`; old names kept as deprecated aliases for one release | **safe-renamed** (3.10; D32) |
| Android internals | `com.plethora.app`, `Theme.plethora_tauri`, `com.plethora.*` plugin packages, keystore env/properties-driven (never committed), backup watch/write `Download/Plethora/Plethora_Backup_Auto.db` + legacy paths still watched | **safe-renamed** (3.1/3.9; fresh-install + `.incrementum` import is the migration path per D3) |
| Rust log/temp strings | `plethora-startup.log`, `plethora-backups` tmpdir, UA `plethora-updater` | **safe-renamed** (3.10) |
| Windows/macOS binary names | `plethora.exe` / `plethora-tauri` (follows crate rename; workflows/scripts updated) | **safe-renamed** (3.10) |
| CI-internal keystore credentials | `plethora-ci` alias/passwords, `CN=Plethora CI` dname (mobile-build self-signed fallback) | **safe-renamed** (3.9) |
| docker-compose Postgres credentials | user/pass/db `incrementum` | **retained-legacy** (cloud infra config, not branding — D16; renaming orphans deployed databases) |
| Functional legacy URLs | `docs.incrementum.app`, `discord.gg/incrementum`, `github.com/melpomenex/incrementum-tauri` links, `readsync.org` PWA | **retained-legacy** until Plethora equivalents exist (D2) |
| `web_proxy.rs` desktop-browser UA | comment documents why a browser-like UA replaced the old `Incrementum/1.0` one | **retained-legacy** (historical comment; active UA is browser-like, unchanged) |
| History | `CHANGELOG.md` entries, 437 git tags, archived releases, `scripts/perf-baselines.json` provenance note | **retained-legacy** (never rewritten) |
| App-data subdirectory `incrementum/` | media/epub/youtube/sponsorblock/browser-sync roots inside the app-data dir (`epub_server.rs`, `youtube.rs`, `sponsorblock.rs`, `browser_sync_server.rs`, `notebooklm.rs`) | **retained-legacy** (on-disk data identity; the 3.1 migration copies it wholesale — renaming would orphan existing media) |
| Anki system-tag prefix `incrementum-` | `anki.rs` import/export tag matching | **retained-legacy** (tags live in user learning items) |
| Android TTS notification channel id | `incrementum_tts_playback` (`TtsPlaybackService.kt`) | **retained-legacy** (Android persists channels by id; renaming strands user channel settings) |
| Collection-archive marker | import accepts `plethora-collection-export` AND `incrementum-collection-export` | **retained-legacy (read)** (D28; legacy archives stay importable) |
| `[incrementum]` default Obsidian tag | `defaultSettings.ts` / `settingsValidation.ts` template | **retained-legacy** (default matches what existing users' notes carry — D10) |
| Desktop WebView localStorage | settings/themes/tabs persisted under the pre-rebrand identity's WebView store are NOT migrated (WKWebView/WebView2 private stores keyed by identity) | **retained-legacy** (documented limitation D24; library/keys/history live in SQLite and ARE migrated) |
| Theme colors | `#6daa2c` green theme-color/manifest colors | **Phase-B-pending** (design decision; app UI palette is still green — D11) |

## Brand assets (`assets/brand/`)

| File | Role |
|---|---|
| `plethora-icon-master.svg` | Canonical square icon master (white bg + purple-gradient "Friendly Chirp" P-bird). Pipeline input for every square target. |
| `plethora-icon-foreground.svg` | Transparent adaptive-icon foreground (Android `ic_launcher_foreground`). Pipeline input. |
| `plethora-icon-1024.png`, `plethora-icon-512.png` | Visual-fidelity references — generated output must match visually, NOT byte-wise. Not pipeline inputs. |
| `plethora-icon-6-reference.png` | Design documentation only. **Never a pipeline input.** |
| `plethora-icon-assets.zip` | Archive of the five files above. Verified byte-identical to the loose files (sha256, all five entries) on 2026-08-17. |

## Icon registry (source of truth — asserted by `src/__tests__/brandInventory.test.ts`)

Referenced by `tauri.conf.json`: `src-tauri/icons/32x32.png`, `128x128.png`,
`128x128@2x.png`, `icon.icns`, `icon.ico`.
`icon.icns` is the one non-square target: `scripts/generate-icons.mjs` derives
it from the square master as a macOS Big Sur-style tile (824/1024 artwork box,
corner radius 185.4, transparent margins) because macOS applies no corner mask
to icns icons — a full-bleed square renders with sharp corners in the Dock.
Every other target (Windows/Linux/iOS/Android/web) keeps full-bleed square
art; those platforms mask or expect squares.
Referenced by `public/manifest.json` + `index.html` + `public/sw.js`:
`public/icons/sprout-{72,96,128,144,152,180,192,384,512}x*.png`,
`sprout-maskable-{192,512}x*.png`, `badge-72x72.png`, `public/apple-touch-icon.png`.
Referenced by `browser_extension/manifest.json`: `browser_extension/icons/icon{16,32,48,128}.png`.
Android launchers: `src-tauri/gen/android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png`,
`ic_launcher_round.png`, `ic_launcher_foreground.png`.
iOS: `src-tauri/icons/ios/AppIcon-*.png` (full Xcode set).
Legacy-compat filenames (`sprout-*`, `icon-*`, `icon.svg`) are kept on purpose: they are
resource URLs, not brand surfaces.

## i18n conventions (unchanged by rebrand)

Every user-facing string lands in all six locales (`en zh es de fr ja`) in the same
change; feature vocabulary ("incremental reading", 增量阅读, lecture incrémentale, …)
is feature terminology and was deliberately NOT renamed — only the product name
(Incrementum → Plethora) was.
