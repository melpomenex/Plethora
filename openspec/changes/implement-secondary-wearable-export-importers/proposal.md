## Why

Secondary wearable ecosystems (Samsung Health, Withings, Polar, Suunto, Ultrahuman, RingConn, and Android Health Connect backups) have widely varying consumer export capabilities. Some (Samsung Health, Withings, RingConn) provide structured CSV archives; Polar excludes sleep timelines from account exports while including `nightly_recovery_*.json`; Suunto and Ultrahuman lack self-serve consumer sleep exports; and Android Health Connect backups use an internal OS-version-specific SQLite database. Plethora needs native adapters where verified formats exist and truthful, non-misleading guidance where they do not.

## What Changes

- Implement native adapters for verified secondary consumer exports:
  - `samsung_health.rs`: Parses Samsung Health ZIP/CSV (`com.samsung.health.sleep*.csv` + `com.samsung.health.sleep_stage*.csv`), joining sleep sessions with stage intervals and preserving Galaxy Watch/Ring source metadata.
  - `withings.rs`: Parses Withings export ZIP/CSV (`sleep.csv` with `from`, `to`, `light (s)`, `deep (s)`, `rem (s)`, `awake (s)`, heart rate) without making medical claims.
  - `ringconn.rs`: Parses RingConn export ZIP/CSV (`sleep.csv`, `vitals.csv`) preserving date-keyed sleep summaries, stage totals, HRV, resting HR, and SpO2.
  - `polar.rs`: Parses Polar `nightly_recovery_*.json` (ANS/RMSSD/respiration) when present and explicitly reports that Polar account exports omit sleep timelines, directing users to Apple Health or Health Connect bridges.
- Implement honest detection & guidance for:
  - `suunto`: Recognizes workout-only FIT/GPX archives as `NoUsableSleepData` and provides Apple Health / Health Connect bridge instructions.
  - `ultrahuman`: Exposes truthful unverified/bridge-only status with generic CSV mapping fallback.
  - `android_health_connect`: Recognizes `Health Connect.zip` internal SQLite backups as `RecognizedUnsupported` without bypassing OS protections, recommending native Android Health Connect sync or `.plethora-health.enc` transfer.

## Capabilities

### New Capabilities

- `secondary-wearable-export-importers`: Native export importers for Samsung Health, Withings, RingConn, and Polar recovery JSON, plus truthful detection and bridge guidance for Suunto, Ultrahuman, and Android Health Connect backups.

### Modified Capabilities

None.

## Impact

- **Dependencies:** Depends on `establish-universal-wearable-import-foundation` and `implement-secure-health-archive-ingestion`.
- **Native:** `src-tauri/src/health/importers/{samsung_health,withings,ringconn,polar}.rs` and honest detection rules in `detector.rs` / `registry.rs`.
