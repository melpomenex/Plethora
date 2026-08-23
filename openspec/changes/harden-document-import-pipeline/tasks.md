## 1. Typed Error System & Data Model

- [ ] 1.1 Define `ImportErrorCode` and `ImportError` in `src-tauri/src/error.rs`, mapping all failure categories (`unsupported_type`, `file_not_found`, `permission_denied`, `staging_failed`, `invalid_document`, `encrypted_document`, `extract_failed`, `duplicate_document`, `storage_full`, `persist_failed`, `cancelled`, `interrupted`, `internal`).
- [ ] 1.2 Update `PlethoraError::Import` serialization to produce structured JSON `{ type: "import_error", code: "...", message: "...", fileName: "..." }`.
- [ ] 1.3 Create `src/types/import.ts` with matching TypeScript definitions: `ImportErrorCode`, `ImportError`, `ImportState`, and `ImportProgress`.

## 2. Backend Import Engine Consolidation

- [ ] 2.1 Refactor `import_from_path` in `src-tauri/src/commands/document.rs` to serve as the single canonical backend ingestion engine for all file imports.
- [ ] 2.2 Harden `processor::pdf::extract_pdf_content` in `src-tauri/src/processor/pdf.rs`: wrap `lopdf` and `pdf_extract` in `spawn_blocking`, catch font parser panics, handle encrypted documents with typed `EncryptedDocument` error, and return graceful fallbacks.
- [ ] 2.3 Harden `processor::epub::extract_epub_content` in `src-tauri/src/processor/epub.rs`: validate ZIP container integrity, handle missing OPF/manifest items gracefully, and bound memory during XML/HTML extraction.
- [ ] 2.4 Replace `PlethoraError::NotFound` with `ImportErrorCode::DuplicateDocument` in duplicate detection logic.
- [ ] 2.5 Deprecate whole-file `import_document_from_bytes` command in `src-tauri/src/commands/document.rs` and verify all mobile callers use chunked staging (`stage_import_file_start` + `append_import_file_chunk`) or native staging (`FolderImportPlugin`).

## 3. Transactional Persistence & Cleanup Handlers

- [ ] 3.1 Implement atomic `create_document_transactional` in `src-tauri/src/database/repository.rs` wrapping document insertion, metadata persistence, and initial extracts within a single SQLite transaction.
- [ ] 3.2 Add automatic staging cleanup in `import_from_path`: remove the staged temporary file on extraction or persistence failure.
- [ ] 3.3 Implement `sweep_stale_staging_files` in `src-tauri/src/commands/document.rs` called on startup in `src-tauri/src/lib.rs` to purge unreferenced staging files older than 24 hours from `<app_data>/imports/`.

## 4. Frontend Import Pipeline & Store Hardening

- [ ] 4.1 Update `src/api/documents.ts`: remove `importDocumentFromBytes`; standardize on `importDocumentFromFileStreamed` for HTML5 `File` objects.
- [ ] 4.2 Update `src/stores/documentStore.ts`: unify `importFromFile`, `importFromFiles`, `importGenericFile`, and `openFilePickerAndImport` to route through the state machine.
- [ ] 4.3 Ensure `finally` block in `useDocumentStore` always resets `isImporting: false`, `isSegmenting: false`, and clears `importProgress` on any error or cancellation.
- [ ] 4.4 Add user-friendly toast messages in `src/stores/documentStore.ts` mapping each `ImportErrorCode` to actionable guidance.

## 5. Robustness Fixture Corpus & Regression Test Suite

- [ ] 5.1 Create directory `src-tauri/tests/fixtures/documents/` with committed test files:
  - `pdf/`: minimal, large, scanned, password-protected, corrupt-header, truncated, exotic-cff, huge-dimensions, renamed-exe.
  - `epub/`: minimal, large-spine, missing-container, broken-opf, missing-manifest-item, huge-image, malformed-xhtml, renamed-text.
  - `text/`: empty (0-byte), whitespace-only, unicode-cjk-emoji, long-line (2MB).
  - `html/`: deeply-nested, unclosed-tags.
  - `filenames/`: spaces, emoji, quotes, apostrophes, unicode NFC/NFD, long names, multiple dots, uppercase extensions, extensionless.
- [ ] 5.2 Create Rust integration test suite `src-tauri/tests/import_robustness.rs` that iterates through all fixtures, runs them through `import_from_path`, and asserts the core invariant (either success or typed error; zero crashes/panics).
- [ ] 5.3 Create Vitest integration test `src/stores/__tests__/documentImportHardening.test.ts` testing store state transitions, progress updates, cancellation, and error recovery.

## 6. Verification & Documentation

- [ ] 6.1 Run `cargo test --test import_robustness` in `src-tauri` and verify 100% pass across all malformed fixtures.
- [ ] 6.2 Run `npm run test:run` and verify frontend import unit and store tests pass.
- [ ] 6.3 Test importing a 50MB+ file in the iOS simulator and verify memory remains bounded and chunked progress is displayed.
- [ ] 6.4 Document the canonical import architecture and error codes in `docs/architecture/document-import.md`.
