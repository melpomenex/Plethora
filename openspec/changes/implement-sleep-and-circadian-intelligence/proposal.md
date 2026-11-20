## Why

Raw sleep records alone do not answer how consistent a learner's sleep timing is, how naps fit into their 24-hour wake profile, or how long they have been awake before studying. Computing accurate circular timing statistics, sleep-stage coverage guards, regularity proxies, and an explicitly non-clinical Borbély two-process alertness curve turns canonical sleep episodes into trustworthy inputs for both the Sleep Chart and learning correlation analytics.

## What Changes

- Implement deterministic nap classification and user sleep-kind override propagation (`main_sleep` vs `nap`).
- Implement sleep duration, time-in-bed, efficiency, WASO, stage-coverage ratio (`>= 0.70` required before reporting stage percentages), rolling averages (`7d`, `14d`, `30d`, `90d`), histograms, and missing-day coverage metrics.
- Implement circular statistics (`cos`/`sin` mean and circular SD in minutes) for sleep onset, wake time, and sleep midpoint, plus Sleep Regularity Index (SRI) proxy (Phillips et al. 2017) and weekend/weekday social-jetlag proxy.
- Implement an exploratory Borbély Two-Process alertness curve (`Process S` + `Process C` anchored to personal sleep midpoint) with explicit uncertainty bounds and non-clinical proxy disclosure.
- Expose `health_get_sleep_chart_data` returning daily tracks, canonical episodes, stages, naps, missing-data markers, HRV (`rmssd`/`sdnn` segregated), RHR, alertness curve, and aligned study session markers.

## Capabilities

### New Capabilities

- `sleep-circadian-analytics`: Deterministic sleep architecture aggregation, non-fabrication stage coverage rules, circular timing statistics, SRI proxy, Borbély exploratory two-process alertness curve, and Sleep Chart payload projection.

### Modified Capabilities

None.

## Impact

- **Native:** `src-tauri/src/health/sleep_analytics.rs`, IPC command `health_get_sleep_chart_data` in `src-tauri/src/commands/health.rs`.
- **Scientific Constraints:** Missing stages stay `null` (`None`) rather than imputed; RMSSD and SDNN HRV values are never pooled; alertness curve carries explicit uncertainty and `isClinical: false`.
