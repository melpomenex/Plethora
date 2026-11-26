## 1. Domain Contracts & Registry

- [x] 1.1 Define `AcquisitionMethod`, `DetectionConfidence`, `DetectionResult`, `ImportCapabilities`, `ImportPreview`, `ImportProgress`, `ImportBatchSummary`, and `WearableImportAdapter` trait in `src-tauri/src/health/importers/types.rs`.
- [x] 1.2 Implement `ImportAdapterRegistry` in `src-tauri/src/health/importers/registry.rs` with deterministic ordering and truth-aligned `ImportAdapterDescriptor` metadata.
- [x] 1.3 Implement content-based `detect_import_format` in `src-tauri/src/health/importers/detector.rs` supporting ZIP entry inspection, XML root/DTD checks, JSON key/shape inspection, and CSV header matching.

## 2. Database Migration & Orchestration

- [x] 2.1 Add migration `003_universal_import_batches` in `src-tauri/src/health/migrations.rs` for `health_import_batches` and batch provenance columns.
- [x] 2.2 Implement `preview_wearable_import`, `commit_wearable_import`, `cancel_wearable_import`, `list_import_batches`, and `delete_import_batch` in `src-tauri/src/health/importers/orchestrator.rs`.
- [x] 2.3 Expose Tauri IPC commands in `src-tauri/src/commands/health.rs` and register them in `src-tauri/src/lib.rs`.
