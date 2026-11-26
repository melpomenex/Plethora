## Context

Consumer export schemas differ materially from vendor REST API v2/v4 responses:
- Garmin GDPR exports use `DI_CONNECT/DI-Connect-Wellness/*_sleepData.json` with seconds-based durations and `sleepLevelsMap` or `sleepLevels`.
- Oura Web exports use `sleep.csv` (seconds durations, ISO-8601 with offset, `sleep_phase_5_min` digit string) alongside `daily_sleep.csv` and `daily_readiness.csv`.
- WHOOP exports separate `sleeps.csv` (with `Nap` boolean and minute stage totals, no per-epoch hypnogram) from `physiological_cycles.csv` (recovery %, HRV RMSSD, RHR, skin temp, SpO2).
- Google Takeout Fitbit exports shard monthly `sleep-YYYY-MM-DD.json` files with millisecond `duration`, `isMainSleep`, and `levels.data` arrays.

## Goals / Non-Goals

- **Goals:**
  - Parse only verified fields present in each consumer export format.
  - Tag WHOOP sessions with `SleepQualityFlag::AggregateStageDurationsOnly` when only stage totals are present.
  - Tag Oura/WHOOP/Fitbit HRV as `HrvMethod::Rmssd` when documented as RMSSD, and preserve provider-specific recovery/sleep scores with explicit `score_name`, `scale_min`, `scale_max`.
- **Non-Goals:**
  - Do not claim workout FIT files contain sleep records.
  - Do not require Garmin/Google commercial API approval or OAuth tokens for local file imports.

## Decisions

- **Multi-file Archive Joining:** Each primary adapter inspects all relevant entries in a ZIP (e.g., WHOOP `sleeps.csv` + `physiological_cycles.csv`; Oura `sleep.csv` + `daily_sleep.csv` + `daily_readiness.csv`; Fitbit `sleep-*.json` + `sleep_score.csv` + HRV CSVs) and emits a unified `NormalizedIngestionBatch` under the true `HealthProviderId`.
- **Timestamp & Offset Handling:** Where Fitbit `sleep-*.json` emits local-looking ISO timestamps without an explicit offset (`2026-05-11T23:15:00.000`), surface a timezone assumption warning and apply user-confirmed or explicit offset rather than silently assuming UTC if ambiguous.
