## 1. UTF-8 Parser & Document Extraction Fixes

- [x] 1.1 Rewrite `extract_text_from_html` in `src-tauri/src/processor/epub.rs` to process UTF-8 characters and string slices instead of byte-by-byte `u8 as char` casting.
- [x] 1.2 Add unit test cases in `src-tauri/src/processor/epub.rs` verifying full preservation of typographical punctuation (`’`, `‘`, `“`, `”`, `—`, `–`, `…`), accented Latin (`café`, `über`), and CJK characters (`日本語`).
- [x] 1.3 Audit and verify that other processors (`html.rs`, `pdf.rs`, `markdown.rs`) correctly maintain UTF-8 integrity during text extraction.

## 2. Typed NotebookLM Source Ingestion Domain Model

- [x] 2.1 Define `NotebookLmSourcePayload` enum in `src-tauri/src/notebooklm.rs` covering `File`, `Url`, `Youtube`, `Text`, and `Document` variants with backwards-compatible deserialization.
- [x] 2.2 Refactor `AddSourceRequest` in `src-tauri/src/notebooklm.rs` and update the `NotebookLMProvider` trait method signature.
- [x] 2.3 Update `MockProvider::add_source` in `src-tauri/src/notebooklm.rs` to handle typed payloads.

## 3. Safe Transport & Ephemeral File Lifecycle

- [x] 3.1 Implement `ScopedTempSourceFile` RAII helper in `src-tauri/src/notebooklm.rs` that writes UTF-8 text to a UUID-named `.md` or `.txt` file in `<app_dir>/notebooklm_staged/` and automatically deletes it on `Drop`.
- [x] 3.2 Add startup / provider initialization sweep in `src-tauri/src/notebooklm.rs` to purge any stale `.notebooklm_staged` artifacts older than 1 hour.
- [x] 3.3 Implement original-file-first routing in `CliProvider::add_source`: check `doc.file_path` existence and format support (`.pdf`, `.epub`, `.docx`, `.txt`, `.md`); fall back to `ScopedTempSourceFile` for HTML articles, synthetic notes, or missing disk files.

## 4. CLI Process Invocation, Flag Enforcement & Error Redaction

- [x] 4.1 Update `CliProvider::add_source` to always emit explicit `--type [file|url|youtube|text]`, `--title`, `--notebook`, and `--json` flags to `notebooklm source add`.
- [x] 4.2 Ensure large text bodies are never passed as command-line arguments to `tokio::process::Command`.
- [x] 4.3 Redact raw payload content and format concise, structured errors (`AppError::IntegrationError`) in `run_first_success_with_bootstrap` and `run_notebooklm_command_internal`.
- [x] 4.4 Add structured tracing logs in `src-tauri/src/notebooklm.rs` capturing `operation`, `source_type`, `transport`, `byte_size`, `title`, and `duration_ms` without logging document bodies.

## 5. Frontend API & Sidebar Integration

- [x] 5.1 Update TypeScript interfaces in `src/api/integrations.ts` (`NotebookLmSourcePayload`, `AddSourceRequest`, `notebooklmAddSource`).
- [x] 5.2 Update `handleAddLibrarySource` in `src/components/notebooklm/NotebookLMSidebar.tsx` to send typed document attachment requests (`kind: "document"`, `documentId`) without loading or forwarding the full document content over IPC.
- [x] 5.3 Update URL and text add handlers in `src/components/notebooklm/NotebookLMSidebar.tsx` to use explicit typed payloads.

## 6. Testing & Verification

- [ ] 6.1 Add backend unit tests in `src-tauri/src/notebooklm.rs` for source classification, routing logic, temp-file RAII cleanup, and error redaction.
- [ ] 6.2 Add regression test for a long-form book fixture (similar to *Dopamine Detox*) containing internal URLs and smart punctuation, verifying that it routes to file/temp-file transport, preserves UTF-8, and produces no `URL scheme '' is not allowed` errors.
- [ ] 6.3 Add/update frontend integration tests in `src/api/__tests__/notebooklm.integration.test.ts` and `src/components/notebooklm/__tests__/notebooklmConnection.test.tsx`.
- [ ] 6.4 Run `cargo test` and `npm run test` to verify zero regressions across the codebase.
