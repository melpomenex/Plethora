## Context

The Health Vault (`health.db`) already stores `provider_id`, `external_record_id`, `sync_batch_id`, `RawSleepSession`, `PhysiologicalObservation`, and `RecoveryObservation`. However, `import_export.rs` hardcodes `HealthProviderId::FileImport` and lacks a unified adapter interface, preview stage, or batch-level metadata.

## Goals / Non-Goals

- **Goals:**
  - Define `WearableImportAdapter` with `descriptor()`, `detect(&ImportInspection)`, `inspect(&ImportInput)`, and `parse(&ImportInput, &ImportContext)`.
  - Provide deterministic multi-signal `DetectionResult` (`Confident`, `Probable`, `Ambiguous`, `Unknown`, `RecognizedUnsupported`, `NoUsableSleepData`).
  - Persist `health_import_batches` (file name/hash, detected provider, format, date coverage, counts, warnings) linked to `health_sync_batches` and raw records.
  - Support `CancellationToken` (`AtomicBool`) checked during inspection, parsing, and ingestion.
- **Non-Goals:**
  - Do not create a separate database outside `health.db`.
  - Do not use LLMs or cloud services for format detection or parsing.

## Decisions

- **Adapter Registry Integration:** `ImportAdapterRegistry` exposes `ImportAdapterDescriptor` for each provider, merged into `catalog.rs` so Settings and Data Sources truthfully separate `file_import_readiness` from `cloud_sync_readiness`.
- **Acquisition Method Separation:** Add `acquisition_method` (`native_mobile`, `cloud_oauth`, `file_import`, `manual`) to `health_sync_batches` and `health_import_batches` while setting `provider_id` to the actual wearable manufacturer (e.g. `garmin`, `oura`, `whoop`) when confidently detected or selected by the user.
- **Preview Isolation:** `inspect()` runs in read-only mode on bounded samples/streams and checks existing `(provider_id, external_record_id)` keys in `health.db` to estimate `new_count`, `duplicate_count`, and `update_count` without opening a write transaction.

## Risks / Trade-offs

- **Misdetection on generic CSVs:** Generic CSVs without provider-specific headers return `Unknown` or `Ambiguous` and route to the CSV Column Mapping Wizard rather than guessing a wearable provider.

## Migration Plan

- Migration `003_universal_import_batches` creates `health_import_batches` and adds `import_batch_id` / `acquisition_method` columns safely using `ALTER TABLE ... ADD COLUMN` (or `CREATE TABLE IF NOT EXISTS`) without touching existing rows; legacy `file_import` rows remain valid and queryable.
