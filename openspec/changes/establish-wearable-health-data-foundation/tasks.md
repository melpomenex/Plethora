## Tasks

- [x] A-T01 Define normalized Rust domain models, enums, quality flags, and connector trait families (`NativeHealthAdapter`, `CloudHealthConnector`) in `src-tauri/src/health/models.rs` and `provider.rs`
- [x] A-T02 Implement isolated SQLite Health Vault (`<app_data_dir>/health/health.db`), schema migration `001_health_foundation`, and repository CRUD/deletion/vacuum in `src-tauri/src/health/migrations.rs` and `db.rs`
- [x] A-T03 Implement UTC-instant duration arithmetic, timezone offset parsing, DST handling, and biological wake-date anchoring in `src-tauri/src/health/time.rs`
- [x] A-T04 Implement deterministic cross-source sleep clustering, duplicate vs independent device classification, source priority ranking, conflict detection, and tombstone recomputation in `src-tauri/src/health/reconciliation.rs`
- [x] A-T05 Implement health OAuth token storage via `crate::utils::keychain::KeyringIo` and AES-256-GCM file fallback with redacted `Debug` output in `src-tauri/src/health/token_store.rs`
- [x] A-T06 Implement manual sleep CRUD, canonical JSON export/import, validated CSV importer, streaming Apple Health `export.xml` importer, passphrase-encrypted `.plethora-health.enc` bundles, and isolated seeded synthetic demo fixture generator in `src-tauri/src/health/import_export.rs` and `fixtures.rs`
- [x] A-T07 Register `pub mod health;`, `HealthVault` managed state, and foundation IPC commands in `src-tauri/src/commands/health.rs` and `src-tauri/src/lib.rs`
- [x] A-T08 Add comprehensive Rust unit and integration tests for migrations, provenance idempotency, DST, deduplication, file validation, encryption round-trip, and full wipe, and verify via `cargo test --lib health::`
