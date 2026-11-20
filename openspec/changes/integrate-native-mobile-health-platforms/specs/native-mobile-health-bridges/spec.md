## ADDED Requirements

### Requirement: Native mobile plugins are target-isolated and registered cleanly
The system SHALL register `plethora-healthkit` and `plethora-healthconnect` in `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, and `src-tauri/capabilities/default.json`, and SHALL return typed `platform_unsupported` errors on non-matching desktop or mobile platforms without invoking native health APIs.

#### Scenario: Desktop invokes native mobile health command
- **WHEN** `health_sync_native_healthkit` or `health_sync_native_healthconnect` runs on Linux, Windows, or macOS desktop
- **THEN** the command returns a structured `platform_unsupported` error without crashing or invoking mobile frameworks

### Requirement: iOS HealthKit plugin supports granular permissions, anchored sync, and iCloud exclusion
On iOS, `plethora-healthkit` SHALL check `HKHealthStore.isHealthDataAvailable()`, request per-category read authorization, execute `HKAnchoredObjectQuery` for incremental updates and deleted UUIDs, map iOS 16+ sleep stages (`asleepCore`, `asleepDeep`, `asleepREM`, `asleepUnspecified`, `awake`, `inBed`) without inferring stages on iOS 14–15, mark `<app_data_dir>/health` with `isExcludedFromBackup = true`, and respect HealthKit compliance feature gating.

#### Scenario: Denied HealthKit read permissions do not fail or crash
- **WHEN** a user denies sleep or HRV read access in the iOS HealthKit sheet
- **THEN** authorization completes without panic, empty results are handled gracefully, and the UI surfaces clear guidance explaining Apple Health read privacy behavior

#### Scenario: HealthKit entitlement remains compliance-gated until enabled
- **WHEN** `scripts/ios-overrides/healthkit.entitlements.json` has `enabled: false`
- **THEN** `scripts/apply-ios-project-overrides.js` leaves `com.apple.developer.healthkit` out of the app entitlements file while keeping `NSHealthShareUsageDescription` validated

### Requirement: Android Health Connect plugin handles 30-day history limits, partial grants, and change tokens
On Android, `plethora-healthconnect` SHALL detect SDK availability (`available`, `unavailable`, `provider_update_required`), launch the Health Connect permission contract via `@ActivityCallback`, surface `READ_HEALTH_DATA_HISTORY` and `READ_HEALTH_DATA_IN_BACKGROUND` status explicitly, normalize `SleepSessionRecord`, `HeartRateRecord`, `RestingHeartRateRecord`, and `HeartRateVariabilityRmssdRecord`, and handle expired `ChangesToken`s via bounded full-window fallback.

#### Scenario: Missing history permission limits import to 30 days with clear UX
- **WHEN** a user grants `READ_SLEEP` without granting `READ_HEALTH_DATA_HISTORY`
- **THEN** the connection records `historyLimitDays = 30` and reports the partial permission status accurately

#### Scenario: Expired Health Connect change token recovers cleanly
- **WHEN** `getChanges` reports `changesTokenExpired: true`
- **THEN** the Rust sync adapter resets the cursor, runs a bounded backfill read, and requests a fresh changes token
