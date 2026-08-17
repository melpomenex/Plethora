## 1. User-facing string fixes

- [x] 1.1 `tauri.linux.conf.json` window title → Plethora
- [x] 1.2 `pages/SettingsPage.tsx` About heading; audit legacy links
- [x] 1.3 `PWAComponents.tsx` install banner strings
- [x] 1.4 Rust: OPML title, MEMORY.md heading, MCP server/client/tool names, Obsidian `source:` value, mnemosyne export filename, capture window title
- [x] 1.5 `TTSSettings.tsx` spoken test sentences; `NotebookLMLoginPanel.tsx` copy; remaining `podcast.rs` user agents

## 2. Breakage fixes

- [x] 2.1 `examples/figdiag.rs` crate imports
- [x] 2.2 `screenshot.rs` window title match
- [x] 2.3 `incrementum.db` paths → shared DB-location helper (`scheduler.rs`, `cloud/backup.rs`, `backup/manager.rs`)
- [x] 2.4 `windows-test-build.yml`, `cross-build*.sh`, `AppRun` artifact names
- [x] 2.5 Android `gen/.gitignore` stale rule

## 3. Docs & skills

- [x] 3.1 Rewrite `browser_extension/README.md` + `icons/README.md` in Plethora terms
- [x] 3.2 Rewrite `docs/INSTALL.md` product/artifact names
- [x] 3.3 Update `.agents/skills/android-build`, `cut-release` SKILL.md names/paths
- [x] 3.4 Rebrand dev-only `manifest_debug.json`, `manifest_minimal.json`, `background_minimal.js`

## 4. Guard widening + validation

- [x] 4.1 Extend `brandInventory.test.ts` (Linux conf, MCP identity, new doc surfaces, allowlist with rationale)
- [x] 4.2 `cargo test` compile check incl. examples; `npm run test:run` brand suites; `npm run test:browser-extension`
## 5. Follow-up pass

- [x] 5.1 Full SuperMemo word scrub (handbooks ×6, import UI, AI prompt, dialogs/console); guards tightened to zero-allowlist
- [x] 5.2 Linux/Windows unbundled-run window icon (runtime set_icon) + icons/icon.png in bundle.icon; validated PNG/ICO structure
