## Purpose

Serve individual entries from `.epub` ZIP archives on demand over the local loopback HTTP server so the reader never copies, downloads, or decompresses an entire EPUB archive to display the first chapter.

## ADDED Requirements

### Requirement: On-demand EPUB archive entry serving
The local loopback HTTP server SHALL expose an entry-level endpoint that serves individual files from an authorized `.epub` archive by relative archive path without reading or copying the entire `.epub` file into memory or mirror storage.

#### Scenario: Reader requests container, package, and active chapter entries
- **WHEN** the reader opens an `.epub` using the entry-level base URL
- **THEN** the server SHALL serve `META-INF/container.xml`, the `.opf` package document, navigation documents, and only the active spine chapter and its referenced assets with HTTP `200 OK` and appropriate `Content-Type` headers

#### Scenario: Missing entry in archive
- **WHEN** a request targets an entry path that does not exist inside the `.epub` archive
- **THEN** the server SHALL respond with HTTP `404 Not Found`

### Requirement: Token-scoped archive access without whole-file mirroring
The backend SHALL authorize `.epub` archives by issuing an opaque token bound to the canonical file path in memory, eliminating synchronous whole-file copying into cache storage for files outside standard media roots.

#### Scenario: Opening a large EPUB outside app data roots
- **WHEN** a user opens a valid `.epub` stored in an arbitrary user directory
- **THEN** the backend SHALL validate the ZIP signature, register the canonical path under a token, and return the entry-level base URL immediately without copying the `.epub` file

#### Scenario: Unauthorized or unknown token
- **WHEN** an HTTP request uses an unknown or invalid archive token
- **THEN** the server SHALL reject the request with HTTP `403 Forbidden` or `404 Not Found`

### Requirement: Path traversal protection for archive entries
The entry-level endpoint SHALL normalize and reject relative archive paths that attempt directory traversal or escape the archive namespace.

#### Scenario: Traversal segment in entry path
- **WHEN** a request includes `..` or backslash traversal segments in the entry path
- **THEN** the server SHALL reject the request with HTTP `400 Bad Request` or `404 Not Found` without accessing the host filesystem

### Requirement: Cached archive central directory lookup
The backend SHALL retain a bounded in-memory cache of recently opened `.epub` archive readers or central-directory indexes so consecutive entry requests for chapters, stylesheets, fonts, and images do not re-parse the ZIP central directory on every HTTP request.

#### Scenario: Multiple asset requests during chapter render
- **WHEN** the reader requests a chapter XHTML and multiple stylesheets, fonts, or images from the same `.epub`
- **THEN** the server SHALL reuse the cached archive index for subsequent entries from that archive
