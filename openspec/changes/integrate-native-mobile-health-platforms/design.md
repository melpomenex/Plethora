## Context

In-repo mobile plugins follow `src-tauri/plugins/plethora-storekit/` (iOS Swift + `ios_plugin_binding!`) and `src-tauri/plugins/plethora-playbilling/` + `plethora-folder-import/` (Android Kotlin `@TauriPlugin` + `@ActivityCallback`). `scripts/apply-ios-project-overrides.js` forbids hand-editing `src-tauri/gen/apple/project.pbxproj`.

## Goals / Non-Goals

- **Goals:**
  - Real Swift HealthKit & Kotlin Health Connect implementations compiling cleanly within Plethora's Tauri 2 plugin architecture.
  - Safe no-op / `platform_unsupported` behavior on desktop Linux/Windows/macOS so desktop builds never call mobile health APIs.
  - Explicit compliance gating for HealthKit entitlements until external App Review & provisioning profile approval.
- **Non-Goals:**
  - Silently mirroring HealthKit records into iCloud or Plethora Cloud servers.
  - Polling HealthKit/Health Connect in tight timers draining mobile battery.

## Decisions

### Separate Rust Normalization + Native Sync Drivers
Swift/Kotlin plugins serialize raw native records (`uuid`, `sourceRevision`, `device`, stage constants, zone offsets, anchor/changes tokens) across Tauri IPC to Rust `native_healthkit.rs` and `native_healthconnect.rs`, keeping normalization, quality validation, and deduplication testable via Rust contract tests on any OS.

### Compliance-Gated HealthKit Entitlement
`scripts/ios-overrides/healthkit.entitlements.json` sets `enabled: false` with documented Apple Guideline 5.1.3 rationale. `apply-ios-project-overrides.js` injects `com.apple.developer.healthkit` only when `enabled === true`, preventing unprovisioned Xcode signing failures while keeping `NSHealthShareUsageDescription` tested.

## Risks / Trade-offs

- **No Apple/NDK toolchain on Linux CI host** → Rust crate compilation, Rust contract tests with HealthKit/Health Connect fixtures, iOS override tests, and Android manifest/Kotlin inspection run locally; physical iPhone/Android runtime execution is recorded as awaiting hardware/toolchain verification.
