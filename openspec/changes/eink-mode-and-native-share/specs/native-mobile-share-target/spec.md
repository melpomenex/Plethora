## ADDED Requirements

### Requirement: Android Share Target Registration and Intent Handling
The Android application SHALL register native intent filters for `Intent.ACTION_SEND` and `Intent.ACTION_SEND_MULTIPLE` supporting `text/plain`, `text/html`, `application/pdf`, `application/epub+zip`, `application/octet-stream`, `image/*`, `audio/*`, and `video/*`. When shared to Incrementum, the application SHALL receive and process the intent regardless of whether the application is cold-started, warm-started in the background, or currently displaying active reader content.

#### Scenario: Sharing a URL from Android browser
- **WHEN** the user shares an HTTP/HTTPS URL from a browser (such as Chrome or Firefox) to Incrementum
- **THEN** Incrementum SHALL appear as a valid share destination
- **AND** the URL SHALL be received by the application and routed into Incrementum's URL import pipeline.

#### Scenario: Sharing a PDF document while app is closed (Cold Start)
- **WHEN** Incrementum is completely closed and an external file manager shares a PDF via `ACTION_SEND`
- **THEN** the Android native layer SHALL safely stage the shared `content://` URI into app-private storage
- **AND** queue the pending payload until the frontend and SQLite database finish startup initialization
- **AND** process the staged file into a new document record.

#### Scenario: Receiving multiple shares while app is running (Warm Start & Repeated Shares)
- **WHEN** Incrementum is already running in the background and a new share intent arrives via `onNewIntent`
- **THEN** Incrementum SHALL accept the new payload without requiring an application restart
- **AND** dispatch the share payload to the frontend import listener immediately.

### Requirement: Content URI Safety and Native Staging
The system SHALL NOT pass raw ephemeral `content://` URIs or entire multi-megabyte base64 strings across the JavaScript IPC bridge. Instead, the native layer (Kotlin on Android / Swift on iOS) SHALL:
1. Open the content resolver stream using granted read permissions.
2. Resolve the true display name and MIME type.
3. Stream the file bytes directly into a unique file under `<filesDir>/imports/`.
4. Pass only the staged filesystem path, relative path, and filename metadata to the Rust and TypeScript layers.

#### Scenario: Secure staging of temporary content provider URIs
- **WHEN** an external app shares a file with temporary read permissions
- **THEN** the native layer SHALL copy the stream to app-private storage before the granting activity closes
- **AND** the staged copy SHALL remain readable by Rust's file operations.

### Requirement: Normalized Shared Payload Abstraction
The system SHALL normalize all platform-specific share data (Android Intents, iOS NSItemProviders, PWA share queries) into a unified TypeScript interface `SharedPayload` supporting `url`, `text`, `file`, and `mixed` (text + URL) kinds.

#### Scenario: Shared text with source URL provenance
- **WHEN** an external application shares highlighted text together with the source webpage URL
- **THEN** the system SHALL create a normalized payload containing both `text` and `url`
- **AND** route the import to preserve the excerpt content while linking the original source provenance URL.

### Requirement: Integration with Existing Import Pipelines and Batch Processing
Incoming shared content SHALL route directly into Incrementum's existing document and URL import logic. No separate duplicate document models or unverified parser routines SHALL be introduced. The system SHALL support multiple shared files, providing per-item progress and fault tolerance where a single corrupt item does not abort the remaining imports.

#### Scenario: Sharing multiple documents simultaneously
- **WHEN** the user shares 3 PDF files in a single `ACTION_SEND_MULTIPLE` intent
- **THEN** the system SHALL stage all 3 files
- **AND** import each file through `importFromFiles`
- **AND** surface a summary toast indicating the count of successfully imported documents.

### Requirement: Offline Shared URL Preservation
When a URL is shared to Incrementum while the device lacks internet connectivity, the system SHALL NOT drop or fail the share silently. The system SHALL store the URL locally as a pending import and allow the user or background sync to trigger content retrieval once connectivity is restored.

#### Scenario: Preserving offline URL share
- **WHEN** a URL is shared while offline
- **THEN** Incrementum SHALL persist the URL into the local queue marked as pending
- **AND** display a toast confirming the link was saved offline for deferred fetch.

### Requirement: iOS Share Extension Integration Architecture
On iOS, the application SHALL provide a Share Extension contract supporting text, URL, and document payloads staged into a shared App Group container, allowing Incrementum Mobile to consume pending payloads upon activation.

#### Scenario: iOS App Group staging handoff
- **WHEN** content is shared to the Incrementum iOS Share Extension
- **THEN** the extension SHALL stage the normalized payload in the App Group shared container
- **AND** the main Incrementum app SHALL read and consume the staged payload exactly once when foregrounded.
