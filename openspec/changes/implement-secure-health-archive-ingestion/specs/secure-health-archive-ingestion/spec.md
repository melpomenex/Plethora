## ADDED Requirements

### Requirement: Safe archive inspection and selective streaming
The system SHALL inspect `.zip` archives from disk via streaming I/O, locate only relevant health entries, ignore unrelated account files, and stream matching entries through bounded readers without extracting the full archive to disk.

#### Scenario: Legitimate multi-file wearable archive is read selectively
- **WHEN** a user selects a wearable export `.zip` containing both sleep/biometric files and unrelated profile/media files
- **THEN** only the relevant health entries are decompressed and parsed, and unrelated files are skipped

### Requirement: Archive attack defenses
The system SHALL reject archives containing path traversal (`..`), absolute paths, Windows drive/UNC prefixes, Unix symlink entries, duplicate normalized paths, nested archives, or entries exceeding configured entry-count, expanded-size, or compression-ratio budgets before committing any records.

#### Scenario: ZIP Slip or ZIP bomb archive is rejected safely
- **WHEN** a user attempts to import an archive containing `../../etc/passwd`, a symlink entry, or a high-ratio compression bomb
- **THEN** the archive subsystem aborts with an actionable security error and writes zero records to `health.db`
