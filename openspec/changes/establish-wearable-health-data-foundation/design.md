## Context

Verified baseline (`c79f7473`): `plethora.db` is plain SQLite (`sqlx 0.8`), `BackupManager::create_backup` exports the entire `plethora.db` file (`src-tauri/src/backup/manager.rs:80`), and `KeyringIo` (`src-tauri/src/utils/keychain.rs`) gates OS keychain calls behind `PLETHORA_USE_KEYCHAIN=1` with an AES-256-GCM fallback.

## Goals / Non-Goals

- **Goals:**
  - Isolate all health tables in `<app_data_dir>/health/health.db` with WAL mode and `PRAGMA foreign_keys = ON`.
  - Guarantee idempotent imports and non-destructive reconciliation across overlapping raw sleep sessions.
  - Enable full Sleep Chart and correlation usage without owning a wearable via manual entry and validated file imports.
- **Non-Goals:**
  - Integrating SQLCipher across Plethora (honestly disclose plain SQLite + OS disk encryption protection instead).
  - Automatic cloud sync of HealthKit or Health Vault records.

## Decisions

### Separate `health.db` Vault
All health connections, devices, consent events, raw sleep sessions, sleep stage intervals, canonical episodes, physiological observations, recovery scores, source preferences, and privacy flags reside in `<app_data_dir>/health/health.db`. This guarantees `BackupManager`, `collection_archive`, and `sync_outbox` cannot accidentally export wearable data, enables iOS `NSURLIsExcludedFromBackupKey` on the `health/` directory, and makes `wipe_all_health_data()` verifiable with `VACUUM`.

### Deterministic Cross-Source Reconciliation
Sessions overlapping by IoU ≥ 0.50, containment ≥ 0.65, or within 15-minute start/end deltas cluster into one `CanonicalSleepEpisode`. User-configured source priority ranks members, breaking ties by direct-source preference over aggregator mirrors, stage completeness, and quality flags. Duplicate re-exports (`same_source_export_duplicate`) are linked without double-counting totals; competing multi-device observations (`independent_device_observation`) retain raw rows and flag `has_source_conflict` when durations diverge by more than 30 minutes.

### Biological Wake-Date Anchor
Sleep episodes crossing midnight anchor to their local wake calendar date (`end_at_ms + end_tz_offset_secs`) so nocturnal sleep belongs to the morning the learner wakes up, while durations use exact UTC epoch millisecond differences immune to DST shifts.

## Risks / Trade-offs

- **Two SQLite pools** → Cross-DB SQL joins cannot run in one SQLite statement; analytics load normalized sessions in Rust from `HealthVault` and read-only learning telemetry from `Repository`, which enforces the isolation boundary cleanly.
- **Apple `export.xml` size** → Multi-year Apple Health exports can exceed hundreds of megabytes; stream using `quick-xml` without loading the full DOM into RAM and enforce bounded file/row guards on CSV/JSON.

## Migration Plan

1. Initialize `HealthVault` on app startup (and in-memory in tests) running `001_health_foundation`.
2. Initialize default `health_privacy_settings` (`ai_sharing_enabled = 0`, `cloud_sync_enabled = 0`) and `health_source_preferences`.
