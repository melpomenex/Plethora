# Change: Rebrand Incrementum to Plethora

> Wave 0 — Plethora Parity. First change in the Plethora transformation suite (see `openspec/planning/plethora-transformation-roadmap.md`). Everything else in the suite is sequenced after this baseline.

## Why

Incrementum (Apache-2.0, `github.com/melpomenex/incrementum-tauri`, v2.7.0) is being commercialized as **Plethora** — "Read anything. Learn everything." The git remote `origin` already points at `git@github.com:melpomenex/Plethora.git`, and Plethora icon masters (`plethora-icon-master.svg`, `plethora-icon-foreground.svg`, PNG renders) sit untracked in the repo root. This change produces a **behavior-preserving Plethora baseline**: the app works exactly as Incrementum does today, under the new identity, with zero user-data loss, before any commercial functionality is layered on.

This is explicitly **not** a naive global search-and-replace. The brand audit found **3,815 case-insensitive occurrences of "incrementum" across 665 files** (excluding `node_modules`, `.git`, lockfiles, build dirs). They fall into categories with very different risk profiles, and several identifiers **must survive** (or be migrated with shims) because they are baked into existing user installations and user-authored files.

## What exists today — branding inventory

### Safe user-facing branding (rename freely)
- `index.html` `<title>Incrementum</title>`, `apple-mobile-web-app-title`, `data-incrementum-app="true"` (attr *value* is protocol, see below).
- `public/manifest.json` (name/short_name), `public/sw.js` offline page + push title.
- i18n: 6 locales (`src/lib/i18n/locales/{en,zh,es,de,fr,ja}.ts`), ~197 translated lines mention Incrementum; **7 key names embed it** (`settings.aboutIncrementum`, `notebooklm.syncToIncrementum`, `notebooklmStudio.syncToIncrementum`, `notebooklm.syncedToIncrementum`, `ocrSettings.managedByIncrementum`, `importExport.incrementumPackage`, `integrations.syncFlashcardsFromIncrementumToAnki`) — renaming keys touches all locales + every `t()` call site.
- `README.md`, `CHANGELOG.md` (historical entries stay as-is; only new-facing content renames), `docs/USER_HANDBOOK*.md` (6 languages), `PKGBUILD`, `docker-compose.yml` labels.
- Desktop metadata: `src-tauri/tauri.conf.json` `productName`, `publisher`, `copyright`, descriptions; macOS/Windows/Linux bundle naming.

### Internal identifiers (may rename mechanically, no user impact)
- `IncrementumError` — the Rust error enum, **1,092 occurrences** (src-tauri/src). Rename to `PlethoraError` (or `AppError`) mechanically; pure code motion.
- Crate names `incrementum-tauri` / `incrementum_tauri_lib` (`src-tauri/Cargo.toml`); `package.json` `name: incrementum-tauri`.
- Env vars `INCREMENTUM_TAURI`, `INCREMENTUM_OPEN_DEVTOOLS`, `INCREMENTUM_USE_KEYCHAIN`, `INCREMENTUM_GOOGLE_DRIVE_CLIENT_ID`, `INCREMENTUM_DROPBOX_APP_KEY`, `INCREMENTUM_ONEDRIVE_CLIENT_ID` (+ CI usage in `.github/workflows/*.yml`, `vite.config.ts:15`, `scripts/tauri-wrapper.sh:50`).
- Rust log/temp strings: `incrementum-startup.log`, `incrementum-backups` tmpdir, UA `incrementum-updater`.
- MCP command names `mcp_get_incrementum_tools` / `mcp_call_incrementum_tool` (`src-tauri/src/commands/mcp.rs:213,243`) and TS wrappers `getIncrementumMCPTools`/`callIncrementumMCPTool` (`src/api/mcp.ts`) — external integrations may call these; rename with deprecated aliases.

