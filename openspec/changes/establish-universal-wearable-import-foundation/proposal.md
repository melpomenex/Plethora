## Why

Plethora's existing file importer (`src-tauri/src/health/import_export.rs`) only accepts generic sleep CSV, Plethora JSON v1 bundles, Apple Health `export.xml` (capped at 50 MB), and encrypted `.plethora-health.enc` bundles, collapsing all file imports under `HealthProviderId::FileImport`. Users who download their personal data from Garmin, Oura, WHOOP, Google Takeout/Fitbit, Samsung Health, Withings, RingConn, or Apple Health cannot import their native exports without manual conversion, and imported records lose original wearable provider identity.

## What Changes

- Introduce a `WearableImportAdapter` trait and deterministic `ImportAdapterRegistry` in `src-tauri/src/health/importers/` with explicit capabilities, format metadata, and verification status.
- Implement content-based deterministic `detect_import_format` inspecting file signatures, archive directory structures, JSON keys, CSV headers, and XML root elements without relying solely on file extensions.
- Add `ImportPreview`, `ImportProgressEvent`, `ImportDiagnostics`, `ImportCancellationToken`, and `ImportBatchRecord` (persisted via SQLite migration `003_universal_import_batches` in `health.db`) supporting non-committing preview, category selection, and atomic batch rollback/deletion.
- Preserve original wearable `HealthProviderId` alongside `AcquisitionMethod::FileImport` so imported Garmin, Oura, WHOOP, Google Health, Samsung, Withings, and RingConn records retain true provider attribution.

## Capabilities

### New Capabilities

- `universal-wearable-import-foundation`: Extensible `WearableImportAdapter` contract, deterministic registry, content-based format detection, non-committing import preview, progress/cancellation, and import batch persistence.

### Modified Capabilities

None.

## Impact

- **Dependencies:** Depends on `establish-wearable-health-data-foundation`.
- **Native:** New module tree `src-tauri/src/health/importers/` (`mod.rs`, `registry.rs`, `detector.rs`, `types.rs`), migration `003_universal_import_batches` in `src-tauri/src/health/migrations.rs`, and orchestration commands in `src-tauri/src/commands/health.rs`.
- **Privacy & Security:** 100% local deterministic parsing; no LLM, network, or `plethora.db` / `semantic_chunks` writes; preview never mutates committed health records.
