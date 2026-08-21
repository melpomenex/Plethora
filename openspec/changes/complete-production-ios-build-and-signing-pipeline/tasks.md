## 1. Native Plugin Linking Repair (launch-blocking)

- [x] 1.1 In `src-tauri/plugins/plethora-folder-import/ios/Package.swift`, rename package, product, and target from `incrementum-folder-import` to `plethora-folder-import` (matching Cargo.toml crate name and `links` key); update the stale comment block that misstates the crate name.
- [x] 1.2 In `src-tauri/plugins/plethora-folder-import/ios/Sources/FolderImportPlugin.swift`, change `@_cdecl("init_plugin_incrementum_folder_import")` to `@_cdecl("init_plugin_plethora_folder_import")` matching `tauri::ios_plugin_binding!` in `src/lib.rs:42`; update the stale copyright/identifier comments.
- [x] 1.3 Sweep `src-tauri/plugins/**/ios/**` and `src-tauri/plugins/**/android/**` for remaining `incrementum` identifiers, symbols, and comments; rename all that participate in linking/registration or user-visible strings. Record any intentionally-kept legacy strings (e.g. the Android `'incrementum-native-share'` event — owned by Proposal E, do not change here).
  - Intentionally kept: Android `'incrementum-native-share'` window event (FolderImportPlugin.kt:243 — Proposal E owns share semantics); legacy `incrementum.db` fallback filename + its comment (data-migration lookup, renaming breaks migration); `/sdcard/Download/Incrementum/Incrementum_Backup_Auto.db` legacy backup path (same migration rationale); android-tts consumer-rules.pro historical rebrand note (accurate history, no linking role).
- [x] 1.4 Add an automated guard (test or CI grep step) that fails if `incrementum` appears in any iOS link-symbol (`@_cdecl`), SwiftPM package name, or `ios_plugin_binding!` macro across plugins.
  - Implemented as `scripts/__tests__/iosPluginSymbols.test.mjs` (runs via `npm run test:scripts`), including an exact-match test that Swift `@_cdecl` exports equal Rust `ios_plugin_binding!` names.
- [ ] 1.5 **Verification:** `cargo build --target aarch64-apple-ios --release` (or via tauri CLI) succeeds with the folder-import plugin linked; record the command output as evidence.
  - **Blocked in this environment:** no full Xcode install (`xcode-select -p` → Command Line Tools only; `xcrun --show-sdk-path --sdk iphoneos` fails), so the objc2-exception-helper cc build cannot find the iphoneos SDK. Command attempted; output recorded in `evidence/a-tasks-1-3.md`. Requires a machine with Xcode + iOS platform.

## 2. Generated iOS Project and Configuration

- [x] 2.1 Run `tauri ios init --ci` to generate `src-tauri/gen/apple`; decide and document the commit-vs-regenerate policy (follow the `gen/android` precedent: commit sources, ignore build outputs) in `.gitignore` and `docs/release/`.
  - Policy documented in `docs/release/ios-generated-project.md`. Note: init required installing cocoapods (brew) on this machine.
- [x] 2.2 Create `scripts/apply-ios-project-overrides.(js|ts)` — idempotent post-init script that applies: display name, bundle identifier `com.plethora.app`, deployment target, iPhone/iPad device families, icon asset catalog wiring from `src-tauri/icons/ios/`, and placeholder Info.plist keys. All future xcodeproj edits MUST flow through this script.
  - `scripts/apply-ios-project-overrides.js`; fixpoint idempotency proven by double-run and unit tests. Includes data-file hooks for Proposal C (`scripts/ios-overrides/privacy-manifest.json`) and Proposal E (`scripts/ios-overrides/share-extension.target.json`) with TODO-C/TODO-E placeholders when absent.
- [x] 2.3 Configure `src-tauri/tauri.ios.conf.json`: keep sidecars/resources empty; add any iOS-specific bundle settings needed (icons if supported by config schema, minimum system version).
  - Added `bundle.iOS.minimumSystemVersion: "14.0"`; icons ship via the committed asset catalog (synced from `src-tauri/icons/ios` by the overrides script).
- [x] 2.4 Define entitlements file(s) (start minimal: no unneeded capabilities; App Group placeholder arrives with Proposal E/C coordination) and wire them via the overrides script.
  - Generated `plethora-tauri_iOS.entitlements` kept minimal (empty dict + TODO-E marker); App Group injection implemented behind E's data file.
- [ ] 2.5 **Verification:** clean regeneration (`rm -rf gen/apple && tauri ios init --ci && node scripts/apply-ios-project-overrides.*`) reproduces a project that builds; record diff-empty proof as evidence.
  - Generation + overrides re-run verified once (idempotent, plutil-lint clean); the *build* half requires Xcode (see 1.5 blocker). Re-verify on an Xcode-equipped machine.

## 3. Build Scripts and Store Build Profile

