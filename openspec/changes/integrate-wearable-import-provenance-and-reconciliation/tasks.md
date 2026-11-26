## 1. Provenance, Reconciliation & Analytics Integration

- [x] 1.1 Track batch-to-record provenance in `health_import_batch_records` and implement safe reference-counted `delete_import_batch`.
- [x] 1.2 Update `reconciliation.rs` `compute_stage_metrics` to preserve aggregate stage totals (`light_mins`, `deep_mins`, `rem_mins`, `awake_mins`) when `stages` is empty without inflating `stage_coverage_ratio`.
- [x] 1.3 Update `SleepChartPanel.tsx` day inspector to display summary stage totals cleanly when `stages` is empty and aggregate stage totals are present.
- [x] 1.4 Verify cross-route deduplication (file import + cloud/native sync) and immediate Learning Insights / Dashboard card refresh after import or batch deletion.
