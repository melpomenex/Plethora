# backend-thread-hygiene

Tauri async commands never execute blocking file I/O or CPU-bound extraction on async runtime threads.

## ADDED Requirements

### Requirement: Hot-path commands do not block the async runtime
Async Tauri commands on user-facing hot paths SHALL perform file I/O via async APIs (`tokio::fs`) or offload it with `tokio::task::spawn_blocking`. This applies at minimum to `read_document_file` and the PDF range read path (`read_range_from_path`).

#### Scenario: Concurrent commands stay responsive during a large read
- **WHEN** a large document file is being read while other IPC commands arrive
- **THEN** the other commands complete without waiting behind the file read, because no tokio async worker thread is blocked on it

### Requirement: CPU-bound PDF text extraction runs on blocking threads
All call sites of `pdf_extract` text extraction SHALL execute inside `spawn_blocking` (matching the existing pattern at `processor/pdf.rs:37`), and panic isolation for the extraction SHALL be preserved through the offload.

#### Scenario: Extraction does not stall the runtime
- **WHEN** text extraction runs on a large PDF
- **THEN** unrelated async commands issued during the extraction complete promptly

#### Scenario: Extractor panic remains contained
- **WHEN** the PDF extraction library panics on a malformed document
- **THEN** the command returns an error for that document and the application continues running
