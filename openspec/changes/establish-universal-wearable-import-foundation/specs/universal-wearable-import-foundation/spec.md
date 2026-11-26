## ADDED Requirements

### Requirement: Deterministic content-based format detection
The system SHALL inspect file signatures, archive directory structures, XML root elements, JSON object shapes, and CSV headers deterministically without an LLM to classify user-selected exports into `Confident`, `Probable`, `Ambiguous`, `Unknown`, `RecognizedUnsupported`, or `NoUsableSleepData` results.

#### Scenario: Extension mismatch does not misclassify provider data
- **WHEN** a user selects a valid Garmin `sleepData.json` file or Oura `sleep.csv` file
- **THEN** the detector identifies the actual provider from content structure rather than collapsing it to `file_import`

#### Scenario: Ambiguous or unrecognized file requests user selection
- **WHEN** a CSV file has generic headers that do not uniquely match a known provider schema
- **THEN** the detector returns `Unknown` or `Ambiguous` and routes the user to provider selection or the CSV Column Mapping Wizard without silently assigning a wearable provider

### Requirement: Non-committing import preview and user confirmation
The system SHALL generate an `ImportPreview` (detected provider, format, date range, record counts, estimated duplicates/updates, missing fields, timezone assumptions, and warnings) before any write transaction is committed to `health.db`.

#### Scenario: Previewing an export leaves the Health Vault unmodified
- **WHEN** a user runs import preview on a valid or partially invalid export and cancels before confirming
- **THEN** zero records are inserted or updated in `health.db`

### Requirement: Provider identity is preserved across file imports
The system SHALL record the actual wearable `HealthProviderId` alongside `AcquisitionMethod::FileImport` in `health_import_batches` and raw observation tables so Garmin, Oura, WHOOP, Google Health, Samsung, Withings, and RingConn file imports remain distinguishable.

#### Scenario: Garmin file import retains Garmin provider attribution
- **WHEN** a user imports a Garmin Connect export archive
- **THEN** persisted sleep and physiological records carry `provider_id = garmin` and `acquisition_method = file_import`
