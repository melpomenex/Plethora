## Tasks

- [x] D-T01 Implement nap classification hierarchy (user override > provider tag > duration/proximity heuristic) and sleep summary/distribution metrics in `src-tauri/src/health/sleep_analytics.rs`
- [x] D-T02 Implement circular bedtime/wake/midpoint statistics, missing-day accounting, stage coverage guard (`>= 0.70`), and Sleep Regularity Index (SRI) proxy
- [x] D-T03 Implement exploratory Borbély Two-Process (`Process S` + `Process C`) alertness curve with uncertainty band and non-clinical metadata
- [x] D-T04 Implement `health_get_sleep_chart_data` IPC query combining canonical sleep episodes, stage segments, daily HRV (`rmssd`/`sdnn` segregated) / RHR, and optional aligned learning-session markers
- [x] D-T05 Add comprehensive unit tests covering midnight circular wrap-around, DST nights, unstaged sleep, sparse SRI suppression, nap classification, and Borbély wakefulness decay
