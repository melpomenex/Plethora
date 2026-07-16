## Why

Pages saved with the browser extension are readable immediately, but after Incrementum restarts their article text can be missing from the parent document or appear only as an extract. This violates the save contract, breaks document Q&A and other text-dependent features, and risks making a successful import look like data loss (GitHub issue #39).

## What Changes

- Treat “Save Current Tab” page/link payloads as document imports whose extracted article text is durably stored on the document row.
- Preserve the distinction between page imports and user-created extracts across persistence, startup restoration, and document reload.
- Ensure browser-imported HTML documents are rehydrated through the full document lookup before reader and Q&A features consume their content.
- Make background readability enrichment non-destructive so failed, empty, or stale enrichment cannot replace valid extension-provided text.
- Add regression coverage for saving a browser page, restarting/reloading, reopening it, and using document-text features.
- Define safe handling for previously imported browser documents that have recoverable article text in metadata but an empty document content field.

## Capabilities

### New Capabilities

- `browser-extension-document-persistence`: Defines durable storage, reload semantics, document/extract separation, recovery, and regression behavior for pages imported through the browser extension.

### Modified Capabilities

None.

## Impact

- Browser extension HTTP import handling and background readability enrichment in `src-tauri/src/browser_sync_server.rs`.
- Document persistence and full-versus-summary retrieval in `src-tauri/src/database/repository.rs` and document commands.
- Startup/tab restoration and reader/Q&A document hydration in the React document store and viewer surfaces.
- Automated Rust and frontend integration tests covering persistence across a simulated application restart.
- No extension payload change, schema-breaking API change, or new external dependency is expected.
