## Tasks

- [x] B-T01 Scaffold and implement `src-tauri/plugins/plethora-healthkit/` (Cargo.toml, build.rs, permissions, Rust commands/desktop stubs, `ios/Package.swift`, `ios/Sources/HealthKitPlugin.swift`)
- [x] B-T02 Scaffold and implement `src-tauri/plugins/plethora-healthconnect/` (Cargo.toml, build.rs, permissions, Rust commands/desktop stubs, `android/build.gradle.kts`, `AndroidManifest.xml`, `HealthConnectPlugin.kt`)
- [x] B-T03 Wire `plethora-healthkit` and `plethora-healthconnect` into `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, and `src-tauri/capabilities/default.json`
- [x] B-T04 Update `scripts/ios-overrides/privacy-manifest.json`, add `scripts/ios-overrides/healthkit.entitlements.json` (gated `enabled: false`), extend `scripts/apply-ios-project-overrides.js` + tests, and update `src/lib/privacy/__tests__/iosPurposeStrings.test.ts`
- [x] B-T05 Implement `src-tauri/src/health/native_healthkit.rs` and `native_healthconnect.rs` normalization, anchored/token cursor state, deletion propagation, and Rust fixture contract tests
- [x] B-T06 Verify `cargo check`, `cargo test` for native adapters, `node scripts/check-android-integration.mjs`, `node --test` on iOS override tests, and Gradle/Kotlin compilation check if locally available
