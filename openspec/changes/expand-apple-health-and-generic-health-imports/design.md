## Context

Apple Health `export.zip` contains `apple_health_export/export.xml` which can be 200 MB–1.5 GB for multi-year Apple Watch users. Reading it as a single `&[u8]` or `String` in memory or over Tauri IPC is infeasible on mobile and desktop.

## Goals / Non-Goals

- **Goals:**
  - Stream `export.xml` from `BufReader` (disk file or `ZipFile` stream) with `quick-xml` using a small reusable byte buffer (`8 KiB`) and bounded in-memory accumulation.
  - Group sleep segments per `(sourceName, device)` and flush physiological observations in bounded batches (e.g. 5,000 rows per transaction chunk or staged batch) with cancellation checks every N records.
  - Support generic CSV with auto-detected standard columns plus `CsvMappingProfile` (column map, timestamp format, duration unit, temperature unit, fallback timezone, provider label, stage label map).
- **Non-Goals:**
  - Do not guess ambiguous local timestamps or decimal formats silently; require explicit user selection in the mapping profile when ambiguous.

## Decisions

- **Apple Health Provider Attribution:** Set `provider_id = HealthProviderId::AppleHealthkit` with `AcquisitionMethod::FileImport` and preserve `sourceName` / `device` in `source_app_bundle` and `health_devices` so reconciliation recognizes Apple Watch vs third-party apps mirrored in Apple Health.
- **CSV Parser:** Use `csv` crate (`sfw cargo add csv`) or a complete RFC-4180 streaming state-machine reader with BOM stripping and formula-injection rejection (`=`, `+SUM`, `-SUM`, `@SUM`, `\t=`, `\r=`). Let's check if `csv` is already in `Cargo.lock` or can be added cleanly via `sfw cargo add csv`.
