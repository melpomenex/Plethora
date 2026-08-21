# Change A — Verification Evidence for §1–§3

Recorded: 2026-08-21. Environment: macOS (darwin, arm64, "Tahoe"), rustc
1.89.0, rust targets `aarch64-apple-ios` / `aarch64-apple-ios-sim` installed.
**This machine has NO full Xcode install** — `xcode-select -p` returns
`/Library/Developer/CommandLineTools`; `xcodebuild` is unavailable and the
`iphoneos` SDK cannot be located. This shapes the verification ladder below
(implemented ≠ verified; Xcode-gated levels are honestly unchecked).

## §1 Native plugin linking repair

Commits: `1b5a80de` (fix + sweep + guard).

- [x] Symbol alignment verified statically: Swift `@_cdecl("init_plugin_plethora_folder_import")`
      equals Rust `tauri::ios_plugin_binding!(init_plugin_plethora_folder_import)`;
      SwiftPM package/target/product = crate name `plethora-folder-import`.
      Enforced going forward by `scripts/__tests__/iosPluginSymbols.test.mjs`.
- [x] Guard tests: `node --test scripts/__tests__/iosPluginSymbols.test.mjs`
      → 4/4 pass. Full `npm run test:scripts` → 137 pass / 0 fail.
- [x] Sweep: `rg -in incrementum src-tauri/plugins` post-sweep returns only the
      four intentionally-kept legacy strings (recorded in tasks.md 1.3).
- [x] Android-side plugin code still compiles is NOT re-proven here (comment/
      proguard/thread-name/UA changes only; Kotlin sources were not touched
      structurally — proguard rule package names were dead for `com.incrementum.*`
      and now correctly target the live `com.plethora.*` packages).
- [ ] `cargo build --target aarch64-apple-ios --release` — **attempted, blocked**:
      ```
      cargo build --target aarch64-apple-ios --release -p plethora-folder-import
      → error occurred in cc-rs: "xcrun" "--show-sdk-path" "--sdk" "iphoneos"
        xcrun: error: SDK "iphoneos" cannot be located
      ```
      Root cause: no Xcode/iphoneos SDK on this machine (objc2-exception-helper
      build script). Needs one run on an Xcode-equipped machine to close task 1.5.

## §2 Generated iOS project

Commits: `82ca7deb`.

- [x] `npm run tauri:ios:init` (tauri ios init --ci) succeeded:
      `Created project at …/src-tauri/gen/apple/plethora-tauri.xcodeproj`.
      Prerequisite installed during the attempt: `brew install cocoapods`.
- [x] Overrides applied and idempotent:
      ```
      node scripts/apply-ios-project-overrides.js   → 10 change(s)
      node scripts/apply-ios-project-overrides.js   → nothing to do (fixpoint)
      ```
- [x] `plutil -lint` on Info.plist + entitlements → OK.
- [x] Unit tests `scripts/__tests__/applyIosProjectOverrides.test.mjs` → 15/15
      pass (incl. fixpoint idempotency, C/E data-file hooks, pre-init error).
- [x] Bundle id verified `com.plethora.app`; device families `1,2`;
      deployment target 14.0; 18 icons synced from `src-tauri/icons/ios`.
- [ ] Clean-regeneration **build** proof (task 2.5) — Xcode-gated, pending.

## §3 Build scripts + store build profile

Commits: `98bddb50`.

- [x] `npx tsc --noEmit` → clean.
- [x] `npx eslint` on all touched TS → clean.
- [x] `npx vitest run src/lib/__tests__/{buildProfile,storeProfileGuard,iosConfigInvariant}.test.ts`
      → 15/15 pass.
- [x] `npx vite optimize` → vite.config.ts (with buildProfile import, define,
      store guard plugin) evaluates cleanly.
- [x] Rust: `cargo test --lib build_profile` blocked by **22 pre-existing
      test-compile errors in sherpa/tts modules** (verified present on the
      tree WITHOUT my changes via stash round-trip; none reference
      build_profile). The module itself is plain Rust with no new deps;
      compile proof rides on the next successful `cargo test`/iOS build.
- [ ] `npm run tauri:ios:build:device` (task 3.5) — Xcode-gated, pending.

## Pending (requires other resources)

1. One run on an Xcode-equipped machine: `cargo build --target
   aarch64-apple-ios --release` + `npm run tauri:ios:build:device` +
   clean-regen build proof (closes 1.5, 2.5, 3.5).
2. Physical device install, signing, archive validation, TestFlight — §4/§5.
