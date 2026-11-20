## Why

Apple HealthKit (iOS) and Android Health Connect (Android) are the primary on-device wearable hubs covering Apple Watch, Pixel Watch, Galaxy Watch/Ring, RingConn, Garmin, Polar, Withings, Suunto, and Ultrahuman on mobile. Native Tauri mobile plugins must provide real Swift/Kotlin platform bridges, granular runtime permissions, incremental queries, historical window awareness, and strict non-mobile target gating without breaking desktop compilation or violating App Store / Google Play policies.

## What Changes

- Create in-repo Tauri iOS plugin `src-tauri/plugins/plethora-healthkit/` (Rust + Swift `HealthKitPlugin.swift`) supporting availability checks, granular read permissions, `HKAnchoredObjectQuery` incremental sync + deletions, iOS 16+ sleep stages with iOS 14–15 fallback, `HKObserverQuery` / background delivery, iOS `NSURLIsExcludedFromBackupKey = true` backup exclusion on `health/`, and typed `platform_unsupported` stubs off iOS.
- Create in-repo Tauri Android plugin `src-tauri/plugins/plethora-healthconnect/` (Rust + Kotlin `HealthConnectPlugin.kt`) using `androidx.health.connect:connect-client`, runtime granular permission requests, `READ_HEALTH_DATA_HISTORY` (30-day default awareness), `READ_HEALTH_DATA_IN_BACKGROUND`, `getChangesToken`/`getChanges` incremental upserts & deletions, permission rationale metadata, and typed `platform_unsupported` stubs off Android.
- Wire both plugins into `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, and Rust native sync adapters (`native_healthkit.rs`, `native_healthconnect.rs`).
- Extend `scripts/apply-ios-project-overrides.js` + `scripts/ios-overrides/privacy-manifest.json` (`NSHealthShareUsageDescription`) + `scripts/ios-overrides/healthkit.entitlements.json` (compliance-gated `enabled: false` by default).

## Capabilities

### New Capabilities

- `native-mobile-health-bridges`: Native iOS HealthKit (`plethora-healthkit`) and Android Health Connect (`plethora-healthconnect`) Tauri plugins, compliance-gated entitlements/purpose strings, incremental sync normalization, and non-mobile platform isolation.

### Modified Capabilities

None.

## Impact

- **Native Plugins:** `src-tauri/plugins/plethora-healthkit/` and `src-tauri/plugins/plethora-healthconnect/`.
- **Core App:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/src/health/native_{healthkit,healthconnect}.rs`.
- **iOS Overrides & Privacy Tests:** `scripts/ios-overrides/privacy-manifest.json`, `scripts/ios-overrides/healthkit.entitlements.json`, `scripts/apply-ios-project-overrides.js`, `src/lib/privacy/__tests__/iosPurposeStrings.test.ts`.
- **Android Integration:** Preserves all checks in `scripts/check-android-integration.mjs` (`MainActivity.kt` `PluginManager.onActivityCreate`).
