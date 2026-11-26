## 1. Primary Provider Adapters

- [x] 1.1 Implement Garmin consumer export adapter (`garmin.rs`) for `DI_CONNECT/DI-Connect-Wellness/*_sleepData.json` and standalone Garmin sleep JSON.
- [x] 1.2 Implement Oura consumer export adapter (`oura.rs`) for Oura Web ZIP and `sleep.csv` / `daily_sleep.csv` / `daily_readiness.csv` / JSON exports.
- [x] 1.3 Implement WHOOP consumer export adapter (`whoop.rs`) for WHOOP export ZIP (`sleeps.csv`, `physiological_cycles.csv`) preserving aggregate-only stage semantics.
- [x] 1.4 Implement Google Health / Fitbit Takeout adapter (`google_fitbit.rs`) for `Takeout/Fitbit/Global Export Data/sleep-*.json`, HRV CSVs, and `sleep_score.csv`.
- [x] 1.5 Add sanitized fixtures and parser unit tests for all four primary providers covering valid, multi-file, nap, timezone, and malformed inputs.
