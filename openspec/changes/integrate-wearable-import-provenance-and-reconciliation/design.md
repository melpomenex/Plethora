## Context

Currently `reconcile_sleep_sessions` in `reconciliation.rs` computes `light_mins`, `deep_mins`, `rem_mins`, `awake_mins` from `primary.stages` only! Look at `reconciliation.rs:88` (`compute_stage_metrics(primary)`). If a provider like WHOOP or Withings supplies `light_mins`, `deep_mins`, `rem_mins`, `awake_mins` with `stages` empty (`AggregateStageDurationsOnly`), `compute_stage_metrics` would overwrite or return `None` unless it falls back to `primary.light_mins` / `deep_mins` / `rem_mins` / `awake_mins` when `stages` is empty! That's a critical architectural catch from our audit.

## Goals / Non-Goals

- **Goals:**
  - Preserve `primary.light_mins`, `deep_mins`, `rem_mins`, `awake_mins` in `CanonicalSleepEpisode` when `primary.stages` is empty and `AggregateStageDurationsOnly` is set, while keeping `stage_coverage_ratio = 0.0` and `stages = []` so Sleep Chart renders summary totals honestly without fake intervals.
  - Implement `health_import_batch_records` (or reference-counted batch provenance) so deleting batch A does not delete a record also imported by batch B.
  - Ensure cross-route deduplication (e.g., Oura file import + Oura cloud sync) shares `(provider_id, external_record_id)` or clusters cleanly via `SameSourceExportDuplicate`.
- **Non-Goals:**
  - Do not pool `RMSSD` and `SDNN` or average proprietary recovery scores across providers.

## Decisions

- **Batch Deletion Semantics:** Track `(batch_id, table_name, record_id)` in `health_import_batch_records`. On `delete_import_batch(batch_id)`, delete only raw records whose `id` has no remaining rows in `health_import_batch_records` for other batches (and `sync_batch_id` is not from a non-import live sync, or live syncs also record ownership), then re-run `reconcile_sleep_transaction`.
