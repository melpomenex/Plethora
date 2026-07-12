## ADDED Requirements

### Requirement: Native mobile PDFs load without WebView fetch dependency
The system SHALL open a local PDF on native mobile through an application-controlled byte source and SHALL NOT require PDF.js to fetch a Tauri asset URL in order to read the document.

#### Scenario: Open a valid imported PDF on native mobile
- **WHEN** a user opens a valid, locally available PDF on Android or iOS
- **THEN** the system supplies PDF.js with document bytes through the native mobile source
- **AND** the PDF opens without depending on WebView custom-protocol fetch or CORS behavior

### Requirement: Mobile PDF access is memory-bounded
The system SHALL read large native-mobile PDFs in bounded ranges and SHALL NOT allocate the complete source file in the WebView for files above the configured safe-file threshold.

#### Scenario: Open a large PDF
- **WHEN** a user opens a PDF larger than the configured safe-file threshold
- **THEN** the system reads bounded byte ranges on demand
- **AND** the WebView does not receive a whole-file base64 string or whole-file byte array

#### Scenario: PDF.js repeats or overlaps range requests
- **WHEN** PDF.js requests duplicate, overlapping, or adjacent byte ranges
- **THEN** the system coalesces or reuses in-flight/cached reads where practical
- **AND** range concurrency and response size remain bounded

### Requirement: Native range reads are authorized and consistent
The system MUST validate document ownership, canonical path, requested range, file identity, and maximum response size before returning PDF bytes.

#### Scenario: A valid range is requested
- **WHEN** the active viewer requests a byte range within its authorized PDF
- **THEN** the system returns exactly the requested available bytes with the current file identity

#### Scenario: An invalid or stale range is requested
- **WHEN** a request targets an unauthorized path, an invalid range, an oversized range, or a file whose identity changed after opening
- **THEN** the system rejects the request with a typed error
- **AND** it returns no unrelated file bytes

### Requirement: PDF source failures have actionable recovery
The system SHALL classify local PDF opening failures and present a recovery action appropriate to the failure instead of exposing a raw browser `Failed to fetch` message as the primary error.

#### Scenario: Local file is missing or not synced
- **WHEN** the document record exists but its PDF file is absent on the device
- **THEN** the reader identifies the file as missing or not synced
- **AND** offers download, locate, or retry actions that are available for that document

#### Scenario: PDF is encrypted
- **WHEN** PDF.js reports that the PDF requires a password
- **THEN** the reader requests the password through a secure mobile-friendly prompt
- **AND** distinguishes an incorrect password from a corrupt or unsupported document

#### Scenario: PDF is corrupt or unsupported
- **WHEN** the native source is readable but parsing fails
- **THEN** the reader explains that the file is corrupt or unsupported
- **AND** offers retry, diagnostic details, and an external/open-original action when available

### Requirement: Mobile PDF loading is cancellable and observable
The system SHALL cancel outstanding source work when the document changes or the viewer closes and SHALL expose non-content diagnostics for load performance and failure category.

#### Scenario: User leaves during loading
- **WHEN** the user closes or switches away from a PDF while range requests are active
- **THEN** the system cancels or ignores outstanding reads
- **AND** no stale result is applied to the next document

#### Scenario: User copies diagnostics
- **WHEN** a user requests diagnostic details after a PDF load failure
- **THEN** the system provides source strategy, size bucket, timing, and normalized error category
- **AND** omits file paths, filenames, extracted text, and page imagery

