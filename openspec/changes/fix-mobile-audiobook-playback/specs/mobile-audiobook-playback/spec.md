## ADDED Requirements

### Requirement: Android audiobook imports retain a readable local source

The system SHALL stage a selected Android audiobook into app-private storage and persist a filesystem path that the Rust playback and metadata commands can open. Import completion SHALL NOT depend on transferring the audiobook bytes through frontend JSON IPC.

#### Scenario: Single M4B selected from Android storage
- **WHEN** the user selects an `.m4b` through the mobile audiobook importer
- **THEN** the file is copied into app-private storage, the import creates an audio document, and the document path resolves to the staged file

#### Scenario: Large M4B selected from Android storage
- **WHEN** the selected audiobook is larger than the frontend’s safe in-memory transfer threshold
- **THEN** import completes through native staging without base64-encoding the complete file in the WebView or JavaScript heap

### Requirement: Native mobile playback uses bounded-memory local streaming

The system SHALL play a locally staged Android audiobook through a loopback HTTP source with the correct audio MIME type and SHALL NOT require whole-file `readDocumentFile` transfer or a desktop-only FFmpeg sidecar for standard AAC-in-MP4/M4B playback.

#### Scenario: Open an imported standard M4B
- **WHEN** the user opens a staged `.m4b` whose audio codec is supported by the Android WebView
- **THEN** the viewer resolves a local stream source, leaves the loading state, exposes the audio element, and the user can start playback

#### Scenario: Open a large M4B
- **WHEN** the staged audiobook is large enough that whole-file buffering would risk an Android heap failure
- **THEN** playback requests bounded byte ranges or a streamed response and remains below the whole-file buffering path

#### Scenario: Desktop M4B playback
- **WHEN** the user opens an `.m4b` on a supported desktop build
- **THEN** the existing desktop preparation/playback behavior remains available and is not regressed by the mobile source path

### Requirement: Local media responses have consistent HTTP semantics

The local media server SHALL return a response whose body length matches its headers for every supported request. It SHALL support single byte ranges, complete non-range requests, correct `audio/mp4` typing for `.m4b`/`.m4a`, and explicit invalid-range errors.

#### Scenario: Valid range request
- **WHEN** the media client requests `bytes=start-end` for an existing audiobook
- **THEN** the server returns `206 Partial Content`, the exact requested byte count, `Accept-Ranges: bytes`, and a matching `Content-Range: bytes start-end/total`

#### Scenario: Initial request without a Range header
- **WHEN** the media client requests an existing audiobook without `Range`
- **THEN** the server returns the complete file as a streamed `200` response whose `Content-Length` equals the actual response body length

#### Scenario: Invalid or unsatisfiable range
- **WHEN** the media client sends a malformed or out-of-bounds range
- **THEN** the server returns `416 Range Not Satisfiable` with `Content-Range: bytes */total` and does not silently return a truncated full-response body

#### Scenario: Missing staged file
- **WHEN** a stream URL references a missing or unreadable file
- **THEN** URL generation or request handling returns a clear not-found/readability error and emits a diagnostic event identifying the document/file metadata without audio contents

### Requirement: Playback failures leave loading and expose an actionable state

The viewer SHALL transition out of loading when source resolution or media loading fails. It SHALL show a retryable, user-visible error that distinguishes missing/unreadable media from an unsupported audio format, and it SHALL avoid infinite fallback loops.

#### Scenario: Stream URL command fails
- **WHEN** native mobile source resolution rejects, times out, or reports an invalid staged path
- **THEN** the viewer stops showing the loading spinner, records the failure, and renders a retry action with a concise error message

#### Scenario: Audio decoder rejects the source
- **WHEN** the `<audio>` element emits an unsupported or decode error after a source is resolved
- **THEN** the viewer records the media error code/source strategy, stops retrying the same source indefinitely, and tells the user that the file format or codec cannot be played on this device

#### Scenario: Playback succeeds after retry
- **WHEN** the user retries after a transient source/server failure and the source becomes available
- **THEN** the viewer replaces the failed state with the player and preserves the existing seek, chapter, transcript, and progress behavior

### Requirement: Mobile audiobook diagnostics are observable through native logs

The system SHALL emit structured diagnostics for audiobook import/staging, source resolution, local media-server requests, and media-element failures through the existing native logging path so a connected Android device can be investigated with PID-filtered `adb logcat`. Diagnostics SHALL omit audio bytes and transcript contents.

#### Scenario: Successful source resolution is traced
- **WHEN** an Android audiobook is opened
- **THEN** logcat contains a source-resolution event with document id, extension, file size or redacted basename, selected strategy, and elapsed time

#### Scenario: Failed stream request is traced
- **WHEN** the local media server returns an error or the `<audio>` element fails to load
- **THEN** logcat contains correlated request/media error fields including status or media error code and range information when available

#### Scenario: Debug APK reproduction
- **WHEN** a debug APK is installed and the user reproduces the issue on a connected device
- **THEN** the documented verification procedure can collect the relevant Rust and frontend events using `adb logcat` and, if required, WebView CDP inspection