### Migration-sensitive identifiers (require compat shims or staged migration)
1. **Bundle identity**: `com.incrementum.app` (tauri.conf.json identifier + Android `applicationId`/`namespace`, `src-tauri/gen/android/app/build.gradle.kts:23,26`). Drives the desktop app-data directory, `.window-state.json` path (`lib.rs:640-645`), keyring service names (`com.incrementum.app`, `com.incrementum.app.ai`).
2. **Database**: `incrementum.db` (+ `.corrupt.*` quarantine naming) in app-data dir (`src-tauri/src/lib.rs:446,952`).
3. **localStorage keys**: `incrementum-settings` (settings store v6 — read in `src/main.tsx`, `settingsStore.ts:1014`, ThemeContext, sound/notification services), `incrementum-tabs`, `incrementum-last-theme`, `incrementum-custom-themes`, `incrementum-feedback`, `incrementum-recall-dismissed-until`, `incrementum_skip_update_version`, browser-mode keys (`browser-backend.ts:678-682`), extension keys (`incrementum_extracts_*`, `incrementum_settings`).
4. **Service worker**: cache `incrementum-v7`, prefix sweep `incrementum-*`, IndexedDB `incrementum-sw` (`public/sw.js:8,99,643`).
5. **User-authored file formats**: backup extension `.incrementum` (`src/utils/appStateExport.ts:50`), Obsidian frontmatter key `incrementum-id` written into users' vault markdown (`src-tauri/src/integrations.rs:210,237,474,516+` — round-trip sync key; blind rename orphans existing vaults), export marker `incrementum-collection-export`, `incrementum-mnemosyne-*.txt` download name.
6. **Cross-boundary protocol strings** (must change atomically on both sides, with one-release compat): postMessage sources `incrementum-extension`/`incrementum-pwa` (`src/lib/extension-bridge.ts`, `browser_extension/content.js:95,115`), CSS/DOM contract `incrementum-highlight` class (used by BOTH `browser_extension/content.js:1456` and `src/components/common/RichContentRenderer.tsx:114-121`), `data-incrementum-app` selector + `document.title.includes('Incrementum')` app detection (`content.js:77-83`), DOM ids `incrementum-save-indicator`, `incrementum-extract-tooltip`, `__incrementum-extract-btn`, etc.
7. **Plugin IPC prefixes**: `plugin:incrementum-folder-import|…`, `plugin:incrementum-android-tts|…`, `plugin:incrementum-android-genai|…` — crate dirs `src-tauri/plugins/{incrementum-folder-import,incrementum-android-tts,incrementum-android-genai}`, invoked from TS (`src/api/documents.ts:565,588`, `src/utils/updateChecker.ts:287,294`) and Kotlin.
8. **Updater chain**: endpoint `https://github.com/melpomenex/incrementum-tauri/releases/latest/download/latest.json` + minisign pubkey (`tauri.conf.json:88-99`); artifact names `Incrementum_${version}_amd64.AppImage`, `Incrementum.app.tar.gz`, `Incrementum_${version}_x64-setup.exe` enforced in `.github/workflows/release.yml:735-760`; `scripts/release.cjs:109` bumps Cargo.toml via a regex anchored to `name = "incrementum-tauri"` (**silently fails after rename**); `scripts/release-downloads.sh` (OWNER/REPO), `verify-release-updates.mjs`; frontend checker hits `api.github.com/repos/melpomenex/incrementum-tauri` (`src/utils/updateChecker.ts`).
9. **Extension store identity**: manifest name "Incrementum Browser Sync", gecko id `incrementum-browser-sync@melpomenex.dev` (immutable AMO identity — orphans the AMO listing if changed), committed `.xpi` artifacts embed the brand.
10. **Android**: `res/values/strings.xml` app_name "Incrementum"; theme `Theme.incrementum_tauri`; mipmap icons; **`app/release.keystore is committed with passwords "incrementum"** (`build.gradle.kts:32-38`) — must be rotated for the commercial product regardless; Android auto-backup watch path `/storage/emulated/0/Download/Incrementum/Incrementum_Backup_Auto.db` (`lib.rs:984-986`); APK self-updater UA.
11. **iOS**: no `gen/ios` yet; `tauri.ios.conf.json` + `src-tauri/icons/ios/` set exist; CI builds on tags.
12. **Cloud configs**: Dropbox backup folder `/Incrementum/` (`cloud/dropbox.rs:431`); docker-compose Postgres credentials; `server/package.json` name `incrementum-sync-server`.
13. **User-agent/Referer strings**: `"Incrementum/1.0 (https://incrementum.app)"` (`commands/document.rs:1396,1563`), OpenRouter `HTTP-Referer: https://incrementum.app` + `X-Title: Incrementum` (multiple `.rs` + `browser-backend.ts:3437`).
14. **Licensing**: `LICENSE` is Apache-2.0 (no holder line, no NOTICE/CLA). Apache-2.0 §6 does not grant trademark rights, so the *name* is separately controlled — rename is not a license change. Historical commits remain Apache-2.0; see Open questions.

