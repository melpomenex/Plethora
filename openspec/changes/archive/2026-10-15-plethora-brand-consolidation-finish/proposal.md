# Plethora 1.0 — Proposal B: Finish Incrementum → Plethora Brand Consolidation

## Why

The Phase-B rebrand (`rebrand-incrementum-to-plethora`) renamed identifiers, the extension manifest, and regenerated all icon sets — but a repo-wide audit still finds live user-facing "Incrementum" strings, real rename breakage, stale docs, and guard-test gaps. Commercial launch requires zero accidental legacy branding and no broken builds.

## What Changes

- **Fix true user-facing leftovers**: Linux main-window title (`tauri.linux.conf.json`), About heading + legacy URLs in `pages/SettingsPage.tsx`, PWA install banner copy (`PWAComponents.tsx`), OPML export `<title>` (`browser_sync_server.rs`), default `MEMORY.md` heading (`commands/ai.rs`), MCP server/client/tool names (`mcp/*.rs`), Obsidian `source:` frontmatter value (`integrations.rs`), TTS spoken test sentences, NotebookLMLoginPanel hardcoded copy, mnemosyne export filename, hidden article-capture window title.
- **Fix rename breakage**: `examples/figdiag.rs` imports stale crate name (does not compile), `screenshot.rs` window-title match, stale `incrementum.db` paths in scheduler/backup commands, stale `incrementum.exe`/`incrementum-tauri` names in `windows-test-build.yml` + `cross-build*.sh` + `AppRun`, stale Android `.gitignore` rule, four remaining Incrementum user-agents in `podcast.rs`.
- **Docs & extension surfaces**: rewrite `browser_extension/README.md`, `browser_extension/icons/README.md`, and `docs/INSTALL.md` in Plethora terms; rebrand dev-only `manifest_debug.json`/`manifest_minimal.json`/`background_minimal.js`; update agent skills (`.agents/skills/android-build`, `cut-release`) that actively mislead automation.
- **Widen the guard**: extend `src/__tests__/brandInventory.test.ts` to cover `tauri.linux.conf.json`, MCP identity strings, and the fixed docs, with an explicit allowlist (rationale per entry) for retained legacy identifiers.
- **Do NOT touch** documented compatibility surfaces: AMO gecko id `incrementum-browser-sync@melpomenex.dev`, protocol dual tokens, legacy keychain/DB/app-data names, Anki/Obsidian round-trip identities, docker creds, updater legacy pubkey, migration copy that intentionally names the old product.

## Capabilities

### New Capabilities
- `brand-consistency`: repository-wide rule that customer-facing surfaces say Plethora and use canonical assets, enforced by an allowlisted brand-inventory test.

### Modified Capabilities
- None.

## Impact

- ~20 source files (TS/Rust/JSON), 3 docs, 2 agent skills, 1 test file. No data migrations; all preserved identifiers already have dual-read/migration windows (documented in `BRANDING.md`).
- Extension users keep update continuity (gecko id and protocol tokens unchanged); extension icons are already regenerated from the canonical master via `scripts/generate-icons.mjs` — verified, not redone.

Cross-references: part of Plethora 1.0; should land before `plethora-1-0-release-candidate-hardening` (its brand pass depends on this being complete).
