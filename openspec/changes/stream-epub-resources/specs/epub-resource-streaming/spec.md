## ADDED Requirements

### Requirement: EPUB documents SHALL be served to the webview over loopback HTTP with byte-range support

The system SHALL operate a local (loopback-only) HTTP server that streams `.epub` file bytes to the webview with full `GET` and HTTP `Range` / `206 Partial Content` semantics. The server SHALL be the sole source of EPUB content for the reader on every platform (macOS, Windows, Linux, Android, iOS), replacing the previous whole-file IPC transfer.

Rationale: epubjs/JSZip read a ZIP by URL and issue their own byte-range requests against it; serving raw EPUB bytes with Range support lets the reader fetch only the central directory and the spine entries it needs, instead of materializing the whole file in webview memory.

#### Scenario: Small EPUB opens normally
- **WHEN** a user opens a 2 MB EPUB
- **THEN** the reader renders the document by fetching its bytes from `http://127.0.0.1:<port>/epub?path=<encoded>`
- **AND** the webview does NOT receive the file as a single IPC binary payload

#### Scenario: Large EPUB opens without running out of memory
- **WHEN** a user opens a 26 MB or 84 MB EPUB that previously failed to render
- **THEN** the reader renders the document successfully
- **AND** peak webview memory stays below the ceiling that previously caused failure
- **AND** no `OutOfMemoryError`, hang, or blank render occurs

#### Scenario: Range request is honored
- **WHEN** the reader issues an HTTP `Range: bytes=<start>-<end>` request for an EPUB
- **THEN** the server responds with `206 Partial Content`
- **AND** a `Content-Range: bytes <start>-<end>/<total>` header
- **AND** only the requested byte range in the body

#### Scenario: Full request without Range header
- **WHEN** the reader issues a `GET` for an EPUB without a `Range` header
- **THEN** the server responds with `200 OK` and streams the entire file

### Requirement: The EPUB server SHALL only serve files inside app-managed directories

The system SHALL refuse to serve any EPUB whose canonical path is not contained within `app_data_dir` or `app_cache_dir`. This reuses the same canonicalization-and-containment check already enforced by the audio media server.

#### Scenario: Path outside allowed roots is rejected
- **WHEN** a request is made for an EPUB at a path outside `app_data_dir` / `app_cache_dir`
- **THEN** the server responds with `403 Forbidden`
- **AND** no file bytes are returned

#### Scenario: Nonexistent file is reported as not found
- **WHEN** a request is made for an EPUB path that does not exist on disk
- **THEN** the server responds with `404 Not Found`

#### Scenario: Symlink escape is rejected
- **WHEN** a request path canonicalizes to a location outside the allowed roots via a symlink
- **THEN** the server responds with `403 Forbidden`

### Requirement: The frontend SHALL load EPUBs by URL instead of by whole-file ArrayBuffer

The viewer (`DocumentViewer.tsx` → `EPUBViewer.tsx`) SHALL obtain an EPUB resource URL from the backend and pass it to epubjs via `ePub(url)`. The viewer SHALL NOT call `read_document_file` for EPUB display, SHALL NOT allocate a whole-file `Uint8Array`, and SHALL NOT pass a sliced `ArrayBuffer` to epubjs on the streaming path.

#### Scenario: Opening an EPUB populates the URL slot
- **WHEN** the user opens an EPUB document
- **THEN** `DocumentViewer` sets `epubUrl` to the loopback URL returned by the backend
- **AND** `fileData` remains `null` for that document
- **AND** `EPUBViewer` calls `ePub(fileUrl)` rather than `ePub(fileData.slice().buffer)`

#### Scenario: Existing reader behavior is preserved
- **WHEN** an EPUB is opened via the new URL path
- **THEN** navigation, spine rendering, TOC, selection/highlighting, and audiobook–EPUB sync all behave identically to the previous whole-file path

### Requirement: Oversized EPUB requests SHALL produce a clear error rather than a silent failure

As a defensive backstop, the backend `read_document_file` command SHALL refuse files above a desktop-appropriate threshold (default 256 MiB) on every non-mobile platform, returning a descriptive error. The viewer's EPUB path SHALL additionally surface any failure to obtain or load the EPUB URL as an explicit error state in the UI, not a hang.

#### Scenario: Whole-file read above the desktop threshold is refused
- **WHEN** a non-mobile caller invokes `read_document_file` on a file larger than the desktop threshold
- **THEN** the command returns an `IncrementumError` describing the size limit
- **AND** the file is not read into memory

#### Scenario: EPUB URL resolution failure is surfaced in the UI
- **WHEN** the backend cannot serve an EPUB (e.g. file missing, outside allowed roots, server not started)
- **THEN** the viewer shows an error state naming the document
- **AND** the UI does not hang in the loading state indefinitely
