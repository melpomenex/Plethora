## Context

Research into secondary wearable exports shows a sharp split between providers with structured consumer sleep CSVs (Samsung Health, Withings, RingConn) and those without (Polar, Suunto, Ultrahuman, Health Connect system backup).

## Goals / Non-Goals

- **Goals:**
  - Support Samsung Health multi-file CSV joining (`sleep` + `sleep_stage`) and handle Samsung's optional metadata header line (`com.samsung.health.sleep,...` version row before column headers).
  - Support Withings `sleep.csv` seconds-based stage totals (`AggregateStageDurationsOnly`) and session HR.
  - Support RingConn `sleep.csv` + `vitals.csv` daily summaries while clearly flagging date-only sleep summaries that lack exact bedtime/wake timestamps.
  - Support Polar `nightly_recovery_*.json` for RMSSD/ANS recovery while remaining truthful that sleep sessions are not in Polar's account export.
- **Non-Goals:**
  - Do not reverse-engineer internal Android Health Connect Room SQLite tables.
  - Do not present Suunto FIT/GPX workout exports as sleep support.

## Decisions

- **Truthful Registry States:** Every secondary provider in `ImportAdapterRegistry` carries an explicit `VerificationStatus` (`ImplementedFixtureTested`, `PartialRecoveryOnly`, `BridgeRequired`, `UnsupportedInternalFormat`) surfaced in Data Sources and Export Instructions.
