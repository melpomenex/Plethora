# ipc-binary-transfer

Binary file content crosses the Tauri IPC boundary as raw bytes, never as JSON-encoded number arrays or base64 strings.

## ADDED Requirements

### Requirement: PDF byte ranges transfer as raw bytes
The `read_pdf_document_range` command SHALL return the requested byte range as a raw-byte IPC response (`tauri::ipc::Response`), and the frontend SHALL receive it as an `ArrayBuffer`/`Uint8Array` without an intermediate JSON number array or base64 string. The existing source-identity validation SHALL be preserved: a request whose `expected_identity` does not match the file on disk fails with the `pdf_source_changed` error.

#### Scenario: Range read returns raw bytes
- **WHEN** the PDF viewer requests a 512 KB range of an open PDF document
- **THEN** the command responds with exactly those bytes as a binary payload and the frontend constructs its `Uint8Array` directly from the response buffer

#### Scenario: End of file is derivable without metadata
- **WHEN** the requested range extends past the end of the file
- **THEN** the response contains only the bytes up to EOF and the caller detects EOF from the returned length being shorter than requested

#### Scenario: Changed file still rejected
- **WHEN** the PDF file on disk changes after `open_pdf_document_source` was called and a range is then requested with the stale identity
- **THEN** the command fails with the `pdf_source_changed` error and no bytes are returned

### Requirement: Whole-document reads transfer as raw bytes
The `read_document_file` command SHALL return file content as a raw-byte IPC response, and `readDocumentFile()` in the frontend API SHALL return binary data (`Uint8Array`), not a base64 string. The Android size guard SHALL be preserved: files larger than the mobile inline limit are refused with an error directing callers to the streaming media server.

#### Scenario: Viewer loads a document without base64
- **WHEN** a viewer loads a local document file through `readDocumentFile()`
- **THEN** the returned value is binary data obtained without any base64 encode or decode step on either side of the IPC boundary

#### Scenario: Oversized mobile read still refused
- **WHEN** `read_document_file` is invoked on Android for a file larger than the mobile inline limit
- **THEN** the command fails with an error that names the streaming fallback, and no allocation of the full file into the webview occurs

### Requirement: PWA backend parity for binary reads
The browser/PWA implementations of the same API functions SHALL satisfy the identical `Uint8Array` return contract so callers are backend-agnostic.

#### Scenario: Same call shape in PWA mode
- **WHEN** the app runs in browser/PWA mode and a caller invokes `readDocumentFile()`
- **THEN** the call resolves with `Uint8Array` content served from the browser-side storage backend with no Tauri-specific types in the signature
