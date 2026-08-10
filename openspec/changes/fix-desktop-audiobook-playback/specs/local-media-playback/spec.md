## ADDED Requirements

### Requirement: Local media resolves through the loopback media server

In the Tauri app (desktop and mobile), a local audio or video file path SHALL be resolved into a playback URL served by the loopback media server (`get_media_stream_url`). The Tauri asset protocol SHALL NOT be used to resolve local media, because the app does not enable `app.security.assetProtocol` and such URLs are never served.

#### Scenario: Desktop audiobook resolves to a loopback URL

- **WHEN** an audiobook document with a local file path is opened on desktop
- **THEN** the resolved source URL starts with `http://127.0.0.1:` and its resolution strategy is recorded as `local-media-server`
- **AND** no `asset://` or `http://asset.localhost` URL is assigned to the media element

#### Scenario: Playback advances after pressing play

- **WHEN** the user presses play on a resolved audiobook
- **THEN** the media element enters a playing state and `currentTime` advances

#### Scenario: Transcoded m4b uses the transcoded file

- **WHEN** an `.m4b` document is prepared for playback on desktop and `prepare_audiobook_playback` returns a transcoded file in the app cache directory
- **THEN** the loopback URL is resolved for the transcoded path, not the original `.m4b` path

### Requirement: Media server authorizes app-managed and imported document paths

The media server SHALL stream a file only when its canonical path is authorized. A path is authorized when it lies within an app-managed root (app data or app cache directory) **or** when it is the stored file path of a document registered in the repository. Any other path SHALL be refused.

#### Scenario: File imported in place is streamable

- **WHEN** a document was imported on desktop without copying, so its stored path is outside the app data and cache directories
- **AND** playback requests a stream URL for that path
- **THEN** the media server returns a stream URL and serves the file

#### Scenario: Unregistered path outside app roots is refused

- **WHEN** a stream is requested for a path that is neither under an app-managed root nor the stored path of any document
- **THEN** the request is refused with HTTP 403 and no file bytes are served

#### Scenario: Stream handler enforces the same authorization

- **WHEN** a request arrives at the media server's `/stream` endpoint for a path that was never authorized through `get_media_stream_url`
- **THEN** the request is refused with HTTP 403

#### Scenario: Range requests are honoured

- **WHEN** the media element requests a byte range of an authorized file
- **THEN** the server responds `206 Partial Content` with the exact requested bytes and a matching `Content-Range` header

### Requirement: Resolution failures are reported to the user

When a local media source cannot be resolved or cannot be played, the viewer SHALL surface a playback error containing the reason, and SHALL NOT leave the player in an indefinite idle or loading state.

#### Scenario: Missing file surfaces an error

- **WHEN** the stored file for an audiobook no longer exists on disk
- **THEN** the viewer shows a playback error describing that the audio could not be loaded
- **AND** the play control is not left in a perpetual pending state

#### Scenario: Diagnostics record the failure

- **WHEN** source resolution fails
- **THEN** an audiobook diagnostic entry is logged at error level with the document id, file path, and failure message

### Requirement: Non-Tauri and remote sources are unchanged

Resolution of remote URLs, `data:` URLs, and in-memory browser `File` objects SHALL keep their existing behaviour and SHALL NOT be routed through the media server.

#### Scenario: Remote URL passes through

- **WHEN** the media path is an `http://`, `https://`, or `data:` URL
- **THEN** it is used directly as the playback source

#### Scenario: Browser build uses an object URL

- **WHEN** the app runs outside Tauri and the path is a `browser-file://` virtual path with a stored `File`
- **THEN** an object URL is created for that `File` and revoked when the source is disposed
