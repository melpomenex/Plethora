## ADDED Requirements

### Requirement: Audiobook cover is extracted at import time on every platform

The system SHALL extract embedded cover art from an audiobook file at import time using an in-process Rust extractor (no external `ffmpeg` binary), so that audiobooks display a cover in the Documents view on desktop and Android without depending on a system-installed tool.

#### Scenario: M4B audiobook with embedded cover imported on Android
- **WHEN** the user imports an `.m4b` audiobook that contains an embedded MP4 `covr` atom
- **AND** the import is running on Android (where no `ffmpeg` sidecar exists)
- **THEN** the system SHALL extract the embedded cover image natively in Rust
- **AND** the document's `coverImageUrl` SHALL be populated with a `data:image/...;base64,...` URL
- **AND** the document's `coverImageSource` SHALL be set to `"embedded"`

#### Scenario: MP3 audiobook with ID3 APIC frame imported on desktop
- **WHEN** the user imports an `.mp3` audiobook that contains an ID3v2 `APIC` frame
- **THEN** the system SHALL extract the embedded cover image natively in Rust
- **AND** the document's `coverImageUrl` SHALL be populated with a `data:image/...;base64,...` URL
- **AND** the document's `coverImageSource` SHALL be set to `"embedded"`

#### Scenario: FLAC audiobook with METADATA_BLOCK_PICTURE imported
- **WHEN** the user imports a `.flac` audiobook containing a `METADATA_BLOCK_PICTURE` block
- **THEN** the system SHALL extract the embedded cover image natively in Rust
- **AND** the document's `coverImageUrl` SHALL be populated with a `data:image/...;base64,...` URL

#### Scenario: OGG/Opus audiobook with cover art imported
- **WHEN** the user imports an `.ogg` or `.opus` audiobook containing embedded cover art
- **THEN** the system SHALL extract the embedded cover image natively in Rust
- **AND** the document's `coverImageUrl` SHALL be populated with a `data:image/...;base64,...` URL

### Requirement: Audiobook cover extraction is ffmpeg-free

The audiobook cover extractor SHALL NOT invoke an external `ffmpeg` binary. It SHALL parse the audio container and decode the embedded cover art entirely within the Rust process, so that extraction succeeds on platforms where `ffmpeg` is not installed (including Android).

#### Scenario: Audiobook imported on Android without any ffmpeg sidecar
- **WHEN** an audiobook with embedded cover art is imported on Android
- **AND** no `ffmpeg` binary is present in the app bundle or on the system
- **THEN** the cover SHALL still be extracted successfully
- **AND** no error referencing `ffmpeg` SHALL be raised

#### Scenario: Audiobook imported on desktop without ffmpeg installed
- **WHEN** an audiobook with embedded cover art is imported on a desktop system where `ffmpeg` is not on `$PATH`
- **THEN** the cover SHALL still be extracted successfully via the in-process extractor

### Requirement: Audiobooks without embedded cover fall back to online lookup

When an audiobook contains no extractable embedded cover art, the system SHALL attempt an online cover lookup (book-cover metadata service) before recording the document as having no cover, mirroring the fallback behavior already provided for PDF and EPUB documents.

#### Scenario: Audiobook with no embedded cover art
- **WHEN** the user imports an audiobook whose container has no cover atom/frame (e.g. a WAV file or an MP3 without `APIC`)
- **THEN** the system SHALL attempt an online cover lookup
- **AND** if the online lookup returns a cover, the document's `coverImageUrl` SHALL be set to that URL with `coverImageSource = "online"`
- **AND** if the online lookup returns no cover, the document's `coverImageSource` SHALL be set to `"fallback"`

### Requirement: Audiobook covers are resolved through the shared cover pipeline

Audiobook cover resolution SHALL flow through the same `resolve_cover_for_document` path used by PDF and EPUB, so that import-time extraction, lazy grid resolution, and the `"fallback"` retry all behave consistently across document types.

#### Scenario: Import path resolves the cover
- **WHEN** `import_from_path` processes an audio file
- **THEN** it SHALL call `resolve_cover_for_document` with the audio document
- **AND** the returned cover URL and source SHALL be persisted to the document's `cover_image_url` and `cover_image_source` columns

#### Scenario: Lazy grid resolution resolves the cover
- **WHEN** the Documents grid resolves a cover for an audio document that has no `coverImageUrl`
- **THEN** `resolve_document_cover` SHALL invoke `resolve_cover_for_document` for the audio document
- **AND** the result SHALL be persisted identically to the import path

### Requirement: Existing fallback audiobooks are re-resolved

An audiobook document that was previously resolved to `coverImageSource = "fallback"` SHALL be re-evaluated by the cover resolver when it next appears in the Documents grid, so that already-imported audiobook libraries gain covers without requiring the user to re-import.

#### Scenario: Previously imported audiobook with no cover
- **WHEN** the Documents grid loads an audio document whose `coverImageSource` is `"fallback"`
- **AND** the document has no `coverImageUrl`
- **THEN** the grid SHALL retry cover resolution for that document
- **AND** if a cover is now found (embedded or online), the result SHALL be persisted with a non-`fallback` source
- **AND** the retry SHALL NOT repeat on subsequent loads once a non-`fallback` source is stored

#### Scenario: Retry remains bounded
- **WHEN** cover resolution for a `"fallback"` audio document fails again
- **THEN** the document SHALL remain `coverImageSource = "fallback"`
- **AND** the grid MAY retry on a later load, but SHALL NOT retry the same document more than once per grid load

### Requirement: Mobile and desktop use the same cover extraction code path

The frontend SHALL NOT special-case mobile to skip audiobook cover extraction. The same `extractAudioCoverArt` invocation SHALL be used on desktop and Android, because the underlying extractor no longer depends on `ffmpeg`.

#### Scenario: Import dialog on Android extracts cover
- **WHEN** the user imports an audiobook via the import dialog on Android
- **THEN** the dialog SHALL invoke the cover extraction step (no `onMobile` short-circuit)
- **AND** the extracted cover SHALL be written to the document

#### Scenario: Audiobook viewer on Android recovers cover from embedded art
- **WHEN** the user opens an audiobook in the viewer on Android
- **AND** the document has no `coverImageUrl`
- **THEN** the viewer SHALL invoke `extractAudioCoverArt` against the file path
- **AND** the extracted cover SHALL be displayed and written back to the document

### Requirement: Cover extraction failure does not abort the import

A failure to extract or decode a cover from a single audiobook SHALL NOT prevent the document from being imported, nor SHALL it abort an import batch. The failure SHALL be logged and the document SHALL proceed with `coverImageSource = "fallback"`.

#### Scenario: Malformed audio file with unparseable cover
- **WHEN** the extractor cannot parse the audio container or decode the embedded cover bytes (e.g. corrupted file)
- **THEN** the system SHALL log a warning and continue the import
- **AND** the document SHALL be created with `coverImageSource = "fallback"`
- **AND** no panic or abort SHALL propagate to the caller

#### Scenario: Batch import with one failing file
- **WHEN** a batch import includes multiple audiobooks and one has an unparseable cover
- **THEN** the other audiobooks in the batch SHALL still have their covers extracted and persisted normally