## What Changes

A **two-phase, compatibility-first rename**:

### Phase A — user-visible identity (ship first)
1. **Brand strings**: `productName: "Plethora"`, publisher, copyright, descriptions in `tauri.conf.json`; `index.html` title/meta; `public/manifest.json`; `public/sw.js` strings; all 6 i18n locales (rename the 7 embedded keys with codemod across all `t()` sites); README/docs/CHANGELOG front matter; `docker-compose.yml`; workflow display names and artifact names (`build.yml`, `release.yml`, `mobile-build.yml`, `testing-build.yml`, `windows-test-build.yml`, `ci-regression.yml`).
2. **Icons**: relocate the six untracked root assets (`plethora-icon-master.svg`, `-foreground.svg`, `-1024.png`, `-512.png`, `-6-reference.png`, `-assets.zip` — the zip byte-duplicates the loose files, verified) into a tracked `assets/brand/` directory, then wire the SVG masters through the existing icon pipeline (`scripts/generate-icons.mjs`, `scripts/icon-map.json`, `scripts/migrate-icons.mjs`) to regenerate: `src-tauri/icons/*` (icns/ico/png/store logos), `src-tauri/gen/android` mipmaps + foreground, `public/icons/*` (PWA incl. maskable), `browser_extension/icons/*`, favicon. The provided 1024/512 PNGs serve as visual fidelity references for generated output; the reference PNG is design documentation only.
3. **Tagline/positioning**: "Plethora — Read anything. Learn everything." replaces Incrementum taglines in README/manifest/store-facing copy. Keep feature vocabulary identical.
4. **UAs/Referers**: `"Plethora/<version> (https://plethora.app)"`, OpenRouter `X-Title: Plethora` (both Rust and `browser-backend.ts` mirrors).

