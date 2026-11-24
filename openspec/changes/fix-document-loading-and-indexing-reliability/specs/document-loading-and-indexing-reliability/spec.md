## ADDED Requirements

### Requirement: Referenced EPUB files are preserved and resolved reliably

Staged EPUB imports SHALL be stored in or protected from deletion by startup staging cleanup while referenced by `documents.file_path`, and `get_epub_stream_url` SHALL resolve app-data-relative paths and report actionable errors for missing files.

#### Scenario: Referenced staged EPUB survives startup sweep and opens
- **WHEN** an EPUB is imported via staging and the application restarts after 24 hours
- **THEN** `sweep_stale_staging_files` does not delete the referenced EPUB
- **AND** `get_epub_stream_url` returns a valid stream URL

### Requirement: Partial embedding failures report truthful state and resume without duplicates

When embedding fails partway through a document or transcript, the indexer SHALL record `partial` (or `failed` if zero chunks succeeded) with the underlying error reason rather than `indexed`, and retrying SHALL embed only missing chunks.

#### Scenario: Batch failure after 25 of 77 chunks marks document partial and resumes
- **WHEN** embedding succeeds for 25 chunks and fails on chunk 26 of 77
- **THEN** the document index state is `partial` (not `indexed`) with `25/77` progress and the error reason preserved
- **AND** retrying embeds the remaining 52 chunks without creating duplicate chunk rows
