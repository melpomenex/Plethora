## ADDED Requirements

### Requirement: Extract count persists to the database on create and delete
The system SHALL keep `documents.extract_count` synchronized with the actual number of extracts belonging to that document whenever an extract is created or deleted, persisted in the database (not only in in-memory client state).

#### Scenario: Creating an extract increments the persisted count
- **WHEN** a user creates a new extract for a document
- **THEN** `documents.extract_count` for that document SHALL be incremented and persisted in the database in the same operation

#### Scenario: Deleting an extract decrements the persisted count
- **WHEN** a user deletes an extract belonging to a document
- **THEN** `documents.extract_count` for that document SHALL be decremented (not below zero) and persisted in the database in the same operation

#### Scenario: Extract count survives reload
- **WHEN** a document's extracts are created in one session and the document list is reloaded (e.g. switching collections, paginating, or restarting the app)
- **THEN** the document's extract count SHALL reflect all extracts actually created, not just those created since the last reload

### Requirement: Existing extract count drift is corrected on upgrade
The system SHALL provide a one-time migration that recalculates `documents.extract_count` for all existing documents from the actual `extracts` table, correcting any prior drift.

#### Scenario: Backfill corrects stale counts
- **WHEN** the migration runs against a database where `documents.extract_count` does not match the real number of `extracts` rows for a document
- **THEN** `documents.extract_count` SHALL be updated to equal `COUNT(*)` of that document's `extracts` rows

### Requirement: Compact View "Has extracts" signal reflects actual extract counts
The Compact View Signals filter "Has extracts" SHALL list exactly the documents whose persisted extract count is greater than zero, and its displayed count badge SHALL match the number of documents shown when the filter is active.

#### Scenario: Document with extracts appears under "Has extracts"
- **WHEN** a document has one or more extracts and the user selects the "Has extracts" Signals filter in Compact View
- **THEN** that document SHALL appear in the filtered list

#### Scenario: Document without extracts is excluded
- **WHEN** a document has zero extracts and the user selects the "Has extracts" Signals filter in Compact View
- **THEN** that document SHALL NOT appear in the filtered list

#### Scenario: EXTRACTS column matches filter results
- **WHEN** the Compact View table renders the EXTRACTS column for a document
- **THEN** the displayed count SHALL match the value used by the "Has extracts" filter and by sorting by extracts
