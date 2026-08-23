## Why

Plethora currently has multiple divergent and overlapping document import paths across desktop, iOS, Android, web, and the share extension. On mobile platforms, the app previously relied on `import_document_from_bytes`, which converts entire files into JavaScript number arrays (`Array.from(Uint8Array)`) and passes them over JSON IPC. For multi-megabyte PDFs, large EPUBs, or hundred-megabyte audiobooks, this approach causes high memory spikes, GC pauses, IPC timeouts, and out-of-memory (OOM) process crashes on iOS and Android.

Furthermore, the existing import pipeline suffers from architectural vulnerabilities:
1. **Ambiguous Error Handling**: Duplicate documents, corrupt PDFs, and missing EPUB assets return `PlethoraError::NotFound` instead of descriptive typed errors.
2. **Partial State Leaks**: When an import fails or is cancelled mid-flight, temporary files in `<app_data>/imports/` are abandoned, broken database rows can remain in SQLite, and the frontend store can get permanently stuck in an `isImporting: true` state.
3. **Overlapping Entry Points**: `importFromFile`, `importFromFiles`, `importGenericFile`, `importFromFolder`, `openFilePickerAndImport`, `importDocumentFromFileStreamed`, `pickFilesMobile`, and `staged_shares.rs` each implement slightly different staging, error-handling, and progress-reporting logic.

We must harden and unify the document import pipeline around a single canonical backend path, eliminate large whole-file JSON IPC transfers, implement transactional persistence and automatic orphan cleanup, introduce a comprehensive typed import error system, and establish an invariant-tested fixture corpus.

## What Changes

- **Canonical Backend Import Unification**:
  - Converge all document import sources (Desktop path, Mobile file picker, Mobile folder import, iOS Share Extension, Browser extension, Web/ArXiv download) onto a single canonical backend pipeline:
    `stage file → validate/sniff → import_from_path() → processor extraction → transactional persist → cover resolution → cleanup`.
  - Deprecate and eliminate whole-file `Array.from(Uint8Array)` JSON IPC transfers in favor of bounded chunked staging (`stage_import_file_start` / `append_import_file_chunk`) and native file-manager staging (`FolderImportPlugin`).
- **Import Lifecycle State Machine**:
  - Define an explicit, observable state machine in Rust and TypeScript:
    `selected → staging → staged → validating → extracting → persisting → post-processing → complete` (with terminal `failed`, `cancelled`, and `interrupted` states).
  - Provide fine-grained, throttled progress events to the frontend UI.
- **Transactional Persistence & Clean Recovery**:
  - Enclose SQLite document creation, initial extract generation, and metadata writes in an atomic database transaction.
  - Implement automatic staging cleanup on import failure or cancellation.
  - Add a startup staging sweep that purges orphaned temporary staging files older than 24 hours from `<app_data>/imports/`.
  - Ensure the frontend `useDocumentStore` guarantees state rollback and resets `isImporting: false` under all failure modes.
- **Typed Import Error System**:
  - Introduce `ImportErrorCode` in Rust and TypeScript:
    `unsupported_type`, `file_not_found`, `permission_denied`, `staging_failed`, `invalid_document`, `encrypted_document`, `extract_failed`, `duplicate_document`, `storage_full`, `persist_failed`, `cancelled`, `interrupted`, `internal`.
  - Replace ambiguous `NotFound` errors with precise, actionable user-facing messages and detailed diagnostic metadata in logs.
- **Robustness Fixture Corpus**:
  - Construct a comprehensive test corpus in `src-tauri/tests/fixtures/documents/` covering normal, edge-case, and pathological inputs for PDF, EPUB, Markdown, Text, HTML, and problematic filenames.
  - Enforce the core robustness invariant across all formats: *Plethora may successfully import the input or reject it with a typed error, but it must NEVER crash, panic, deadlock, corrupt persistent state, or leave an unusable partial document.*

## Capabilities

### New Capabilities

- `document-import-pipeline`: Canonical, transactionally-safe, typed-error document import pipeline with bounded chunked staging, lifecycle progress reporting, and automated orphan cleanup.

### Modified Capabilities

None.

## Impact

- Backend refactoring:
  - `src-tauri/src/commands/document.rs`: Unify `import_document`, `import_from_path`, staging commands, and error handling.
  - `src-tauri/src/error.rs`: Add `PlethoraError::Import(ImportError)` with structured codes.
  - `src-tauri/src/processor/`: Harden PDF, EPUB, HTML, and Markdown parsers against malformed inputs, decompression bombs, and exotic font panic edge cases.
  - `src-tauri/src/database/repository.rs`: Transactional document creation helpers.
- Frontend refactoring:
  - `src/api/documents.ts`: Remove whole-file `importDocumentFromBytes` in favor of streamed/chunked staging; expose typed import errors.
  - `src/stores/documentStore.ts`: Consolidate import methods around the unified lifecycle state machine; ensure bulletproof `finally` state cleanup.
  - `src/types/document.ts`: Add `ImportState`, `ImportProgress`, and `ImportErrorCode` types.
- Fixtures and tests:
  - `src-tauri/tests/fixtures/documents/`: Committed corpus of edge-case and malformed files.
  - `src-tauri/tests/import_robustness.rs`: Automated Rust regression test suite running all fixtures through the canonical pipeline.

**Owns:** Document import commands, staging lifecycle, processor error boundaries, document store import actions, import fixture corpus.  
**Must NOT change:** UI layouts outside of import dialogs/progress toasts, reader rendering internals, database schema migrations unless required for transactional safety.

## Dependencies

- **Hard:** None. Can be developed in parallel with Proposal 1.
- **Soft:** Feeds into Proposal 3 (E2E Import verification) and Proposal 4 (Parser Fuzzing).

## Parallelization Notes

Can be implemented in Wave 1. Changes are primarily in `src-tauri/src/commands/document.rs`, `src-tauri/src/processor/`, `src/api/documents.ts`, and `src/stores/documentStore.ts`.

## Migration / Backward Compatibility

- Existing documents in SQLite are unaffected.
- The deprecated `import_document_from_bytes` command will be replaced with bounded staging; legacy callers will be migrated to `importDocumentFromFileStreamed`.

## Risks

- Legacy mobile file pickers returning `content://` URIs: Fully supported via native fast-copy staging (`FolderImportPlugin`) and chunked file streaming.
- Third-party parser panics: Mitigated by wrapping blocking parser tasks in `tokio::task::spawn_blocking` and catching join errors gracefully.
