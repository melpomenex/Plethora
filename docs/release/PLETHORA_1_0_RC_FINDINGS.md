# Plethora 1.0 Release Candidate — Findings

Audit date: 2026-08-17 · Scope: repository state after the Plethora 1.0 initiative
(scheduler product names, brand consolidation finish, RSS semantic preference
learning, companion, launch hardening).

Severity: **P0** launch-blocking / data loss / security · **P1** major workflow
broken · **P2** polish · **P3** post-launch.

## Gate results (RC definition)

| Gate | Result |
|---|---|
| `npm run test:run` (frontend unit/UI) | ✅ 3628 passed, 1 skipped, 0 failed |
| `cargo test --lib` (Rust) | ✅ 884 passed, 0 failed |
| `npm run bench:check` (perf + bundle budgets) | ✅ PASS — 21 benchmarks, entry 2646 KB, total 22.2 MB |
| `npm run test:scripts` | ✅ 109 passed |
| `npm run test:browser-extension` | ✅ 19 passed |
| i18n completeness (6 locales) | ✅ 16 tests passed |

Caveats recorded:
- **F-01 (P3)** `database::connection::tests::resolve_adopts_legacy_db_file_set_and_reopens_new_name`
  is flaky under full-parallel execution (passes standalone and on suite rerun).
  Pre-existing; likely temp-dir/journal contention between connection tests.
  Disposition: deferred; a follow-up should serialize the connection-test
  module or give each test an isolated temp root.
- **F-02 (P3)** `bench:check` must not run concurrently with other heavy jobs —
  a parallel full-test run inflated 4 anchor-normalized costs beyond tolerance;
  a standalone rerun passed all 21. Disposition: run gates sequentially in CI
  (CI already does). One stale-baseline warning (`tabs-dom/mount-12-tab-workspace`
  measured 0.57× baseline — it got faster); re-record opportunistically.

## Findings from this audit

### Fixed during the initiative (evidence in git history)

- **F-10 (fixed)** User-facing Incrementum branding leftovers: Linux window
  title, About heading, PWA install banner, OPML export title, AI memory
  heading, MCP server/client/tool identity, Obsidian `source:` frontmatter,
  TTS spoken sentences, NotebookLM copy, mnemosyne export filename, article
  capture window title, podcast user agents. Guard widened in
  `src/__tests__/brandInventory.test.ts`.
- **F-11 (fixed)** Rename-induced breakage: `examples/figdiag.rs` crate
  imports, screenshot window-title match, hardcoded `incrementum.db` backup
  paths (now `DB_FILE_NAME`), stale `incrementum.exe`/`incrementum-tauri`
  artifact names in CI/cross-build scripts/AppRun, stale Android gitignore
  rule.
- **F-12 (fixed)** Legacy third-party scheduler names removed from all
  user-facing surfaces (Classic/Adaptive/Precision; FSRS-6 unchanged; arena
  baselines → "Classic 15/19"). Persisted ids, enum variants, and commands
  migrated to canonical Plethora identity; enforced by
  `src/__tests__/schedulerNaming.test.ts`.
- **F-13 (fixed)** RSS thumbs-up/down now train semantic preferences: article
  feedback table + decayed clusters, hybrid ranking with cold-start passthrough
  and exploration, undo rebuilds, explainability via exemplar tooltip.
  Behavioral tests cover rise/fall/transfer/decay.
- **F-14 (fixed)** Companion shipped off-by-default, lazy-loaded, e-ink hidden,
  reduced-motion static, anti-spam policy with session budget.

### Verified by code-level audit (no action)

- **F-20** Account deletion: `DELETE /v1/account` exists (server auth routes)
  with full cloud-data deletion messaging; login rejects `deleted` status.
- **F-21** Local-only egress guards: `isCloudEligible` gates RAG and document
  reconstruction cloud paths; `src/__tests__/privacyCompleteness.test.ts`
  enforces coverage of cloud call sites.
- **F-22** No test Stripe IDs, no hardcoded provider API keys in app code.
  `whsec_` occurrence is the server's runtime webhook-secret generator.
- **F-23** No dev endpoints in release paths: only intentional localhost
  references are the local browser-extension sync server (user-facing,
  port-configurable) and its localized help copy.
- **F-24** Entitlements resolve local override → cached snapshot (15 min TTL,
  72 h grace) → free defaults; frontend Pro state cannot bypass server
  entitlements for cloud jobs.
- **F-25** Export: app-state export/import round-trips with legacy
  `.incrementum` extension dual-read (compat window).

### Post-RC follow-ups (user-reported, fixed in this pass)

- **F-15 (fixed)** Full third-party word scrub: zero occurrences remain in any
  user-facing surface. Handbooks (6 languages) rewritten cleanly; formulation
  rules neutralized; AI prompt, dialog names, and console copy neutralized.
  `schedulerNaming` guard enforces clean branding across all components.
- **F-16 (fixed)** Dev-mode window icon on Linux/Windows showed the generic
  cog: unbundled runs never set a window icon (bundled installs get theirs
  from .desktop/hicolor/.ico resources). New `apply_window_icons()` sets the
  embedded 512px mascot PNG on every webview window at startup on
  Linux/Windows (mirrors the existing macOS unbundled-dock-icon fix);
  `icons/icon.png` added to `bundle.icon` so bundlers pick the hi-res source.
  Validated: all bundle PNGs correct sizes; icon.ico has 6 valid 16–256px
  32bpp entries (Windows resource embed is handled by tauri-build from this
  file); PKGBUILD already installs 32/128/512 hicolor icons.
  **Caveat:** on Wayland, taskbar icons are derived from the desktop entry
  (app_id), not settable by clients — installed packages get the right icon
  via their .desktop file, but `tauri dev` under Wayland will still show a
  generic taskbar entry (the window icon fix applies to X11 and Windows).
  Running dev with `QT_QPA_PLATFORM=xcb` / X11 session shows the mascot.

### Open / deferred

- **F-30 (P2)** 55 TODO/FIXME comments remain in app code, concentrated in
  reading-goal services (23), cloud_sync (5), semantic_search (4). None are
  user-visible strings or known defects. Disposition: triage post-RC.
- **F-31 (P2)** Green theme colors (`#6daa2c`) remain flagged Phase-B-pending
  in BRANDING.md (design decision D11). Disposition: design call before
  store screenshots.
- **F-32 (P2)** The `rss/` Rust directory (`src-tauri/src/rss/*`) is an
  uncompiled parallel implementation superseded by `commands/rss_features.rs`.
  Disposition: delete or archive in a cleanup change (confusion hazard for
  contributors); not release-reachable.
- **F-33 (P3)** Runtime device-matrix verification (TestFlight/Play beta,
  sync conflict matrix, store purchase flows on real devices) requires the
  human/testing track — see the human launch checklist. Code paths are
  covered by the suites above; this is not automatable in-repo.

## RC sign-off

All gates green; no open P0/P1. Remaining P2/P3 items are recorded above with
dispositions. RC is **declared complete from the repository side**, pending
the external/human items in `PLETHORA_1_0_HUMAN_LAUNCH_CHECKLIST.md`.
