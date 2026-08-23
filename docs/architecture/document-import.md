# Document Ingestion Architecture & Error Taxonomy

## Canonical Ingestion Pipeline

All document imports across desktop, mobile, share extensions, and web downloads converge onto a single backend entry point:

`import_from_path(disk_path, file_name, collection_id, app, repo)`

```text
┌─────────────────────────┐      ┌──────────────────────────┐      ┌─────────────────────────┐
│     Desktop / CLI       │      │   Mobile WebView File    │      │   iOS Share Extension   │
│   (Direct file path)    │      │  (Chunked Staging 256KB) │      │  (App Group Container)  │
└────────────┬────────────┘      └────────────┬─────────────┘      └────────────┬────────────┘
             │                                │                                 │
             ▼                                ▼                                 ▼
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                    Canonical Backend Pipeline: import_from_path                            │
│                                                                                            │
│  1. Kindle My Clippings Sniff & Multi-Doc Branch                                           │
│  2. Content Extraction & Word Count (PDF, EPUB, MD, HTML, Audio)                           │
│  3. SHA-256 Content Hash Calculation & Duplicate Detection                                 │
│  4. Transactional SQLite Persistence (Document + Metadata + Category)                      │
│  5. Post-Processing & Smart Tagging Enqueue                                                │
│  6. Automatic Temporary Staging Cleanup on Failure                                         │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Typed Import Error Taxonomy

When an import fails, the system returns a structured `ImportError` payload:

```json
{
  "type": "import_error",
  "code": "duplicate_document",
  "message": "Duplicate document detected: Already imported as 'Sample'",
  "fileName": "sample.pdf"
}
```

### Supported Error Codes:
- `unsupported_type`: Unknown file extension or unsupported media container.
- `file_not_found`: Path does not exist on disk.
- `permission_denied`: OS denied read access to the file.
- `staging_failed`: Failed to write chunks to `<app_data>/imports/`.
- `invalid_document`: Malformed PDF structure, missing EPUB container XML, or corrupt zip header.
- `encrypted_document`: Password-protected or DRM-locked document.
- `extract_failed`: Content extractor encountered unrecoverable parser error.
- `duplicate_document`: Identical content hash already exists in user's library.
- `storage_full`: Device storage exhausted during staging or extraction.
- `persist_failed`: SQLite database write failed.
- `cancelled`: User cancelled import operation in flight.
- `interrupted`: App killed during staging or extraction.
- `internal`: Unexpected internal backend error.
