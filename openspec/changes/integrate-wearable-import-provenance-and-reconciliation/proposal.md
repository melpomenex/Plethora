## Why

Imported wearable data must flow seamlessly into Plethora's existing cross-source reconciliation, Sleep Chart, Learning Performance, Personal Patterns, and Dashboard Learning Insights without double-counting, pooling incompatible metrics, or fabricating missing stage timelines. Additionally, deleting an import batch must safely remove only records exclusively owned by that batch without destroying records still backed by another import batch or cloud/native sync.

## What Changes

- Track batch-level record ownership (`health_import_batch_items` or `import_batch_id` + shared provenance) so reimporting overlapping exports updates/links records idempotently and deleting one batch preserves records still referenced by another active batch or sync.
- Ensure `reconcile_all_sleep()` and `sleep_analytics.rs` respect `AggregateStageDurationsOnly` (e.g. WHOOP, Withings, RingConn): expose aggregate stage totals in Sleep Chart day inspector without synthesizing fake hypnogram intervals.
- Ensure `learning_analytics.rs` and `SleepLearningDashboardCard` immediately reflect newly committed imports via `useHealthStore.invalidate()` and preserve HRV method separation (`RMSSD` vs `SDNN`) and provider-specific recovery scales.
- Update `reconciliation.rs` to handle same-provider multi-route imports (e.g., Garmin export + Garmin cloud sync, Oura export + Oura cloud sync, WHOOP export + Apple Health mirror) without double-counting.

## Capabilities

### New Capabilities

- `wearable-import-provenance-reconciliation`: Idempotent batch provenance, safe batch deletion, cross-route deduplication, aggregate-only stage chart representation, and immediate analytics integration.

### Modified Capabilities

None.

## Impact

- **Dependencies:** Depends on `establish-universal-wearable-import-foundation`, `implement-primary-wearable-export-importers`, and `implement-secondary-wearable-export-importers`.
- **Native:** `src-tauri/src/health/db.rs`, `reconciliation.rs`, `sleep_analytics.rs`, `learning_analytics.rs`.
- **Frontend:** `src/components/health/SleepChartPanel.tsx` (aggregate stage totals display when `stages` is empty but `lightMins`/`deepMins`/`remMins` are present).
