## Why

A universal health data import platform handles untrusted archives, multi-hundred-megabyte XML/JSON/CSV files, and sensitive personal health records. Before shipping, every security boundary, streaming performance target, reconciliation invariant, privacy isolation boundary, frontend workflow, and capability matrix must be verified with automated tests, benchmarks, and truthful documentation.

## What Changes

- Create sanitized provider fixtures (with explicit provenance metadata) and comprehensive parser, archive security (ZIP Slip, symlink, ZIP bomb, XXE, CSV formula injection), reconciliation, batch deletion, and analytics integration tests.
- Add large-file streaming benchmarks (including a >50 MB synthetic multi-year Apple Health XML benchmark) measuring peak memory, elapsed time, throughput, and cancellation latency.
- Implement optional desktop-only local recurring import folder watcher (`watched_import_folder`) with explicit opt-in, no home-directory scanning, no source-file deletion, and idempotent ingestion.
- Update `docs/architecture/wearable-health-providers.md`, `docs/product/features/platform/wearable-health-insights.md`, and `openspec/planning/wearable-health-sleep-program/01-PROVIDER-CAPABILITY-MATRIX.md` with the verified capability matrix and user guide.

## Capabilities

### New Capabilities

- `universal-wearable-import-hardening`: Security test suite, large-file streaming benchmarks, optional desktop recurring import folder, and definitive provider capability matrix documentation.

### Modified Capabilities

None.

## Impact

- **Dependencies:** Depends on all 7 preceding universal wearable import changes.
- **Verification:** `cargo test`, `npm run test:run`, `npm run docs:validate`, `npm run build:check`, `openspec validate --strict`.
