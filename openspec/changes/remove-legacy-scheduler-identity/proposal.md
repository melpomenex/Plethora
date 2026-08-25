# Remove Legacy Scheduler Identity

## Why

Plethora's user-facing scheduler names (Plethora Classic, Plethora Adaptive, Plethora Precision, FSRS-6) are established, but the repository still carries hundreds of internal identifiers, comments, serialized keys, arena model ids, type aliases, OpenSpec archives, and compatibility shims that embed legacy third-party scheduler codes (`legacy-adaptive-id`, `legacy-precision-id`, `legacy-classic-id`, etc.). This creates mixed identity in active development, leaks historical provenance into help/RAG content, and spreads legacy strings through types that should be Plethora-native. A prior `complete-plethora-identity-cleanup` pass migrated database `algorithm_type` values and renamed major modules, but dual legacy/canonical ids remain in TypeScript unions, arena serialization, precision internals, and archived specs. This change finishes the migration: canonical Plethora-native identity everywhere in the active tree, with legacy recognition quarantined to a single compatibility boundary.

## What Changes

- Introduce canonical scheduler ids (`classic`, `classic_5`, `classic_8`, `classic_15`, `adaptive`, `precision`, `fsrs`) as the only ids in application logic, TypeScript types, and new serialization.
- Migrate Algorithm Arena competitor ids from legacy arena competitor codes (`legacy-arena-classic`, `legacy-arena-classic-15`, `legacy-arena-classic-19`, `legacy-arena-precision`, `fsrs`) to `m1`–`m5` with serde/JSON aliases for persisted payloads.
- Quarantine legacy id recognition (`legacy-adaptive-id`, `legacy-precision-id`, `legacy-classic-id`, …) in dedicated `scheduler_identity` modules (Rust + TypeScript); remove legacy ids from unions, catalogs, and comments elsewhere.
- Rename precision internal symbols (`PrecisionState` → `PrecisionState` is done; finish `PRECISION_*` constants, diagnostic types, and module comments).
- Remove backward-compat type aliases (`AdaptiveReviewResult`, `ArenaModelId`, etc.) from public APIs; frontend uses canonical names only.
- Add SQLite migration `106_normalize_arena_model_ids` to rewrite persisted arena provenance JSON where stored as legacy strings.
- Add automated terminology gate (`scripts/check-scheduler-terminology.mjs` + vitest wrapper) scanning `src/`, `src-tauri/`, `docs/`, `website/`, `openspec/`, `scripts/`, `tests/`.
- Extend golden-vector scheduler tests: before/after rename outputs must match exactly.
- Sanitize all OpenSpec archives and active changes under `openspec/` to Plethora-native terminology (rename archive dirs where needed).
- Clean remaining i18n, handbook, CHANGELOG prose, and help index references.
- **No algorithm behavior change** — mathematics, intervals, arena weights, and FSRS remain identical.

## Capabilities

### New Capabilities

- `scheduler-identity`: Canonical Plethora scheduler and arena model identifier taxonomy plus compatibility boundary contract.
- `scheduler-persistence-migration`: Database and settings normalization rules for legacy persisted ids.
- `precision-internal-naming`: M1–M5 precision subsystem naming, comments, and public symbol conventions.
- `scheduler-terminology-gate`: Automated repository scan enforcing zero forbidden terminology in maintained source.

### Modified Capabilities

- `scheduler-catalog`: Registry exposes only canonical scheduler ids; arena labels use M1–M5 mapping.
- `document-rating`: Six-grade rating schema references canonical scheduler ids only.

## Impact

- **Rust**: `src-tauri/src/algorithms/`, `src-tauri/src/scheduler_identity.rs` (new), `src-tauri/src/database/migrations.rs`, `src-tauri/src/commands/review.rs`, precision submodule.
- **TypeScript**: `src/lib/schedulerCatalog.ts`, `src/lib/schedulerIdentity.ts` (new), `src/stores/settingsStore.ts`, `src/api/review.ts`, review UI, browser backend.
- **Database**: migration 106 for arena provenance normalization (idempotent).
- **Tests**: golden vectors, migration fixtures, terminology gate, existing scheduler test suites updated.
- **Docs/OpenSpec**: `docs/`, `openspec/changes/archive/`, `openspec/specs/`, website docs.
- **Out of scope**: Git history rewrite, FSRS rebranding, third-party license text, whisper.cpp vendored code.
