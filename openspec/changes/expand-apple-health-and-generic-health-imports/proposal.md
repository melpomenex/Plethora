## Why

Long-term Apple Watch users frequently have `export.xml` files and `export.zip` archives well over 50 MB, which are currently rejected by `MAX_IMPORT_BYTES`. Meanwhile, the generic CSV importer uses a fragile line-splitting parser with only 6 columns and no support for UTF-8 BOM, multiline quoted fields, alternate delimiters, stage duration columns, physiological biometrics, or user-defined column mapping profiles.

## What Changes

- Expand Apple Health importer (`apple_health.rs`) to stream directly from `File` or `export.zip` (`apple_health_export/export.xml`) via `quick-xml` with bounded memory, batching, progress/cancellation, XXE/DTD rejection, and expanded metric coverage (respiratory rate, SpO2, sleeping wrist temperature where present, sourceName/device metadata).
- Replace fragile `split_csv_line` with RFC-4180 compliant streaming CSV parsing (`csv` crate or hardened state-machine parser) supporting UTF-8 BOM, CRLF, multiline quoted fields, alternate delimiters, formula-injection defense, and expanded canonical columns (stages, latency, efficiency, HRV, RHR, SpO2, temperature, respiratory rate, scores, notes).
- Add a **CSV Column Mapping Wizard** backend contract (`CsvMappingProfile`) with reusable saved profiles in `health.db` (`003_universal_import_batches` or `004_csv_mapping_profiles`) and preview before commit.
- Preserve 100% backwards compatibility with existing Plethora CSV, Plethora JSON v1, and `.plethora-health.enc` bundles.

## Capabilities

### New Capabilities

- `apple-health-and-generic-health-imports`: Streaming multi-year Apple Health XML/ZIP ingestion above 50 MB and RFC-4180 generic CSV ingestion with custom column mapping profiles.

### Modified Capabilities

None.

## Impact

- **Dependencies:** Depends on `establish-universal-wearable-import-foundation` and `implement-secure-health-archive-ingestion`.
- **Native:** `src-tauri/src/health/importers/apple_health.rs`, `src-tauri/src/health/importers/generic_csv.rs`, `src-tauri/src/health/importers/plethora_json.rs`.