### Phase B — identifiers, with data migration (coordinated, behind a migration checklist)
5. **Bundle identity** → `com.plethora.app`: new Tauri identifier, Android `applicationId`/namespace + manifest theme, Java package move (or keep package dir, change applicationId only — implementation decides, must preserve plugin registration). On desktop first-run: if new app-data dir is absent/empty and the old `com.incrementum.app` dir exists, run a **one-time data migration** (copy/move DB, settings, `ai_keys/`, `tokens/`, media dirs; see tasks) with a consent dialog and rollback (leave old dir intact until user confirms).
6. **Keychain**: write new entries under service `com.plethora.app[.ai]`; **read-through fallback** to old `com.incrementum.app` services and `<app_data>/ai_keys|tokens` encrypted files; migrate on first successful read.
7. **DB filename** → `plethora.db`: open-or-recover checks new name first, falls back to `incrementum.db` (and its `.corrupt.*` siblings) in the same dir; after successful open, rename file + WAL siblings atomically. Schema/`_schema_migrations` untouched.
8. **localStorage/SW migration**: one-shot boot migrator (extend the existing `src/lib/syncResidueCleanup.ts` pattern): read old `incrementum-*` keys → write new `plethora-*` keys → keep dual-read for one release; SW: new cache `plethora-v1` + purge `incrementum-*` caches/IDB on activate (pattern already exists at `sw.js:99`).
9. **File formats**: exports use `.plethora` extension; import accepts `.plethora` **and** legacy `.incrementum` forever (read-compat). Obsidian integration writes `plethora-id` frontmatter but reads both; one-time vault rewrite is NOT performed automatically — a settings action "migrate vault ids" is offered (flagged product decision).
10. **Protocol strings**: postMessage sources `plethora-extension`/`plethora-pwa` + `data-plethora-app` + class `plethora-highlight`; extension ships in the same release listening for **both** old and new tokens for one version, then drops old. Extension *display* name → "Plethora Capture" (or similar) while gecko id `incrementum-browser-sync@melpomenex.dev` is retained OR a new AMO listing is created (Open question).
11. **Plugin crates** → `plethora-folder-import`, `plethora-android-tts`, `plethora-android-genai` (dirs, Cargo refs, capabilities `src-tauri/capabilities/default.json:42-44`, TS IPC prefixes, Kotlin packages — atomic rename, no compat needed since app+extension ship together; the *desktop extension protocol* is the only external contract, handled above).
12. **Updater/release chain**: point updater + update checker + release scripts at `melpomenex/Plethora`; artifact names `Plethora_*`; fix `scripts/release.cjs` Cargo regex (now anchored to the new crate name `plethora-tauri`); **ship one final Incrementum-branded release from the old repo whose only change is an in-app notice directing users to Plethora download** (does not auto-switch updater). New minisign keypair for Plethora releases; keep old pubkey accepted for one transitional release.
13. **Android**: rotate the committed `release.keystore` (new key, not committed); auto-backup watch path becomes `Download/Plethora/Plethora_Backup_Auto.db` with legacy path still watched; strings/theme/icons renamed. Existing side-loaded `com.incrementum.app` installs are **not** auto-migrated (new applicationId = fresh install); the notice release + Export/Import (`.incrementum` backup read-compat) is the migration path (Play listing is new anyway — see proposal 23).
14. **Internal renames**: `IncrementumError`→`PlethoraError`, crate `plethora-tauri`/`plethora_tauri_lib`, package.json name `plethora-tauri`, env vars `PLETHORA_*` (CI + scripts updated together; accept old env names where cheap), MCP commands → `mcp_get_app_tools`/`mcp_call_app_tool` with old names kept as deprecated aliases for one release.
15. **Intentionally retained legacy identifiers** (documented in-code via a `BRANDING.md` appendix): `.incrementum` import compat, `incrementum-id` vault read-compat, old keychain read-through, old app-data dir fallback, AMO gecko id (if kept), historical CHANGELOG/releases/tags (437 tags stay).

## Impact

### Affected Specs
- `plethora-brand-identity` — New: user-visible identity + Phase A rules.
- `legacy-data-compatibility` — New: Phase B migration shims and retained identifiers.

### Affected Code Areas
Virtually every top-level area (see inventory above). Highest-risk: `src-tauri/src/lib.rs` (data-dir resolution, quarantine naming), `src-tauri/src/database/connection.rs` (db filename fallback), `src/stores/settingsStore.ts` (persist-key migration), `public/sw.js`, `src/lib/extension-bridge.ts` + `browser_extension/`, `src-tauri/plugins/*`, `.github/workflows/*`, `scripts/release.cjs`, `src-tauri/gen/android/**`, all 6 locale files.

### Non-goals
- No feature work, no UI redesign, no dependency changes, no license change.
- No rewrite of Incrementum history; old repo/tags/releases remain untouched.
- No automatic rewrite of user vaults or cloud backup folders.
- Not deciding final legal/licensing structure (flagged in Open questions).

