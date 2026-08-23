## ADDED Requirements

### Requirement: Document Ingestion SHALL converge on a Canonical Backend Pipeline
All document imports across desktop, mobile, share extension, and web downloads SHALL be processed through the canonical backend function (`import_from_path`). Large binary transfers over JSON IPC (`Array.from(Uint8Array)`) SHALL NOT be used for normal document ingestion.

#### Scenario: Mobile file picker imports via bounded staging
- **WHEN** a user on iOS or Android selects a 30MB PDF via the file picker
- **THEN** the file is staged in chunks of at most 256KB to application-private storage and ingested via `import_from_path` without exceeding 50MB of heap allocation or stalling the IPC bridge

### Requirement: Document Import Errors SHALL be typed and structured
When a document cannot be imported, the backend SHALL return a structured `ImportError` containing an `ImportErrorCode`. The system SHALL NOT return generic `NotFound` errors for duplicate documents, encrypted files, or corrupted archives.

#### Scenario: Duplicate document rejected with typed error
- **WHEN** a document with an identical content hash to an existing library document is imported
- **THEN** the backend returns `ImportErrorCode::DuplicateDocument` and the frontend surfaces an actionable notification referencing the existing document title

#### Scenario: Password-protected PDF rejected cleanly
- **WHEN** an encrypted or password-protected PDF is imported
- **THEN** the parser rejects the file with `ImportErrorCode::EncryptedDocument` without panicking or creating an empty database record

### Requirement: Document Persistence SHALL be transactional with automatic cleanup
Document creation, metadata insertion, and initial extract generation SHALL execute inside an atomic SQLite transaction. Incomplete, failed, or cancelled imports SHALL NOT leave partial database rows or orphaned temporary files.

#### Scenario: Process killed or import fails mid-extraction
- **WHEN** document extraction fails due to a malformed file structure
- **THEN** the database transaction rolls back, temporary staging files in `<app_data>/imports/` are deleted, and the frontend store resets `isImporting` to false

### Requirement: Robustness Fixture Invariant SHALL be enforced
The application SHALL satisfy the core robustness invariant across all supported and malformed file inputs: *Plethora may successfully import the input or reject it with a typed, user-readable error, but it SHALL NOT crash, panic, deadlock, corrupt persistent state, or leave an unusable partial document.*

#### Scenario: Malformed EPUB missing container XML
- **WHEN** an EPUB missing `META-INF/container.xml` is processed
- **THEN** the parser returns `ImportErrorCode::InvalidDocument` without crashing or panicking, and the app remains fully responsive
