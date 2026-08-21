## Context

Verified current state (2026-08 audit):

- `src-tauri/gen/` contains only `android/` and `schemas/`. **No iOS project exists.** CI runs `tauri ios init --ci` ephemerally when missing; the result is never committed or archived as a coherent unit.
- `src-tauri/tauri.conf.json`: identifier `com.plethora.app`, version `2.7.0`, desktop updater plugin active, sidecars (`bin/whisper`, `bin/sherpa-onnx`, `bin/pocket-tts`, `bin/notebooklm`) + resources (`scripts/anna_download.py`, `bin/notebooklm-runtime`). `src-tauri/tauri.ios.conf.json` is exactly `{"bundle":{"externalBin":[],"resources":[]}}` — it correctly empties sidecars/resources for iOS but nothing else is configured (no icons block, no signing, no Info.plist keys).
- `package.json`: `tauri:ios:init`, `tauri:ios:dev:sim` (`--target aarch64-sim`), `tauri:ios:build:sim`. No device/Release scripts.
- Rust: the main crate is deliberately iOS-compilable — `#[cfg_attr(mobile, tauri::mobile_entry_point)]` at `lib.rs:671`; updater/process plugins gated `not(any(ios, android))` (~line 871); localhost (~886), window-state (~905), tray (`cfg(desktop)`), screenshot module all excluded on mobile; desktop-only deps (`battery`, `xcap`, `localhost`, `window-state`) under `cfg(not(any(android, ios)))`. ~51 cfg gates total.
- Plugins registered unconditionally in `lib.rs`: log, shell, dialog, deep-link, fs, opener, os, folder-import, android-tts, android-genai, notification.
- **Confirmed defect:** `plugins/plethora-folder-import/src/lib.rs:42` `tauri::ios_plugin_binding!(init_plugin_plethora_folder_import)` vs `plugins/plethora-folder-import/ios/Sources/FolderImportPlugin.swift:155` `@_cdecl("init_plugin_incrementum_folder_import")`. Also `ios/Package.swift` package/target/product name is `incrementum-folder-import` while Cargo.toml crate name is `plethora-folder-import` (`links = "plethora-folder-import"`). Both the comment blocks claiming "the crate name is incrementum-folder-import" are stale and wrong.
- Icons: full iOS PNG set exists at `src-tauri/icons/ios/AppIcon-*.png` (loose files; no `.appiconset/Contents.json` until `tauri ios init` scaffolds one).
- Versioning: `scripts/release.cjs` bumps package.json / tauri.conf.json / Cargo.toml(+lock) in lockstep at 2.7.0. Android gets `versionCode=2007000` via tauri-generated `gen/android/app/tauri.properties` (major×1,000,000 + minor×1,000 + patch). No equivalent iOS handling exists.
- CI: `.github/workflows/mobile-build.yml` has an `ios-build` "iOS build validation" job (macos-latest): installs rust targets, ephemeral `ios init`, imports p12/profile from secrets `IOS_CERT_BASE64/PASSWORD/PROFILE_BASE64/SIGNING_IDENTITY/TEAM_ID` (documented in workflow comments only), falls back to simulator build without them, uploads artifacts, attaches `.ipa` to tag releases only in signed mode. There is no archive-validation step and no TestFlight upload anywhere. Android precedent: keystore resolution chain (gitignored `keystore.properties` → env vars → debug fallback) in `gen/android/app/build.gradle.kts`; `keystore.properties.example` committed.
- Stale docs: `prepare-plethora-for-apple-app-store-and-google-play-commercial-release/tasks.md` marks ASC API-key CI signing (1.2) and TestFlight dry runs (5.2) `[x]` with zero supporting artifacts. `docs/release/PLETHORA_1_0_HUMAN_LAUNCH_CHECKLIST.md` honestly leaves Apple enrollment/D-U-N-S/product creation unchecked.

## Goals / Non-Goals

**Goals:**

- A developer can run one command to produce a signed Release `.xcarchive` for a physical iPhone/iPad from a clean checkout plus local secrets.
- CI produces the same archive from secrets, validates it, and uploads to TestFlight using an App Store Connect API key.
- The folder-import plugin links and registers on iOS.
- A store build profile exists such that store builds structurally cannot include updater/self-update behavior, devtools defaults, mock billing activation hooks, test endpoints, or desktop-only binaries.
- Build/version numbers are reproducible and automated.

**Non-Goals:**

- Implementing StoreKit (Proposal B) — this proposal provides only the plugin-registration scaffolding conventions B uses.
- Privacy manifest content or purpose strings (Proposal C owns; A exposes the Info.plist surface).
- Share Extension target creation (Proposal E owns; A documents the extension-target procedure).
- Feature gating decisions (Proposal D).
- QA evidence schema (Proposal G).
- Fixing unrelated Android issues (except where an Incrementum-rename sweep overlaps shared native files).

## Decisions

### 1. Commit `gen/apple`, regenerate deterministically
Mirror the `gen/android` policy: run `tauri ios init --ci` once, apply all modifications as reviewed diffs (Info.plist additions, entitlements, project settings via a documented script), commit everything except gitignored build outputs. Rationale: hand-edits to generated projects must be reviewable and re-appliable after regeneration. An idempotent `scripts/apply-ios-project-overrides.*` script re-applies overrides post-init so regeneration never silently loses configuration.

