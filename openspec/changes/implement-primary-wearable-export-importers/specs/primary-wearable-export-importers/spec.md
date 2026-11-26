## ADDED Requirements

### Requirement: Garmin consumer export ingestion
The system SHALL detect and parse Garmin Account Data Management ZIP archives (`DI_CONNECT/DI-Connect-Wellness/*_sleepData.json`) and standalone Garmin sleep JSON files into `RawSleepSession`, `SleepStageInterval`, `PhysiologicalObservation`, and `RecoveryObservation` records with `provider_id = garmin` without requiring Garmin Health API credentials.

#### Scenario: Garmin sleep archive imports stages and scores locally
- **WHEN** a user selects a Garmin account export `.zip` containing `sleepData.json` with `sleepLevelsMap` and `sleepScores`
- **THEN** sleep sessions, stage intervals, respiration/SpO2 observations, and Garmin Sleep Score records are ingested with `provider_id = garmin`

### Requirement: Oura consumer export ingestion
The system SHALL detect and parse Oura Web export archives and standalone CSV/JSON files (`sleep.csv`, `daily_sleep.csv`, `daily_readiness.csv`), decoding `sleep_phase_5_min` stage strings into `SleepStageInterval` records and preserving Oura Sleep and Readiness scores.

#### Scenario: Oura 5-minute hypnogram and readiness score are preserved
- **WHEN** a user imports an Oura export containing `sleep.csv` with `sleep_phase_5_min` and `daily_readiness.csv`
- **THEN** 5-minute stage intervals (`1`=deep, `2`=light, `3`=rem, `4`=awake), RMSSD HRV, and Oura Readiness Score (`0..100`) are stored under `provider_id = oura`

### Requirement: WHOOP consumer export ingestion without synthetic hypnograms
The system SHALL detect and parse WHOOP export archives (`sleeps.csv` and `physiological_cycles.csv`), distinguishing physiological cycles from sleep sessions, importing stage duration totals with `AggregateStageDurationsOnly`, and never synthesizing fake stage intervals.

#### Scenario: WHOOP stage totals do not fabricate timeline intervals
- **WHEN** a user imports a WHOOP `sleeps.csv` with light, SWS, REM, and awake minute totals
- **THEN** `light_mins`, `deep_mins`, `rem_mins`, and `awake_mins` are populated with `stages` empty and `AggregateStageDurationsOnly` flagged

### Requirement: Google Health / Fitbit Takeout ingestion
The system SHALL detect and parse Google Takeout Fitbit archives (`sleep-*.json`, HRV CSVs, `sleep_score.csv`) and legacy Fitbit sleep JSON files, supporting both `stages` and `classic` sleep types and main sleep vs naps under `provider_id = google_health`.

#### Scenario: Multi-file Fitbit Takeout sleep history is consolidated
- **WHEN** a user imports a Google Takeout `.zip` containing multiple monthly `sleep-YYYY-MM-DD.json` files
- **THEN** all valid sleep and nap sessions and `levels.data` stage intervals are ingested idempotently under `provider_id = google_health`
