## Why

Garmin, Oura, WHOOP, and Google Health / Fitbit are the primary wearable ecosystems used by Plethora learners, yet commercial APIs for Garmin and Google Health are approval-gated or require OAuth verification. Users already have legal access to their personal consumer exports (Garmin Account Data Management ZIP, Oura Web CSV/JSON export, WHOOP Data Export ZIP, and Google Takeout Fitbit JSON/CSV archive) and must be able to import them locally without API credentials or manual conversion.

## What Changes

- Implement native consumer export adapters in `src-tauri/src/health/importers/`:
  - `garmin.rs`: Parses Garmin GDPR/account data ZIP (`DI_CONNECT/DI-Connect-Wellness/*_sleepData.json`, `UDSFile_*.json`, biometrics where present) and standalone `*_sleepData.json`, preserving stages (`sleepLevelsMap` / `sleepLevels`), stage totals, sleep scores, SpO2, respiration, and resting HR/HRV where present.
  - `oura.rs`: Parses Oura Web export ZIP and standalone `sleep.csv` / `daily_sleep.csv` / `daily_readiness.csv` / Oura JSON exports, decoding `sleep_phase_5_min` (`1`=Deep, `2`=Light, `3`=REM, `4`=Awake), naps, latency, efficiency, resting/lowest HR, average HRV, respiratory rate, temperature deviation, and Oura Sleep/Readiness scores.
  - `whoop.rs`: Parses WHOOP export ZIP (`sleeps.csv`, `physiological_cycles.csv`) and standalone CSVs, distinguishing physiological cycles from sleep records, preserving stage totals (`AggregateStageDurationsOnly` without fabricating hypnograms), sleep performance, sleep need/debt, recovery score, HRV (RMSSD), RHR, SpO2, skin temp, and respiratory rate.
  - `google_fitbit.rs`: Parses Google Takeout (`Takeout/Fitbit/Global Export Data/sleep-*.json`, `heart_rate-*.json`, `resting_heart_rate-*.json`, `Daily Heart Rate Variability Summary*.csv`, `sleep_score.csv`) and standalone Fitbit sleep JSON/CSV files, supporting `stages` and `classic` schemas, main sleep vs naps, and `levels.data` timelines.

## Capabilities

### New Capabilities

- `primary-wearable-export-importers`: Native consumer export adapters for Garmin, Oura Ring, WHOOP, and Google Health / Fitbit archives and standalone files.

### Modified Capabilities

None.

## Impact

- **Dependencies:** Depends on `establish-universal-wearable-import-foundation` and `implement-secure-health-archive-ingestion`.
- **Native:** `src-tauri/src/health/importers/{garmin,oura,whoop,google_fitbit}.rs` and registration in `registry.rs`.
- **Semantic Integrity:** Never synthesizes stage timelines from WHOOP aggregate totals; never pools Oura/WHOOP/Garmin proprietary scores; never misinterprets WHOOP cycle boundaries as sleep boundaries.
