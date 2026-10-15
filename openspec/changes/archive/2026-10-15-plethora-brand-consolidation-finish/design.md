# Design — Finish Brand Consolidation

## Context

`rebrand-incrementum-to-plethora` Phase B renamed identifiers and assets (see `BRANDING.md` inventory: 40-row classification, extension icons already regenerated from master). The remaining work is a bounded fix-list from a fresh repo-wide audit plus guard-test widening. Compatibility surfaces with existing dual-read/migration windows stay untouched.

## Goals / Non-Goals

**Goals:** every live user-facing string says Plethora; rename-induced breakage fixed; docs/skills no longer mislead; brand test covers the gaps that let leftovers slip.

**Non-Goals:** renaming AMO gecko id, protocol tokens, legacy keychain/DB/app-data paths, Anki/Obsidian round-trip identities, docker creds, updater legacy pubkey; re-generating icons (done); touching migration copy that intentionally names Incrementum.

## Decisions

1. **Fix list-driven, not sweep**: implement exactly the audited 1A/1B items; each is a string/constant/path fix with no schema impact.
2. **Docs rewrite not delete**: `browser_extension/README.md`, `docs/INSTALL.md` keep structure, update product name, artifact names (`Plethora_x64-setup.exe`, `plethora.exe`, `plethora-tauri`), and URLs only where functional legacy URLs (repo, readsync.org demo) remain until replacements exist — mark them as legacy where kept.
3. **Guard widening**: `brandInventory.test.ts` gains assertions for `tauri.linux.conf.json` title, MCP server/client/tool identity, PWA banner strings, TTS test sentences, OPML title, mnemosyne filename, capture window title, and the two extension READMEs/INSTALL.md top-level name checks; retained legacy identifiers move into the test's documented allowlist with rationale comments (source: BRANDING.md table).
4. **`incrementum.db` path fixes** in `scheduler.rs`/`cloud/backup.rs`/`backup/manager.rs` use the DB-location helper from `database/connection.rs` instead of a hardcoded filename, matching the post-migration reality (`plethora.db` with legacy adoption).
5. **Skills update**: `.agents/skills/android-build` and `cut-release` SKILL.md files corrected to Plethora names/paths — they steer automation and currently point at `com.incrementum.app`.

## Risks / Trade-offs

- [Docs churn] → content-preserving edits only, verified by name-grep afterward.
- [Missed compat surface] → every change reviewed against BRANDING.md retained-legacy table before edit.

## Migration Plan

None; rollback = revert.

## Open Questions

None.
