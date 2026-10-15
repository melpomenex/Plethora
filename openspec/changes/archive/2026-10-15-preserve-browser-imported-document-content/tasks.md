## 1. Lock Down Browser Import Semantics

- [x] 1.1 Add Rust tests proving `page`, `link`, and legacy empty request types create HTML documents while only explicit `extract` requests create extracts.
- [x] 1.2 Refactor the browser sync request routing and content selection into testable helpers that prefer non-empty extension text and fall back to HTML-derived text.
- [x] 1.3 Ensure initial page creation persists document content and browser article metadata in the same repository operation.
- [x] 1.4 Normalize source URL matching for duplicate page saves and verify a resave enriches the existing document without creating a duplicate document or extract.

## 2. Protect Persistent Content

- [x] 2.1 Add a repository-level guarded enrichment operation that rejects empty, poorer, or stale Readability candidates.
- [x] 2.2 Update the browser sync background enrichment task to use the guarded operation and preserve extension-provided text when fetching or parsing fails.
- [x] 2.3 Add Rust tests for failed enrichment, accepted improvement, and a document update that races with a stale enrichment result.

## 3. Hydrate Full Documents After Startup

- [x] 3.1 Introduce an explicit summary-versus-hydrated document distinction or hydration helper for content-free startup/library projections.
- [x] 3.2 Change `DocumentViewer` and restored-tab opening paths to fetch the full document by ID before loading body content, even when the store contains a matching summary.
- [x] 3.3 Merge successful full-document responses into document/current-document state and ignore responses for a document that is no longer active.
- [x] 3.4 Ensure assistant and Q&A document-text loaders consume the hydrated full-document path and prefer document content over extract fallback.
- [x] 3.5 Add frontend tests for opening a content-free startup summary, restoring a document tab, and ignoring a stale hydration response after a rapid tab switch.

## 4. Repair Recoverable Existing Imports

- [x] 4.1 Add an idempotent backend repair helper for browser-extension HTML documents whose content is empty but whose metadata contains non-empty article HTML.
- [x] 4.2 Invoke repair only on the full-document path, persist the derived plain text, and leave startup summary listing content-free.
- [x] 4.3 Add tests proving recoverable metadata is repaired and ordinary user extracts are never promoted into document content.

## 5. Process-Boundary Regression Verification

- [x] 5.1 Add an integration test that saves a page into a temporary SQLite database, recreates repository/application state against that database, and verifies the full document retains its article text with no page-body extract.
- [x] 5.2 Add a Q&A regression test proving a restarted browser-imported document supplies document text and does not produce the no-document-text response.
- [x] 5.3 Run targeted Rust and frontend test suites, then run OpenSpec validation for `preserve-browser-imported-document-content` and resolve all failures.
