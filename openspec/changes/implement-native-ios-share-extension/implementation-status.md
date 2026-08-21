# Implementation status — implement-native-ios-share-extension

Landed on `main` (2026-08-21), commits in landing order:

| Commit | Scope |
|---|---|
| `de519d5e` | §1 — Android event-name fix, cold-start `get_pending_shares` drain, warm-start regression tests, eink change annotations |
| `26829f80` | §2 — staged-manifest contract types + mapping, additive `shareProvenance` metadata |
| `4decefe0` | §3 — Rust iOS staged-share reader (claim/reclaim/retry), ack/retry commands, frontend consumption + pending-shares notice, dedupe integration test |
| (this commit) | §4 — extension Swift sources + target-definition data file + applied gen/apple outputs |

## Implemented vs verified

**Verified (tests green):** Android event fix and cold-start drain
(vitest: 21 tests incl. the previously-dropped warm-start file/text case),
manifest↔batch mapping, provenance mapping, Rust claim/exactly-once/retry
logic (`cargo test -p plethora-folder-import`: 13 tests), re-share dedupe
integration through the real documentStore dedupe machinery,
A's overrides contract tests (`applyIosProjectOverrides`, `iosPluginSymbols`).

**Implemented but NOT compiled/verified here:**

1. Extension Swift sources (`src-tauri/share-extension/Sources/`) — no
   Xcode/iOS SDK on this machine. First xcodegen + build pass must verify:
   `@objc(PlethoraShareViewController)` principal-class linkage,
   `UTType`/`loadFileRepresentation` usage, Swift concurrency annotations.
2. `cargo check --target aarch64-apple-ios -p plethora-folder-import` —
   fails on THIS machine for every crate (no iphoneos SDK via xcrun), so the
   objc2-foundation App Group resolution code is source-verified against the
   locked objc2-foundation 0.3.2 API but not compiler-verified.

**Blocked / left unchecked:** §4.4 archive-pipeline build, §5.1 simulator
flows, §5.2 physical-device flows, §5.4 performance check. Physical evidence
runs belong to G per the parallelization plan.

## Deviations from the original plan

- Bundle id suffix: tasks said `com.plethora.app.ShareExtension`; A's hook
  derives bundle id from `bundleIdSuffix`, so the data file sets
  `bundleIdSuffix: "ShareExtension"` producing exactly that id.
- Target name is `"Plethora"` (not `plethora-share-extension` as sketched in
  A's script comment) because the stanza hardcodes
  `CFBundleDisplayName = targetName`, and the spec requires the share sheet to
  display "Plethora".
- §2.2 provenance application covers text-note documents; URL/file imports
  need a documentStore metadata hook (store internals not owned by E).
- gen/apple applied outputs committed here are limited to E-scoped files
  (project.yml stanza, Plethora/ scaffold, main-target entitlements). The
  same script run also produced C-scoped changes (purpose strings,
  PrivacyInfo.xcprivacy copy) which were restored — C/A should land those via
  their own run.

## Notes for other agents

- **A:** first xcodegen regeneration will pick up
  `scripts/ios-overrides/share-extension.target.json` automatically; the
  `sourceFiles` path resolves outside `gen/apple`
  (`../../../src-tauri/share-extension/Sources`). Please include the extension
  scheme/target in CI archive naming with G (§4.4). An Xcode-equipped run of
  `cargo check --target aarch64-apple-ios -p plethora-folder-import` would
  close the last compile-verification gap.
- **C:** shared App Group container `group.com.plethora.app` should appear in
  privacy documentation/purpose strings.
- **D:** capability id `ios-share-extension` slot registration (per collision
  map D registers capability ids); frontend surfaces needing gating are the
  share-target startup drain (`useShareTarget`) and the pending-shares notice.
- **G:** verification scenarios map to §5.1–5.3 above.
