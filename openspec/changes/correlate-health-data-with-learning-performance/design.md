## Context

`review_results` records `rating` (`1..4`), `time_taken` (seconds), and `reviewed_at_ms` without persisting pre-review `predicted_retrievability`. `exam_attempts` distinguishes `mode` (`exam|practice|diagnostic`) and `exam_grades` marks `state = 'final'` and `is_current = 1`.

## Goals / Non-Goals

- **Goals:**
  - Zero future leakage in FSRS-7 residual calculation.
  - Confounder control separating item difficulty, circadian time-of-day, and prior study fatigue from sleep duration / time-awake effects.
  - Honest suppression when data is sparse, constant (sleep SD < 0.5h), low-coverage (<50%), or fails to outperform simple held-out baselines.
- **Non-Goals:**
  - Mutating FSRS review intervals, postponing items, or altering exam grading based on sleep correlations.
  - Sending user health observations or residuals to an LLM to invent narratives.

## Decisions

### Chronological Per-Item FSRS-7 Replay
For every `item_id` ordered by `reviewed_at_ms ASC`, `current_retrievability(&state_prev, elapsed_days)` runs BEFORE `next_states_fractional` updates `state`. This guarantees zero leakage of future reviews or final stability into historical predictions.

### Heuristic Sufficiency Thresholds
Explicitly encode and return thresholds (`min_paired_reviews = 60`, `min_sessions = 12`, `min_distinct_days = 10`, `min_sleep_sd_hours = 0.5`, `min_coverage_ratio = 0.50`, `min_bucket_sessions = 5`, `min_bucket_reviews = 20`) inside the payload so users see exact sufficiency requirements and progress rather than opaque black-box cutoffs.

### Temporal Held-Out Validation
Models proposing Learning Windows or sleep predictors train on the earliest 70% of sessions chronologically and evaluate RMSE on the latest 30%, requiring out-of-sample RMSE improvement over constant baseline `M0` (and `M1` for sleep predictors) before claiming predictive utility.
