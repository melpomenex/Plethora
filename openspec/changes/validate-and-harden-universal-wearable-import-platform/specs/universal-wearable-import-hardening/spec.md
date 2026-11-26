## ADDED Requirements

### Requirement: Archive and parser security verification
The system SHALL pass automated security tests covering ZIP Slip path traversal, absolute paths, symlink entries, ZIP bombs, excessive entry counts, duplicate paths, XML XXE/DTD attacks, and CSV formula injection with zero partial writes.

#### Scenario: Security test suite blocks all malformed and malicious inputs
- **WHEN** the archive and parser security test suite runs
- **THEN** every malicious fixture is rejected cleanly and `health.db` remains empty

### Requirement: Measured large-file streaming performance
The system SHALL benchmark streaming ingestion of a synthetic multi-year Apple Health export exceeding 50 MB and record measured processing time, throughput, and memory behavior.

#### Scenario: Large Apple Health export benchmark completes within bounded memory
- **WHEN** the >50 MB Apple Health XML streaming benchmark executes
- **THEN** all records are ingested with bounded streaming buffers and measured throughput is recorded

### Requirement: Optional opt-in local recurring folder import
The system SHALL allow desktop users to opt into monitoring a single user-selected folder for new wearable exports without scanning parent/home directories, deleting source files, or duplicating previously imported files.

#### Scenario: Opt-in watched folder imports new export once
- **WHEN** a desktop user enables local folder monitoring for a chosen folder containing a stable wearable export
- **THEN** the export is imported idempotently once and the original file on disk is left untouched
