# Developer Guide: Schedulers

## Production scheduler

**FSRS-7** (`scheduler id: fsrs`) is the sole production scheduling algorithm.
All review paths normalize persisted settings and algorithm identifiers to
`fsrs` before dispatch.

- Rust implementation: `src-tauri/src/algorithms/fsrs7/`
- TypeScript port (browser parity): `src/algorithms/fsrs7/`
- Vendored upstream: `vendor/fsrs-rs-fsrs7/` (see `UPSTREAM.md`)

FSRS-7 uses a **dual-trace** memory state (`stability`, `stability_fast`,
`difficulty`), fractional elapsed days, and a 34-parameter weight vector.
Legacy 17/19/21-parameter vectors are rejected; migration replays review
history instead of converting legacy stability values.

## Legacy schedulers

The following schedulers remain **compiled and tested** but are **hidden from
the UI** and not user-selectable:

| Canonical id | Label |
|--------------|-------|
| `adaptive` | Plethora Adaptive |
| `precision` | Plethora Precision (Algorithm Arena) |
| `classic` | Plethora Classic |
| `classic_5` | Plethora Classic 5 |
| `classic_8` | Plethora Classic 8 |
| `classic_15` | Plethora Classic 15 |

Lifecycle metadata lives in `src/lib/schedulerCatalog.ts`
(`SCHEDULER_LIFECYCLE`). Identity normalization is in
`src/lib/schedulerIdentity.ts` (`normalizeToProductionScheduler`).

Do not delete legacy scheduler code without an explicit deprecation plan;
tests and migration replay depend on it.

## Document schedulers

Documents use separate schedulers that do not train the flashcard FSRS
optimizer:

- **Engaging FSRS-7** — primary path for in-app document ratings
  (`src-tauri/src/algorithms/engaging_scheduler.rs`)
- **Incremental fallback** — fixed-interval path for API/MCP
  (`src-tauri/src/algorithms/document_scheduler.rs`)

## Related docs

- User-facing algorithm overview: `docs/product/features/scheduling/fsrs-algorithm.md`
- Third-party license: `docs/THIRD_PARTY_NOTICES.md`
- OpenSpec change (planning): `openspec/changes/adopt-fsrs7-as-production-scheduler/`
