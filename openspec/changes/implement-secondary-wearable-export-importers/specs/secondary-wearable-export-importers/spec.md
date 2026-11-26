## ADDED Requirements

### Requirement: Samsung Health, Withings, and RingConn consumer export ingestion
The system SHALL detect and parse verified consumer exports from Samsung Health (`com.samsung.health.sleep*.csv` + `sleep_stage*.csv`), Withings (`sleep.csv`), and RingConn (`sleep.csv` + `vitals.csv`) while preserving true provider identity and stage/duration semantics.

#### Scenario: Samsung Health sleep and stage CSVs join into staged sleep sessions
- **WHEN** a user imports a Samsung Health export archive containing matching sleep and sleep_stage CSVs
- **THEN** sleep sessions include normalized stage intervals and `provider_id = samsung_health`

### Requirement: Truthful handling of partial or unavailable consumer sleep exports
The system SHALL parse Polar `nightly_recovery_*.json` for HRV/recovery when present while reporting missing sleep timelines, SHALL classify workout-only Suunto FIT/GPX files as `NoUsableSleepData`, and SHALL classify Android Health Connect internal SQLite backups as `RecognizedUnsupported` with native-sync / `.plethora-health.enc` guidance.

#### Scenario: Workout-only or internal backup file is never misreported as a sleep import
- **WHEN** a user selects a Suunto workout `.fit`/`.gpx` or an Android `Health Connect.zip` internal backup
- **THEN** the system explains why sleep cannot be imported from that file and offers the verified native bridge or portable bundle workflow
