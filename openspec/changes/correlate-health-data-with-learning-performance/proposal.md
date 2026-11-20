## Why

Raw recall percentages mislead when learners review easier cards on short sleep or take harder exams at different times of day. Plethora's FSRS-7 review log, Study Plans, assessments, and reading sessions already capture rich learning telemetry in `plethora.db`. Combining timestamp-aligned sleep/physiological context with zero-leakage FSRS-7 residuals, confounder controls, cluster-robust inference, and temporal held-out predictive validation reveals trustworthy personal study-performance patterns while suppressing spurious claims.

## What Changes

- Implement read-only learning telemetry loader (`src-tauri/src/health/telemetry.rs`) reading `review_results`, `learning_items`, `exam_attempts`, `exam_grades`, `study_plans`, `learning_evidence`, and `reading_sessions` from `plethora.db` without mutating any learning or scheduler table.
- Implement chronological per-item FSRS-7 replay (`src-tauri/src/algorithms/fsrs7/mod.rs`) computing `predicted_retrievability` strictly before each review rating (`observed_recall - predicted_retrievability`) and winsorized log-latency metrics.
- Implement timestamp-based session clustering and sleep attribution (preceding main sleep within 36h, elapsed hours awake, recent naps, 7-day regularity, overnight HRV with segregated RMSSD/SDNN, RHR, prior 24h workload, Study Plan scoping).
- Implement confounder-adjusted OLS multiple regression (`sin/cos` time-of-day, item difficulty, prior workload), deterministic 500-resample day-clustered block bootstrap CIs, Benjamini-Hochberg FDR adjustment, matched nap vs non-nap comparisons, and mode-separated assessment analyses (`exam` vs `practice`/`diagnostic`, first-attempt vs retake).
- Implement **Learning Windows** with temporal 70/30 held-out baseline validation (`M0` constant, `M1` time-of-day, `M2` recent trend, `M3–M5` sleep/wake/HRV), downgrading unvalidated models to `descriptive_only` or `"There is not enough reliable data to identify a pattern."`
- Implement explainable `PersonalInsight` generation with neutral observational prose, full statistical provenance, and prohibited-overclaim verification, tested against all 15 synthetic statistical scenarios.

## Capabilities

### New Capabilities

- `wearable-learning-intelligence`: Read-only learning telemetry integration, zero-leakage FSRS-7 replay, confounder-adjusted correlation & cluster bootstrap engine, mode-separated assessment analysis, baseline-validated Learning Windows, and explainable insight generation.

### Modified Capabilities

None.

## Impact

- **Native:** `src-tauri/src/health/{telemetry.rs,statistics.rs,learning_analytics.rs}`, IPC commands `health_get_learning_insights` and `health_get_study_plan_insights`.
- **Scheduler & Grading Integrity:** Strictly read-only against `plethora.db`; never alters `due_date`, `memory_state_*`, `exam_grades`, or Queue ordering.
- **LLM Independence:** Entire statistical pipeline runs deterministically in Rust without calling any LLM.
