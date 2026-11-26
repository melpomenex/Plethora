## 1. Secondary Provider Adapters & Truthful Fallbacks

- [x] 1.1 Implement Samsung Health CSV/ZIP adapter (`samsung_health.rs`) joining `sleep` and `sleep_stage` CSVs.
- [x] 1.2 Implement Withings `sleep.csv` / ZIP adapter (`withings.rs`) with non-medical framing.
- [x] 1.3 Implement RingConn `sleep.csv` + `vitals.csv` ZIP adapter (`ringconn.rs`).
- [x] 1.4 Implement Polar `nightly_recovery_*.json` adapter (`polar.rs`) with explicit sleep-export limitation notice.
- [x] 1.5 Add honest detection rules for Suunto workout exports, Ultrahuman, and Android Health Connect internal SQLite backups.
- [x] 1.6 Add sanitized fixtures and unit tests for Samsung, Withings, RingConn, Polar, and unsupported/workout-only detections.
