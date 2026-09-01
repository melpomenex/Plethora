## Context

Plethora schedules flashcard reviews via Rust (`fsrs` 5.2) and browser (`ts-fsrs` 5.2.x), with additional Plethora-native schedulers (Precision, Adaptive, Classic). FSRS-7 from PR #426 (`47fb3af`) introduces dual-trace memory state, 34-parameter model, and fractional elapsed-time scheduling. Legacy schedulers remain valuable for research but must not be user-selectable.

## Goals / Non-Goals

**Goals:**
- Vendor exact FSRS-7 from PR #426 with BSD-3-Clause provenance
- FSRS-7 as sole production scheduler with explicit 34-param construction
- Review-history replay migration preserving due dates
- Cross-platform parity (Rust canonical + TypeScript port with differential tests)
- Four-button review UI; legacy schedulers hidden but preserved
- `stability_fast` persisted and synced

**Non-Goals:**
- Deleting legacy scheduler implementations or tests
- Porting FSRS-7 training/optimizer to TypeScript (Rust-only via `compute_parameters`)
- ADR cost-aware retention (defer)
- Mass-rescheduling existing due dates

## Decisions

### D1: Vendor fsrs-rs 6.0.0 at `vendor/fsrs-rs-fsrs7/`
Pin commit `47fb3af98d434dceda9cdd9c4f28d3dc10237054`. Path dependency in `Cargo.toml`. UPSTREAM.md documents provenance.

**Alternative rejected:** Manual formula rewrite — risks mathematical drift.

### D2: Explicit FSRS-7 construction
`create_fsrs7()` always calls `FSRS::new(&DEFAULT_PARAMETERS)` (34 elements). Legacy 17/19/21 weights rejected with fallback to defaults.

**Trap avoided:** `FSRS::default()` / `FSRS::new(&[])` instantiate FSRS-6.

### D3: Memory state schema
Extend `MemoryState` with `stability_fast: Option<f64>`. DB column `memory_state_stability_fast`. Version marker `fsrs_implementation_version = "fsrs7"`.

### D4: Migration via review replay
Use `FSRS::memory_state()` over sorted review log. Do not translate legacy S/D. Archive `legacy_algorithm_type` / `legacy_algorithm_state`. Background batch on startup; idempotent per item.

### D5: Browser parity via TypeScript scalar port
Port `model_v7.rs` scalar functions to `src/algorithms/fsrs7/`. Differential tests against Rust golden values. WASM rejected due to Burn dependency weight.

### D6: Production enforcement
`normalizeToProductionScheduler()` in settings hydrate + Rust `apply_review` normalizes algorithm to `fsrs` before dispatch. `SELECTABLE_SCHEDULERS = [fsrs]` only.

### D7: Fractional elapsed time
All production paths use `next_states_with_elapsed_days(f32)`. Remove `as u32` truncation.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| TS port drifts from Rust | Golden vectors + 10k+ differential corpus |
| Migration blocks startup | Background batch with cursor; idempotent |
| Stale settings reactivate legacy | Normalize at hydrate + dispatch |
| Old params misinterpreted as FSRS-7 | Reject non-34 lengths; re-optimize |
| Queue explosion | Preserve due_date; only update memory state |

## Migration Plan

1. Schema migration 115 (columns + tracking table)
2. Background replay for all items not marked `fsrs7`
3. Settings normalization on hydrate
4. Rollback: `legacy_algorithm_type` / `legacy_algorithm_state` preserved one generation

## Open Questions

- None blocking — PR #426 head SHA verified unchanged at planning time.
