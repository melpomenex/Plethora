## ADDED Requirements

### Requirement: Binary files use content-addressed object storage
Binary assets (PDFs, EPUBs, images, audio, generated media) SHALL NOT be embedded in normal sync record payloads. Files SHALL be referenced by cryptographic content hash (SHA-256, `sha256:…` prefix) with metadata (mime type, original filename, size) in synced entity records.

#### Scenario: Large PDF not in push payload
- **WHEN** a document binary is synced
- **THEN** the sync push batch contains only hash metadata and the bytes are uploaded through the blob pipeline

### Requirement: Blob upload uses deduplicated presigned direct upload
Before uploading bytes, the client SHALL call a blob check endpoint. If the hash already exists for the account, upload SHALL be skipped. Otherwise the client SHALL upload directly to object storage via a short-lived presigned URL and then reference the hash in entity sync records.

#### Scenario: Duplicate content skipped
- **WHEN** two documents share identical file bytes
- **THEN** only one object is stored and both records reference the same hash

#### Scenario: Presigned URL is account-scoped
- **WHEN** a presigned upload URL is issued
- **THEN** it is valid only for the authenticated account and expires within a short TTL

### Requirement: Blob download is lazy and integrity-verified
Devices SHALL download blob bytes on demand unless the user selects a prefetch policy. Downloads SHALL verify SHA-256 integrity after transfer and before exposing files to Plethora. Encrypted blobs SHALL be decrypted client-side after integrity verification.

#### Scenario: New device lazy download
- **WHEN** a new device completes metadata sync for a large library
- **THEN** document binaries are not downloaded until the user opens the document or enables prefetch

#### Scenario: Corrupt download rejected
- **WHEN** downloaded bytes do not match the expected hash
- **THEN** the download is discarded and retried without corrupting local references

### Requirement: Pro storage quota is enforced server-side
Each Pro account SHALL have a configurable storage quota (initial target 5–10 GB). The server SHALL reject blob uploads and optionally sync pushes that would exceed quota. Quota limits MUST be adjustable server-side without a client release.

#### Scenario: Quota exceeded blocks upload
- **WHEN** an upload would exceed the account quota
- **THEN** the server returns a quota error and the client surfaces a clear message while local files remain available
