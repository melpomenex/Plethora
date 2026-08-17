# DECISIONS — rebrand-incrementum-to-plethora

Conservative defaults taken during implementation of **tasks.md sections 1–2 (Phase A)**
on branch `plethora/rebrand`. Sections 3–5 (Phase B, notice release, validation) are out
of scope here. Every open question hit during implementation is logged below with
rationale. Product-owner sign-off items are marked **[sign-off pending]**.

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

### D12 — Docs handbooks: front matter + intro brand name only
The six `docs/USER_HANDBOOK*.md` files get their H1 title and the brand name in the
opening intro lines rebranded (translated naturally per language); the ~35 deeper body
mentions per file are unchanged in Phase A (they describe the historical product; a
full 6-language docs sweep is low-value churn now and belongs with the Phase B docs
pass). The in-app handbook (`handbookContent.ts`) contains no brand strings.

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
