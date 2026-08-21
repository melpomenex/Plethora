## Why

Plethora's iOS target is simulator-grade only. `src-tauri/gen/apple` does not exist in the repository, every iOS npm script targets the simulator (`tauri:ios:dev:sim`, `tauri:ios:build:sim`), and CI (`mobile-build.yml` → `ios-build`) degrades to a simulator build whenever signing secrets are absent. No signed device build, Release archive, archive validation, or TestFlight upload path exists or has ever been demonstrated. The OpenSpec change `prepare-plethora-for-apple-app-store-and-google-play-commercial-release` marks tasks 1.2 ("iOS ASC API-key CI signing") and 5.2 ("TestFlight upload dry runs") as `[x]`, but **no App Store Connect API-key integration, no store-upload tooling, and no TestFlight evidence exist anywhere in the repo** — those checkboxes are false and must be corrected.

There is also a confirmed launch-blocking native-plugin defect: on iOS, `src-tauri/plugins/plethora-folder-import/src/lib.rs:42` declares `tauri::ios_plugin_binding!(init_plugin_plethora_folder_import)` and registers it at line 119, but `ios/Sources/FolderImportPlugin.swift:155` exports `@_cdecl("init_plugin_incrementum_folder_import")`. Additionally `ios/Package.swift` names its package/target/product `incrementum-folder-import` while the actual crate name (Cargo.toml) is `plethora-folder-import`, so swift-rs will look for `libplethora-folder-import.a` while SwiftPM produces `libincrementum-folder-import.a`. The result is both a static-library link failure at build time and a plugin-registration failure even if linking were coerced. Stale "Incrementum" identifiers must be swept from all native Apple code.

## What Changes

- Generate and commit a policy for `src-tauri/gen/apple`: deterministic regeneration via `tauri ios init --ci` plus committed project modifications, mirroring the existing committed `gen/android` precedent.
- Fix the folder-import iOS plugin link-symbol/package-name mismatch (`init_plugin_incrementum_folder_import` → `init_plugin_plethora_folder_import`; SwiftPM package name → `plethora-folder-import`) and sweep remaining stale Incrementum identifiers from iOS-native code.
- Add real-device / Release build scripts (`aarch64-apple-ios`), an explicit store build profile, version/build-number automation, entitlements, Info.plist configuration, iOS icon asset catalog wiring, and launch assets.
- Extend CI with a signed Release archive → `xcodebuild -exportArchive` → validation → TestFlight upload pipeline using App Store Connect API keys, plus a documented local developer workflow.
- Exclude desktop-only sidecars/resources/updater behavior from the iOS bundle (already partially achieved via `tauri.ios.conf.json` emptying `externalBin`/`resources`) with compile-time and test-enforced guarantees.

## Capabilities

### New Capabilities

- `ios-release-pipeline`: Reproducible signing, archiving, validation, TestFlight distribution, build-profile enforcement, and iOS packaging invariants.

### Modified Capabilities

None.

## Impact

- `package.json` (new iOS scripts only — do not touch desktop/android scripts), `scripts/release.cjs` (build-number automation).
- `src-tauri/gen/apple/**` (new generated + committed Xcode project), `src-tauri/tauri.ios.conf.json`, `src-tauri/capabilities/*`.
- `src-tauri/plugins/plethora-folder-import/ios/**` (symbol/package rename).
- `.github/workflows/mobile-build.yml` (extend `ios-build`; do not restructure Android job).
- New docs under `docs/release/` (signing runbook, reproducible-build notes).

**Owns:** everything above.
**Must NOT change:** billing code (Proposal B), privacy manifest/purpose strings content (Proposal C — but A creates the empty Info.plist surface C fills), feature gating logic (Proposal D), share extension target (Proposal E coordinates via A's documented extension-target procedure), server code (Proposals B/F), QA evidence format (Proposal G consumes A's artifacts).

## Dependencies

- **Hard:** none. This is the foundation proposal; it can start immediately.
- **Soft consumers:** B needs the plugin scaffolding conventions this establishes (how to add an iOS Tauri plugin to `gen/apple`); E needs the documented procedure for adding an extension target to the generated project; C needs the Info.plist/archive path this produces; G needs the archive/upload artifacts.

## Parallelization Notes

A can start in Wave 1 concurrently with B/C/D/E provided others treat `gen/apple`, `tauri.ios.conf.json`, `mobile-build.yml`'s iOS job, and `package.json` iOS scripts as **A-owned files**. Where B/E must touch them, they land narrow, well-scoped diffs against interfaces A documents (see design.md §Ownership). Merge order for shared files: A's structural changes land first; downstream proposals rebase onto them.

## Migration / Backward Compatibility

No runtime data-model changes. Desktop and Android builds are untouched except that `release.cjs` gains an optional build-number step (no-op when Apple metadata is absent). `gen/apple` becomes tracked like `gen/android`; developers who previously relied on ephemeral init must pull and use the new scripts.

## Risks

- Signing requires real Apple Developer account assets (certificates, profiles, ASC API key) that live outside git; CI behavior without secrets must remain a clean, clearly-labeled simulator fallback, not a silent fake success.
- Generated Xcode projects churn; the commit-vs-regenerate policy must be decided once and documented to avoid perpetual binary diff noise.
- Rust crate compiles for iOS today per cfg audit, but a full Release device compile may still surface unanticipated link errors; time-box and record findings rather than expanding scope into unrelated fixes.
