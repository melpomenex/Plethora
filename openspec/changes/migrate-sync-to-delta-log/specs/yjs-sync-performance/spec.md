## MODIFIED Requirements

### Requirement: Batched Sync Replay on Boot
The system SHALL verify and replay incoming sync records during startup synchronization in batches to avoid flooding the database and locking the local SQLite file. This requirement is transport-neutral: it applies to records replayed from the CRDT document during migration and to records pulled from the delta log afterwards.

#### Scenario: Startup sync processing
- **WHEN** the sync subsystems initialize on application boot
- **THEN** the system fetches and checks the existence and versions of sync records in SQLite in batches rather than querying the database individually for every key.

#### Scenario: Startup sync over the delta log
- **WHEN** startup synchronization retrieves records from the delta log
- **THEN** the system SHALL project each retrieved page in batched database writes rather than one write per record
- **THEN** the system SHALL complete a page's projection before advancing the stored cursor