### 2. Store build profile via build-time environment
Introduce a single source of truth: `PLETHORA_BUILD_PROFILE ∈ {development, sideload, store}` injected through Vite `define` (`__PLETHORA_BUILD_PROFILE__`) and Tauri cfg (via a cargo feature or env-driven codegen where needed). Default `development`. `store` profile MUST hard-fail the build if any of: updater plugin enabled, mock-billing fallback active, dev server URLs present, desktop external bins referenced. Proposal D consumes the frontend constant for capability gating; Proposal B consumes it for the billing-backend assertion; both import the same helper from a shared module created here (`src/lib/buildProfile.ts`).

### 3. Fix the plugin mismatch at the source of truth
Rename the Swift exports to match the Rust expectations (crate name is already correct): `Package.swift` name/target/product → `plethora-folder-import`; `@_cdecl("init_plugin_plethora_folder_import")`. Update the two stale comment blocks that claim the crate is named `incrementum-folder-import`. Sweep remaining `Incrementum` occurrences in `plugins/*/ios/**` and `plugins/*/android/**` identifiers/comments (event-name `'incrementum-native-share'` fix itself belongs to Proposal E since it is share-pipeline semantics; note it explicitly to avoid double-fixing).

### 4. Signing model mirrors the Android precedent
Local: gitignored `src-tauri/gen/apple/secrets/` (exportOptions plist, certificate references) with a committed `.example`. CI: existing p12/profile secrets remain the manual-signing path; add optional ASC API-key secrets (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PDF_BASE64`) enabling `xcrun altool`/`notarytool`-style upload of the exported `.ipa` to TestFlight (`xcrun altool --upload-app` or `xcrun iTMSTransporter` successor per Apple's tooling at implementation time). Without secrets: simulator build only, job annotated clearly, artifact named `-unsigned-sim`.

### 5. Archive pipeline
`npm run tauri ios build` (device target, release) → `xcodebuild archive` produced by the Tauri CLI → export `.ipa` via `xcodebuild -exportArchive` with the exportOptions plist → `xcrun altool --validate-app` → upload. Every step emits a machine-readable log under a new `evidence/` directory convention (schema owned by Proposal G; A only writes raw logs there).

### 6. Version/build numbers
Extend `scripts/release.cjs`: after bumping versions, compute `CFBundleShortVersionString` = marketing version and `CURRENT_PROJECT_VERSION` = monotonic build number (timestamp- or counter-based; scheme documented). Write into the override script's output so regenerated projects stay consistent. Do not hand-edit xcodeproj XML outside the override script.

## Platform Boundaries

- iOS bundle: no sidecars, no updater, no tray/screenshot/localhost/window-state (already cfg-gated — add tests asserting this stays true).
- Desktop/Android: untouched behavior; Android keeps its own signing chain.
- Shared files (`Cargo.toml`, `lib.rs`): A only touches them if a device compile proves a gating defect; changes limited to cfg attributes, with rationale recorded.

## Failure Behavior

- Missing secrets locally → command fails early with actionable message listing exactly which secret/file is absent (no half-signed output).
- CI without secrets → simulator-mode success is allowed ONLY on non-release refs; tag builds REQUIRE signed mode and fail otherwise.
- Archive validation failure → upload step skipped, logs retained, job red.

## Testing Strategy

- Unit: `release.cjs` version math; build-profile helper (default value, invalid values rejected).
- Integration/invariant: a test asserting `tauri.ios.conf.json` empties `externalBin`/`resources`; a grep-style test asserting no `incrementum` link symbols remain in plugin iOS sources; a config test asserting updater is not registered when building under the store profile.
- Verification ladder (per repo standard: implemented ≠ verified): compile for `aarch64-apple-ios` → install on physical iPhone → signed Release archive → `altool` validation passes → TestFlight build appears. Each level recorded as evidence (format owned by G).

## Rollout

Land in order: (1) plugin symbol fix + compile proof, (2) gen/apple generation + overrides script + scripts, (3) signing + local workflow docs, (4) CI extension, (5) release.cjs build numbers. Each step independently revertable.

## Alternatives Considered

- **Fastlane** for signing/upload: rejected for now — repo has zero fastlane presence; plain `xcodebuild`/`altool` keeps the toolchain surface minimal. Revisit if match/cert management becomes painful.
- **Not committing gen/apple** (ephemeral init like today): rejected — unreviewable, non-reproducible, and incompatible with extension targets (E) and entitlements (C).
- **Sponsoring a third-party signing service**: rejected; secrets protocol already exists.

## Rejected Alternatives / Notes

- Renaming the Rust binding macro instead of the Swift symbol: rejected — the macro name derives from the crate/plugin naming convention established across all three plugins; aligning Swift to Rust is the smaller, more consistent diff.

## Ownership & Collision Boundaries

| File/area | Owner | Others |
|---|---|---|
| `src-tauri/gen/apple/**` | **A** | E adds extension target via documented procedure; C adds entitlement/plist entries via override script inputs |
| `src-tauri/tauri.ios.conf.json` | **A** | C may append privacy-manifest resource reference (coordinate) |
| `package.json` iOS scripts | **A** | none |
| `.github/workflows/mobile-build.yml` iOS job | **A** | G consumes outputs; E adds extension build steps via contract below |
| `scripts/release.cjs` | **A** | H/G read-only consumers |
| `src/lib/buildProfile.ts` | **A creates**, B/D consume read-only | — |
| `plugins/*/ios/**` symbol renames | **A** | E owns new share-extension Swift separately |

**Contract for E (Share Extension):** E does not edit `mobile-build.yml` directly; A pre-adds an extension-target hook (documented placeholder in the overrides script) that E fills. If E lands first, its changes are confined to a standalone spec file consumed by the overrides script.
**Contract for C:** C supplies `PrivacyInfo.xcprivacy` file path + purpose-string key/value list as data; A's override script injects them. Until C lands, A ships accurate placeholders marked TODO-C.
