## ADDED Requirements

### Requirement: Document Deletion Sync via Tombstones
The system SHALL synchronize document deletions across devices by writing tombstone markers to the shared Yjs documents map.

#### Scenario: Local document deletion
- **WHEN** the user deletes a document from the library
- **THEN** the system SHALL delete the document from SQLite and write a tombstone marker to the shared Yjs `documents` map

#### Scenario: Remote document deletion
- **WHEN** the system receives a remote document update that is a tombstone marker
- **THEN** the system SHALL delete the corresponding document from SQLite and clean up any local file-sync registrations and cached files