- [x] 3.1 Add npm scripts: `tauri:ios:dev:device`, `tauri:ios:build:device` (`--target aarch64-apple-ios`), `tauri:ios:archive`, `tauri:ios:export`, `tauri:ios:validate`, `tauri:ios:upload`. Leave existing sim scripts untouched.
  - archive/export/validate/upload are thin xcodebuild/altool wrappers; §4 refines signing semantics (exportOptions plist template, ASC key handling).
- [x] 3.2 Create `src/lib/buildProfile.ts` exporting `__PLETHORA_BUILD_PROFILE__` (`development | sideload | store`, default `development`) wired through Vite `define` and documented. This module is the single source consumed by Proposals B and D — coordinate the exact export signature with their specs before merging.
  - Landed exactly per the agreed cross-agent contract signature.
- [x] 3.3 Add build-time enforcement: store-profile frontend build fails if updater UI code paths are reachable or dev/test endpoints are referenced; Rust side gains a cfg/env check that refuses store-profile iOS builds with the updater plugin registered. Add tests for each invariant.
  - Dev/test-endpoint enforcement: `src/lib/storeProfileGuard.ts` + vite writeBundle hook (store builds hard-fail on loopback endpoints). Updater-plugin refusal: `build_profile::assert_no_updater_in_store_build` (+ tests); updater UI-path reachability enforcement lands with Proposal D's gating consuming `BUILD_PROFILE`.
- [x] 3.4 Add an invariant test asserting `tauri.ios.conf.json` keeps `bundle.externalBin` and `bundle.resources` empty (desktop sidecars never leak into iOS).
  - `src/lib/__tests__/iosConfigInvariant.test.ts`.
- [ ] 3.5 **Verification:** `npm run tauri:ios:build:device` compiles the full app for a real device target; record target, command, and outcome.
  - **Blocked:** requires Xcode's iphoneos SDK (see 1.5).

## 4. Signing, Archive, Validation, Upload

- [ ] 4.1 Define the local signing protocol: gitignored `src-tauri/gen/apple/secrets/` (exportOptions plist template committed as `.example`), documented in `docs/release/ios-signing.md` (mirrors Android's `keystore.properties.example` pattern).
- [ ] 4.2 Implement `tauri:ios:archive` → `.xcarchive`, `tauri:ios:export` → `.ipa` via `xcodebuild -exportArchive`, `tauri:ios:validate` via `xcrun altool --validate-app`.
- [ ] 4.3 Implement `tauri:ios:upload` to TestFlight using App Store Connect API key auth (secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PDF_BASE64`), using Apple's current recommended CLI at implementation time.
- [ ] 4.4 Version/build-number automation: extend `scripts/release.cjs` to write marketing version + monotonic `CURRENT_PROJECT_VERSION` via the overrides script; document the scheme; add a unit test for the version math.
- [ ] 4.5 **Verification (each level recorded as evidence):** (a) app installs and launches on a physical iPhone; (b) on a physical iPad; (c) Release archive validates with `altool`; (d) TestFlight upload succeeds and the build processes; (e) the TestFlight build installs on a clean device.

## 5. CI Pipeline

- [ ] 5.1 Extend the `ios-build` job in `.github/workflows/mobile-build.yml`: signed archive + export + validate when secrets present; keep the simulator fallback for non-release refs only; tag builds MUST fail if signing is unavailable.
- [ ] 5.2 Add a TestFlight upload step gated on ASC API-key secrets and release tags/dispatch inputs; upload only after successful validation.
- [ ] 5.3 Upload archive/ipa/validation logs as workflow artifacts using the naming convention Proposal G defines (coordinate the artifact names before merging; G owns the evidence schema).
- [ ] 5.4 Document all iOS CI secrets in the workflow comment block and `docs/release/ios-signing.md`; no secret values in repo.
- [ ] 5.5 **Verification:** one green CI run producing a signed artifact, and one TestFlight upload from CI, recorded with run IDs.

## 6. Production Environment Hygiene

- [ ] 6.1 Audit iOS runtime configuration for dev-only values (localhost URLs, test API endpoints, devtools flags); ensure store-profile builds point at production endpoints via the build profile; add a test scanning the iOS bundle config for forbidden hosts.
- [ ] 6.2 Verify desktop-only commands (`install_apk`, `capture_rendered_dom`, updater commands) are unreachable or clearly error on iOS; coordinate exact UX wording with Proposal D (D owns user-facing copy; A only guarantees the native layer errors safely).
- [ ] 6.3 **Documentation correction:** in `openspec/changes/prepare-plethora-for-apple-app-store-and-google-play-commercial-release/tasks.md`, annotate tasks 1.2 and 5.2 as stale (claimed `[x]` without evidence) and point to this change as the replacement implementation. Do not rewrite other history.

## 7. Reproducible Build Documentation

- [ ] 7.1 Write `docs/release/ios-reproducible-build.md`: clean-checkout → signed TestFlight build, every command, every secret name, every manual Apple-side prerequisite (certs, profiles, ASC key), and the evidence-recording expectation.
- [ ] 7.2 Record the verification ladder status (implemented / automated tests pass / simulator verified / physical-device verified / TestFlight verified / ASC validation passed) for this proposal's deliverables in the evidence location Proposal G defines.
