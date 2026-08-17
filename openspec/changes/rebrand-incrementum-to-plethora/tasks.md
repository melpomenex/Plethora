# Implementation Tasks

## 1. Inventory & guardrails
- [x] 1.1 Write `BRANDING.md` (full identifier inventory, category per identifier, retained-legacy list) from this proposal
- [x] 1.2 Add `src/__tests__/brandInventory.test.ts` scanning for user-visible "Incrementum" strings in bundled surfaces (i18n exports, manifest, index.html) to prevent regressions
- [x] 1.3 Decide + record AMO gecko-id, domain, and Android-migration decisions from Open questions (product owner sign-off)

## 2. Phase A — user-visible identity
- [x] 2.1 `tauri.conf.json` productName/publisher/copyright/descriptions; `index.html`; `public/manifest.json`; `public/sw.js` strings
- [x] 2.2 i18n codemod: rename 7 embedded keys across 6 locales + all `t()` call sites; update ~197 translated lines
- [x] 2.3 README, docs front matter (6 handbook languages), docker-compose, PKGBUILD, workflow names/artifact names (5 workflows)
- [x] 2.4 Brand source assets: create `assets/brand/`, commit the six root files there (`plethora-icon-master.svg`, `plethora-icon-foreground.svg`, `plethora-icon-1024.png`, `plethora-icon-512.png`, `plethora-icon-6-reference.png`, `plethora-icon-assets.zip`); verify zip contents are byte-identical to the loose files (they duplicate them), then remove the loose root copies so no untracked `plethora-icon-*` remains
- [x] 2.5 Icon pipeline: generate every target from `assets/brand/plethora-icon-master.svg` + `-foreground.svg` via `scripts/generate-icons.mjs` — desktop icns/ico/png/store logos (`src-tauri/icons/`), Android mipmaps incl. foreground + `src-tauri/icons/ios/` set, PWA icons incl. maskable (`public/icons/`), extension icons, favicon; the provided 1024/512 PNGs are fidelity references (generated 1024/512 must match them visually, not byte-wise); `plethora-icon-6-reference.png` is design documentation only, never a pipeline input
- [x] 2.6 Verify generated icon set: every path referenced by `tauri.conf.json`, `public/manifest.json`, Android `res/mipmap-*`, and `browser_extension/manifest.json` exists and carries the Plethora mark (extend `src/__tests__/brandInventory.test.ts` with an icon-registry assertion)
- [x] 2.5 UA/Referer/X-Title strings in Rust (`commands/document.rs`, `browser_sync_server.rs`, `api/youtube/transcript.py`) and `browser-backend.ts` mirrors
- [x] 2.6 Extension manifest display name + titles (keep functional ids per decision 1.3)

## 3. Phase B — identifiers & data migration
- [x] 3.1 Tauri identifier → `com.plethora.app`; Android applicationId/namespace/theme; desktop one-time app-data migration (copy DB+assets, consent dialog, rollback, `StartupNotice` surfacing) in `lib.rs`
- [x] 3.2 DB filename fallback + atomic rename in `database/connection.rs` + quarantine naming compat
- [x] 3.3 localStorage one-shot migrator (extend `syncResidueCleanup.ts` pattern); SW `plethora-v1` + legacy purge
- [x] 3.4 Keychain service rename with read-through + first-read migration (`cloud/auth_store.rs`, `commands/ai_key_store.rs`)
- [x] 3.5 `.plethora` export extension; `.incrementum` import compat (`appStateExport.ts`, `ImportExportSettings.tsx`); Obsidian `plethora-id` write + `incrementum-id` read-match (`integrations.rs`)
- [x] 3.6 Protocol strings (`extension-bridge.ts`, `RichContentRenderer.tsx`, extension `content.js`) with dual-token compat window
- [x] 3.7 Plugin crates rename (dirs, Cargo, capabilities, TS IPC prefixes, Kotlin packages) — atomic
- [x] 3.8 Updater/checker/scripts → Plethora repo + artifacts; new minisign key; fix `release.cjs` Cargo regex; `release-downloads.sh`/`verify-*` repo args
- [x] 3.9 Android: rotate committed keystore (new uncommitted key), backup watch path + legacy fallback, strings/theme/icons
- [x] 3.10 Internal renames: `IncrementumError`→`PlethoraError` (1,092 sites), crate/package names, env `PLETHORA_*` + aliases, MCP command aliases

## 4. Final Incrementum notice release
- [x] 4.1 Old-repo release adding in-app "Plethora is here" migration notice (no updater switch)

## 5. Validation
- [x] 5.1 Migration test suite: app-data dir, db filename, localStorage, keychain read-through, `.incrementum` import, vault round-trip, extension dual-token
- [x] 5.2 Full gates: `npm run test:run`, `cargo test --lib`, `npm run bench:check`, `npm run build:check`, extension tests
- [x] 5.3 Desktop upgrade dry-run from a populated Incrementum profile (macOS + Windows + Linux) documented in verification record
- [x] 5.4 Release-channel verification: `verify-update-artifact.mjs` + `verify-release-updates.mjs` green against Plethora artifacts