## Dependencies

### Hard dependencies
- None — this is the root of the suite. **All other Plethora proposals depend on this landing first** (they introduce new UI strings, i18n keys, and config that would conflict with a concurrent rename).

### Soft dependencies
- Proposal 23 (store release) consumes the final bundle identity decided here.

### May run concurrently
- Nothing in the suite. (Routine bugfix work on `main` can continue; avoid interleaving with the locale codemod.)

### Must not start yet
- All 23 other proposals, strictly sequenced by the roadmap.

## Shared interfaces
- Consumes the existing OpenSpec/i18n/Tauri/CI conventions; produces **`BRANDING.md`** (identifier inventory + retained-legacy list) that every later proposal must consult before naming anything.

## Ownership boundaries
- **May modify**: any file containing brand strings or the identifiers listed above; icon pipeline inputs.
- **Must treat as external**: the `incrementum-oss` remote / historical releases/tags; AMO listing metadata (unless the new-listing decision is taken); user data on disk.

## Collision risks
- i18n locale files (every feature proposal appends keys) — the reason this is Wave 0 and strictly serialized.
- `src-tauri/src/lib.rs`, `settingsStore.ts`, `capabilities/default.json`, `Cargo.toml`/lockfile — high-traffic shared files; land in focused commits.

## Integration contract
- Output contract for the suite: product name **Plethora**, identifier **com.plethora.app**, prefix **`plethora-`** for new storage keys/protocols, env prefix **`PLETHORA_`**, new cloud keychain service names, `.plethora` export extension, tagline "Read anything. Learn everything."

## Testing & acceptance

### Tests (behaviors to prove)
- **Migration tests** (new vitest suite `src/lib/__tests__/brandMigration.test.ts` + Rust tests in `lib.rs`/`connection.rs`): old `incrementum-settings` localStorage → new key round-trip; old app-data dir → migrated (DB opens, migrations current, extracts/review history queryable); old keychain service read-through (mock keyring); `.incrementum` backup imports into Plethora; Obsidian file with `incrementum-id` still round-trips.
- **Extension protocol test**: app+extension pair accepts both old and new postMessage tokens during compat window.
- **No-regression**: existing suites green (`npm run test:run`, `cargo test --lib`), `noRealtimeSync.test.ts` still passes, bench gate `npm run bench:check` (no hot-path changes expected — update `scripts/perf-baselines.json` only if the identifier checks touch measured paths).
- **Visual**: PWA manifest/icons render; Playwright visual spec unaffected (`src/visual/`).

### Acceptance criteria
- No user-visible "Incrementum" remains in app UI, installer metadata, store-facing copy, README/docs front matter (historical CHANGELOG sections exempt).
- An Incrementum 2.7.0 desktop install upgrades to Plethora and finds its library, queue, review history, themes, API keys intact.
- Old `.incrementum` backups import; updater chain verified via `scripts/verify-update-artifact.mjs` + `verify-release-updates.mjs` against the Plethora repo.
- `BRANDING.md` committed listing every retained legacy identifier.

### Must remain unchanged
- All functionality, scheduling behavior, schemas (`_schema_migrations` untouched), bundle size budgets, perf baselines, all existing tests (modulo mechanical rename).

## Open questions (product/legal decisions required)
1. **License going forward**: history is Apache-2.0 with no CLA. New proprietary code can live in new modules/repos, but changing the license of existing files needs contributor consent — needs human/legal review. (This proposal makes no license change.)
2. **AMO extension identity**: keep `incrementum-browser-sync@melpomenex.dev` (continuity) vs new listing (clean identity).
3. **Final domains**: `plethora.app` availability; fate of `readsync.org` PWA + `incrementum.app` references.
4. **Android package migration UX**: accept fresh-install + backup-import, or invest in a Play-internal migration path.
