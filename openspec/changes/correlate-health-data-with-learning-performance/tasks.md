## Tasks

- [x] E-T01 Implement read-only `plethora.db` telemetry loader (`review_results`, `learning_items`, `exam_attempts`, `exam_grades`, `study_plans`, `reading_sessions`) in `src-tauri/src/health/telemetry.rs`
- [x] E-T02 Implement chronological zero-leakage FSRS-7 replay, winsorized log-latency, and timestamp-aligned 30-minute session clustering
- [x] E-T03 Implement OLS multiple regression solver, day-clustered block bootstrap CIs, Benjamini-Hochberg FDR correction, and matched nap vs non-nap comparison in `src-tauri/src/health/statistics.rs`
- [x] E-T04 Implement mode-separated assessment correlations, temporal 70/30 held-out baseline validation (`M0`–`M5`) for Learning Windows, and explainable insight generation with overclaim guard in `src-tauri/src/health/learning_analytics.rs`
- [x] E-T05 Wire `health_get_learning_insights` and `health_get_study_plan_insights` Tauri IPC commands in `src-tauri/src/commands/health.rs`
- [x] E-T06 Build and verify the full 15-scenario synthetic statistical validation test suite (no correlation, positive/negative, item difficulty confound, circadian confound, small sample, constant sleep, missing data, outliers, duplicates, autocorrelation, FSRS changes, topic difficulty, incomplete assessments, failed baseline validation)
