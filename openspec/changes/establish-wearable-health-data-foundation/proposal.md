## Why

Plethora currently stores all learning, reading, and review telemetry inside `plethora.db` (plain SQLite exported whole by `BackupManager` and indexed into `semantic_chunks`). Wearable sleep and biometric data is far more sensitive and regulated (Apple App Store Guideline 5.1.3 iCloud prohibition, Google Play Health Connect policies, GDPR Article 9, Washington MHMDA) and requires local-first provenance, cross-source deduplication, manual tracking, and safe file import/export before any mobile bridge, cloud connector, or learning analytics can ingest data.

## What Changes

- Establish an isolated local SQLite Health Vault (`<app_data_dir>/health/health.db`) with dedicated transactional migrations (`_health_schema_migrations`), physically separated from `plethora.db`, cloud drive backups, and E2EE library sync.
- Define canonical Rust domain models and trait boundaries (`NativeHealthAdapter` vs `CloudHealthConnector`) preserving full provider, device, external record ID, original units, acquisition time, and quality metadata.
- Implement UTC-instant duration arithmetic, timezone/DST-safe biological wake-date anchor computation, and deterministic cross-source deduplication/reconciliation (preventing double counting between direct wearable APIs and health aggregators while keeping independent device observations auditable).
- Implement opt-in OS keychain / AES-256-GCM token persistence via `crate::utils::keychain::KeyringIo` without touching OS keychains unless `PLETHORA_USE_KEYCHAIN=1`.
- Implement Manual Sleep CRUD, JSON/CSV import/export, streaming Apple Health `export.xml` import, passphrase-encrypted `.plethora-health.enc` portable transfer bundles, and an isolated synthetic demo dataset generator.

## Capabilities

### New Capabilities

- `wearable-health-foundation`: Isolated local Health Vault schema, normalized domain models, provenance, time/DST rules, cross-source sleep deduplication/reconciliation, token security, manual sleep tracking, validated file import/export, and isolated demo fixtures.

### Modified Capabilities

None.

## Impact

- **Native:** New Rust subsystem `src-tauri/src/health/` (`models.rs`, `migrations.rs`, `db.rs`, `time.rs`, `reconciliation.rs`, `token_store.rs`, `import_export.rs`, `fixtures.rs`, `provider.rs`), new IPC commands in `src-tauri/src/commands/health.rs` registered in `src-tauri/src/lib.rs`, and `HealthVault` managed state.
- **Privacy & Isolation:** Zero tables added to `plethora.db`; `BackupManager`, `sync_outbox`, `semantic_chunks`, and `MEMORY.md` cannot access health records. Plain SQLite vs keychain/encrypted-bundle boundaries are explicitly documented.
- **Reference Contracts:** `openspec/planning/wearable-health-sleep-program/02-ARCHITECTURE-AND-SHARED-CONTRACTS.md` and `03-THREAT-MODEL-AND-COMPLIANCE.md`.
- **Documentation Impact:** Documented in `docs/PRIVACY_ARCHITECTURE.md` and `docs/architecture/wearable-health-providers.md` (covered in Change G).
