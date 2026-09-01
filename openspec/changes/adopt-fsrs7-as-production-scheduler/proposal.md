## Why

Plethora currently schedules reviews with FSRS-6 and exposes multiple legacy schedulers (Precision, Adaptive, Classic variants) as user-selectable options. FSRS-7 from the BSD-licensed upstream PR #426 improves memory modeling with dual-trace state (`stability`, `stability_fast`, `difficulty`), fractional elapsed-time scheduling, and same-day review support. Adopting FSRS-7 as the sole production scheduler unifies scheduling behavior across platforms while preserving review history and legacy code for research.

## What Changes

- **BREAKING (user-visible):** FSRS-7 replaces FSRS-6 as the only production scheduler; legacy schedulers are hidden from UI but retained in code.
- Vendor exact FSRS-7 implementation from PR #426 (`47fb3af`) under `vendor/fsrs-rs-fsrs7/`.
- Extend memory state with `stability_fast`; add DB migration and sync fields.
- Reconstruct FSRS-7 state from review history on migration (not from legacy S/D values).
- Invalidate legacy 17/19/21-parameter vectors; re-optimize with FSRS-7 optimizer when sufficient history exists.
- Use fractional elapsed days in all production FSRS paths (no `u32` day truncation).
- Explicit `FSRS::new(&DEFAULT_PARAMETERS)` construction — never empty/default FSRS-6.
- Browser/PWA TypeScript FSRS-7 port with differential parity tests against Rust canonical.
- Production dispatch enforces `fsrs` + FSRS-7 regardless of stale persisted scheduler settings.
- Four-button review UI only (Again/Hard/Good/Easy); six-grade controls unreachable in production.
- Update documentation, licensing notices, and changelog to FSRS-7.

## Capabilities

### New Capabilities

- `fsrs7-production-scheduler`: FSRS-7 as sole production scheduler with explicit construction, fractional elapsed time, and dual-trace state persistence.
- `fsrs7-migration`: Review-history replay migration, legacy state preservation, idempotent/resumable migration.
- `fsrs7-browser-parity`: TypeScript FSRS-7 implementation verified against vendored Rust via differential tests.
- `scheduler-lifecycle`: Production vs Legacy vs Internal scheduler status abstraction and production enforcement.

### Modified Capabilities

- `flashcard-review-session`: Review session routes exclusively through FSRS-7 four-button ratings; document scheduler references updated.
- `schedule-workspace`: Scheduler catalog exposes only FSRS-7 to users.

## Impact

- **Rust:** `src-tauri/` — `fsrs` dependency → vendored 6.0.0; `review.rs`, `document_scheduler.rs`, `engaging_scheduler.rs`, `learning_item.rs`, migrations, sync.
- **TypeScript:** `schedulerCatalog.ts`, `browser-backend.ts`, `fsrsParameters.ts`, new `src/algorithms/fsrs7/`, settings UI, review components.
- **Server:** `server/src/routes/video-extracts.ts` ts-fsrs → FSRS-7.
- **Database:** New columns for `stability_fast`, migration metadata, legacy rollback fields.
- **Docs:** Handbook, product docs, website, open-source notices.
- **Tests:** Parity vectors, 10k+ differential corpus, migration fixtures, UI negative-access tests.
