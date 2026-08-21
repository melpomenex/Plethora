## ADDED Requirements

### Requirement: The iOS Share Sheet SHALL offer Plethora
A native Share Extension SHALL appear as "Plethora" in the iOS system share sheet and SHALL accept URLs, plain text, selected text where provided by the source app, PDFs, images, audio, and other document types Plethora supports.

#### Scenario: Sharing an article from Safari
- **WHEN** a user taps Share on a Safari page and selects Plethora
- **THEN** the URL is staged and, after the app processes it, the article appears in Documents with source provenance

#### Scenario: Sharing a PDF from Files
- **WHEN** a user shares a PDF file from the Files app to Plethora
- **THEN** the file is staged into the shared container and imported through the standard document pipeline without requiring the main app to already be running

### Requirement: Staging SHALL be lightweight and exactly-once
The extension SHALL perform only fast local staging (file copies/manifest writes) — no network calls or content extraction. The main app SHALL consume each staged payload exactly once, tolerating crashes via claim markers, and SHALL complete extraction, dedupe, tagging, and indexing asynchronously.

#### Scenario: Crash during consumption
- **WHEN** the main app terminates mid-consumption of a claimed payload
- **THEN** the payload is reclaimed and consumed on next launch at most once more, with content-hash dedupe preventing duplicates

### Requirement: Shared captures SHALL preserve provenance and feed existing pipelines
Imported share payloads SHALL carry source URL/app/timestamp provenance into document metadata, SHALL pass through existing deduplication (content hash and in-flight URL coalescing), and SHALL be enqueued into smart tagging like other imports.

#### Scenario: Re-sharing the same URL
- **WHEN** the user shares an identical URL twice
- **THEN** the second import is deduplicated rather than creating a duplicate document

### Requirement: Offline capture SHALL be retained
When a shared URL cannot be fetched (offline), the payload SHALL remain staged and retry automatically on later launches until consumed or explicitly discarded; no capture SHALL be silently dropped.

#### Scenario: Offline share completes later
- **WHEN** a URL is shared while offline
- **THEN** it is staged immediately and the article appears after the app next runs online

### Requirement: Android warm-start sharing SHALL be reliable
The Android share pipeline SHALL deliver warm-start file/text batches to the frontend using the canonical event name; the legacy URL event path remains supported.

#### Scenario: App running during a share
- **WHEN** a file or text batch is shared while Plethora is open on Android
- **THEN** the batch arrives via the canonical event and imports without relaunch
