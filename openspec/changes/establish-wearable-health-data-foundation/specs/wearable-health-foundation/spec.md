## ADDED Requirements

### Requirement: Health data is stored in an isolated local vault
The system SHALL persist all wearable connections, consent logs, sleep sessions, sleep stage intervals, physiological observations, recovery observations, and source preferences inside an isolated SQLite WAL database (`<app_data_dir>/health/health.db`) separate from `plethora.db`. Health tables SHALL NOT be included in `plethora.db` migrations, `BackupManager` cloud backups, `sync_outbox`, or `semantic_chunks`.

#### Scenario: Health ingestion leaves plethora.db clean
- **WHEN** a user logs manual sleep or imports wearable data into the Health Vault
- **THEN** `health.db` contains the persisted records while `plethora.db` and `sync_outbox` remain unmodified

#### Scenario: Complete erasure removes all health data and credentials
- **WHEN** the user triggers `health_wipe_all_data`
- **THEN** all rows across every health table in `health.db` and all stored health provider OAuth tokens are deleted and the database is vacuumed

### Requirement: Every observation preserves full source provenance
The system SHALL retain `provider_id`, `device_id`, `external_record_id`, `source_app_bundle`, original units, `acquisition_at_ms`, measurement timestamps with timezone offsets, quality flags, and `sync_batch_id` on raw observations using composite uniqueness `(provider_id, external_record_id)`.

#### Scenario: Re-importing the same provider record is idempotent
- **WHEN** a provider import repeats an identical `(provider_id, external_record_id)` sleep session
- **THEN** the existing raw row is updated idempotently without creating duplicate canonical episodes or inflating total sleep duration

#### Scenario: Identical external IDs across different providers do not collide
- **WHEN** two distinct providers emit records with the same `external_record_id`
- **THEN** both raw observations remain stored cleanly under their respective `(provider_id, external_record_id)` keys

### Requirement: Cross-source reconciliation prevents double counting while honoring user source preference
The system SHALL cluster overlapping active sleep sessions into canonical episodes, select one primary session according to user-configured `health_source_preferences` followed by direct-source and stage-completeness tie-breakers, classify mirror exports versus independent multi-device measurements, and recompute canonical episodes when records are deleted or priorities change.

#### Scenario: Direct Oura sleep and Apple Health Oura mirror do not double count
- **WHEN** the same night's sleep arrives from `oura` directly and from `apple_healthkit` with matching boundaries or vendor bundle origin
- **THEN** a single `CanonicalSleepEpisode` is produced with one primary session and the mirror linked as `same_source_export_duplicate`, preserving single-night total duration

#### Scenario: Competing devices flag meaningful discrepancies without losing raw data
- **WHEN** `apple_healthkit` (Apple Watch) and `oura` record overlapping sleep differing by 45 minutes
- **THEN** both raw sessions remain preserved in `health_sleep_episode_members` (`independent_device_observation`), the canonical episode flags `has_source_conflict = true`, and changing preferred source updates the primary selection deterministically

### Requirement: Time, timezone, and DST calculations use instant arithmetic and biological anchor dates
The system SHALL compute sleep durations and awake intervals using UTC millisecond epoch differences and assign canonical `anchor_local_date` using the wake timezone offset (`end_at_ms + end_tz_offset_secs` for main sleep, start local date for naps).

#### Scenario: DST spring-forward night computes true elapsed duration
- **WHEN** a user sleeps from 23:00 to 07:00 local time across a spring-forward 23-hour day (`UTC-5` to `UTC-4`)
- **THEN** stored duration equals 420 minutes (7 hours) rather than 480 minutes

### Requirement: Manual sleep tracking, validated file imports, and encrypted portable bundles work offline
The system SHALL support manual sleep/nap CRUD, validated JSON, CSV, and Apple Health `export.xml` imports, passphrase-encrypted `.plethora-health.enc` export/import using PBKDF2-HMAC-SHA256 and AES-256-GCM, and an isolated synthetic demo dataset marked `is_synthetic = true` without requiring internet access or a wearable.

#### Scenario: Invalid or oversized import is rejected safely
- **WHEN** a user imports malformed XML, negative-duration CSV rows, or a file exceeding configured safety limits
- **THEN** the importer returns structured validation diagnostics without partial database writes

#### Scenario: Encrypted portable export transfers to desktop offline
- **WHEN** a user exports a `.plethora-health.enc` archive with a passphrase and imports it into a clean desktop vault with the matching passphrase
- **THEN** canonical sleep sessions and provenance are restored identically while a wrong passphrase fails decryption cleanly
