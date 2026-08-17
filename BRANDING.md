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
> surface (do not "clean it up") or scheduled for Phase B of
> `openspec/changes/rebrand-incrementum-to-plethora/`. See also
> `DECISIONS.md` in that change for the rationale behind each call.

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
| Bundle identifier `com.incrementum.app` | `tauri.conf.json` identifier, Android `applicationId`/`namespace`, app-data dir, `.window-state.json` path | **Phase-B-pending** (→ `com.plethora.app` + data migration, task 3.1) |
| DB filename `incrementum.db` (+ `.corrupt.*`) | `src-tauri/src/lib.rs` | **Phase-B-pending** (fallback + atomic rename, task 3.2) |
| localStorage keys `incrementum-*` | `incrementum-settings`, `incrementum-tabs`, `incrementum-last-theme`, `incrementum-custom-themes`, `incrementum-feedback`, `incrementum-recall-dismissed-until`, `incrementum_skip_update_version`, `incrementum.reading-sessions`, `incrementum.conversational-review-assessments`, `incrementum-tts-cache`, `incrementum.community.*`, `incrementum_demo_content_imported`, browser-mode keys (`browser-backend.ts`), `incrementum_extracts_*` / `incrementum_settings` (extension pages) | **Phase-B-pending** (one-shot migrator, task 3.3) |
| Service-worker storage | cache `incrementum-v8` (content-versioned; namespace rename to `plethora-v1` in Phase B), sweep prefix `incrementum-*`, IndexedDB `incrementum-sw` | **Phase-B-pending** (task 3.3) |
| Backup format `.incrementum` + `metadata.app: "Incrementum"` | `utils/appStateExport.ts`, `utils/appStateImport.ts` | **retained-legacy** (import forever; `.plethora` export in Phase B, task 3.5) |
| Obsidian frontmatter `incrementum-id` | `src-tauri/src/integrations.rs` | **retained-legacy** (read-match; write `plethora-id` in Phase B, task 3.5) |
| Anki identities | note model `Incrementum Basic` (`ankiExport.ts`), default deck name `Incrementum` (settings defaults) | **retained-legacy** (external data round-trip; Phase B decision D10) |
| Obsidian/Dropbox/GDrive/OneDrive default folders | `Incrementum`, `Incrementum Assets`, `/Incrementum/` | **retained-legacy** (stored-data identity; Phase B decision D10) |
| App↔extension protocol tokens | postMessage sources `incrementum-extension`/`incrementum-pwa`, `data-incrementum-app` attr (incl. value in `index.html`), `document.title.includes('Incrementum')` detection, DOM ids `incrementum-save-indicator`/`incrementum-extract-tooltip`/`__incrementum-extract-btn`/…, class `incrementum-highlight`, `incrementum://` notification scheme | **retained-legacy** → atomic dual-token switch in Phase B (task 3.6) |
| Extension store identity | AMO gecko id `incrementum-browser-sync@melpomenex.dev`, committed `.xpi` artifacts | **retained-legacy** (orphaning the AMO listing; display name is "Plethora Capture") |
| Plugin IPC prefixes + crates | `plugin:incrementum-folder-import|…`, `plugin:incrementum-android-tts|…`, `plugin:incrementum-android-genai|…`, `src-tauri/plugins/incrementum-*` | **Phase-B-pending** (atomic rename, task 3.7) |
| Updater chain | endpoint `github.com/melpomenex/incrementum-tauri/releases/latest/download/latest.json`, minisign pubkey (`tauri.conf.json`), update checker repo (`utils/updateChecker.ts`), `scripts/release.cjs` Cargo regex anchor `name = "incrementum-tauri"`, `release-downloads.sh` OWNER/REPO | **Phase-B-pending** (task 3.8; final notice release §4) |
| Rust error enum `IncrementumError` | ~1,092 sites in `src-tauri/src` | **Phase-B-pending** (mechanical rename, task 3.10) |
| Crate/package names | `incrementum-tauri` / `incrementum_tauri_lib` (Cargo), `incrementum-tauri` (package.json), `incrementum-sync-server` (server), `incrementum-api` (api/pyproject.toml) | **Phase-B-pending** (task 3.10) |
| Env vars | `INCREMENTUM_TAURI`, `INCREMENTUM_OPEN_DEVTOOLS`, `INCREMENTUM_USE_KEYCHAIN`/`DISABLE_KEYCHAIN`, `INCREMENTUM_GOOGLE_DRIVE_CLIENT_ID`, `INCREMENTUM_DROPBOX_APP_KEY`, `INCREMENTUM_ONEDRIVE_CLIENT_ID`, `INCREMENTUM_TAURI_XVFB` (CI, `vite.config.ts`, `scripts/tauri-wrapper.sh`) | **Phase-B-pending** (→ `PLETHORA_*` + aliases, task 3.10) |
| Keychain services | `com.incrementum.app`, `com.incrementum.app.ai` (`cloud/auth_store.rs`, `commands/ai_key_store.rs`) | **Phase-B-pending** (write-new/read-old, task 3.4) |
| MCP command names | `mcp_get_incrementum_tools` / `mcp_call_incrementum_tool` + TS wrappers `getIncrementumMCPTools`/`callIncrementumMCPTool` | **Phase-B-pending** (rename + deprecated aliases, task 3.10) |
| Android internals | `applicationId`/`namespace` `com.incrementum.app`, theme `Theme.incrementum_tauri`, Java packages, committed `release.keystore` (passwords "incrementum" — must be rotated regardless), auto-backup watch path `Download/Incrementum/Incrementum_Backup_Auto.db` | **Phase-B-pending** (tasks 3.1/3.9; fresh-install migration path per D3) |
| Rust log/temp strings | `incrementum-startup.log`, `incrementum-backups` tmpdir | **Phase-B-pending** (task 3.10) |
| Windows binary name `incrementum.exe` / macOS binary `incrementum-tauri` | crate output referenced by workflows/scripts | **Phase-B-pending** (follows crate rename) |
| CI-internal keystore credentials | `incrementum-ci` alias/passwords, `CN=Incrementum CI` dname (mobile-build self-signed fallback) | **Phase-B-pending** (rides env/identifier sweep) |
| docker-compose Postgres credentials | user/pass/db `incrementum` | **Phase-B-pending** (cloud config; not branding) |
| Functional legacy URLs | `docs.incrementum.app`, `discord.gg/incrementum`, `github.com/melpomenex/incrementum-tauri` links, `readsync.org` PWA | **retained-legacy** until Plethora equivalents exist (D2) |
| `web_proxy.rs` desktop-browser UA | comment documents why a browser-like UA replaced the old `Incrementum/1.0` one | **retained-legacy** (historical comment; active UA is browser-like, unchanged) |
| History | `CHANGELOG.md` entries, 437 git tags, archived releases, `scripts/perf-baselines.json` provenance note | **retained-legacy** (never rewritten) |
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
