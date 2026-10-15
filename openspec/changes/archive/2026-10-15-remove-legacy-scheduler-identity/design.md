# Design: Remove Legacy Scheduler Identity

## Principles

1. **Canonical identity in domain code** — `classic`, `adaptive`, `precision`, `fsrs`, arena `m1`–`m5`.
2. **Single compatibility boundary** — `src-tauri/src/scheduler_identity.rs` and `src/lib/schedulerIdentity.ts` are the only modules that map legacy persisted strings.
3. **No algorithm drift** — golden-vector tests lock scheduler outputs before/after rename.
4. **Historical SQL untouched** — pre-103 migration SQL retains literal legacy table names because fresh installs replay the chain; migration 103 renames to `arena_*`.

## Identifier dependency map

```
UI (LearningSettings, ReviewSession)
  → schedulerCatalog.ts (labels only)
  → schedulerIdentity.ts (normalize on hydrate)
  → settingsStore / reviewStore
  → api/review.ts, api/algorithm.ts
  → Tauri invoke (canonical: get_arena_stats, optimize_precision_kernel, …)
  → ipc_compat.rs (legacy invoke aliases)
  → commands/review.rs
  → algorithms::{classic, adaptive, precision}
  → SQLite learning_items.algorithm_type (canonical after migration 103)
  → sync payloads (normalize on deserialize)
```

## Precision Arena

```
PrecisionScheduler
  ├── M1 Classic model (model1.rs)
  ├── M2 Classic 15 optimizer (model2.rs)
  ├── M3 Classic 19 matrix (model3.rs)
  ├── M4 Precision kernel (kernel.rs)
  └── M5 FSRS (model5.rs)
        → Arena (arena.rs) → adaptive weights → final interval
```

## Identifier mapping table

| Surface | Previous identifier | New canonical identifier | Migration? | Compatibility |
| ------- | ------------------- | ------------------------ | ---------- | ------------- |
| `learning_items.algorithm_type` | legacy adaptive id | `adaptive` | 103 (done) | `scheduler_identity` on read |
| | legacy precision id | `precision` | 103 | same |
| | legacy classic id | `classic` | 103 | same |
| | legacy classic 5/8/15 ids | `classic_5/8/15` | 103 | same |
| Settings `algorithm` | legacy scheduler ids | canonical | hydrate normalize | `schedulerIdentity.ts` |
| Settings `precisionPureKernel` | legacy settings key | `precisionPureKernel` | hydrate alias | read both keys |
| Settings `arenaReviewMode` | legacy settings key | `arenaReviewMode` | hydrate alias | read both keys |
| Arena `model_id` JSON | legacy competitor ids | `m1`…`m5` | serde alias + optional 106 | deserialize both |
| `ArenaModelId` Rust enum | legacy variant names | `M1`…`M5` | serde alias | deserialize both |
| Tauri legacy arena stats command | legacy command | `get_arena_stats` | none | `ipc_compat` wrapper |
| Browser IDB key | legacy collection key | `precision_collection_state` | read both | browser-backend |
| TS type `RatingGrade` | legacy alias removed | `RatingGrade` | remove alias | update imports |
| OpenSpec archives | legacy-branded dirs | neutral names | content rewrite | N/A |

## Serde rules

- `AlgorithmType`: canonical snake_case only on serialize; `from_str_lossy` delegates to `scheduler_identity`.
- `ArenaModelId`: serialize `m1`–`m5`; legacy competitor ids deserialize via `arena_model_identity`.

## Terminology gate

`scripts/check-scheduler-terminology.mjs` scans maintained trees. Exempt paths:

- `src/lib/schedulerIdentity.ts` (compatibility table)
- `src-tauri/src/scheduler_identity.rs` (compatibility table)
- `src-tauri/src/database/migrations.rs` and `src-tauri/migrations/*.sql` (historical DDL)
- `src-tauri/src/ipc_compat.rs` (legacy invoke names only)
- `whisper.cpp/**` (vendored)
- Lockfiles, `target/`, `node_modules/`, `dist/`

## Test strategy

- Golden vectors: adaptive, precision (all M1–M5 + arena), classic, FSRS — fixed seed, exact interval match.
- Migration fixture: DB with legacy adaptive/precision items opens and reviews identically post-migration.
- Terminology gate: CI script exit 0.
