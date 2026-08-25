## 1. Backend Module Activation

- [x] 1.1 Rename `src-tauri/src/legacy_third_party_import.rs` to `src-tauri/src/legacy_third_party_import.rs`
- [x] 1.2 Add `mod legacy_third_party_import;` to `src-tauri/src/lib.rs`
- [x] 1.3 Add `import_legacy_third_party_package` and `validate_legacy_third_party_package` to `tauri::generate_handler![]` in `lib.rs`
- [x] 1.4 Verify the project compiles with `cargo check`

## 2. XML Parser Upgrade

- [x] 2.1 Add `quick-xml` dependency to `Cargo.toml`
- [x] 2.2 Rewrite `parse_legacy-third-party_qa_xml` to use `quick-xml::Reader` event-based parsing
- [x] 2.3 Rewrite `parse_legacy-third-party_topic_xml` to use `quick-xml::Reader`
- [x] 2.4 Update `parse_generic_legacy-third-party_xml` to strip tags via `quick-xml` instead of regex
- [x] 2.5 Remove the manual `extract_xml_tag` helper function
- [x] 2.6 Verify compilation and run any existing tests

## 3. Frontend Import Wiring

- [x] 3.1 Add `legacy-third-party` case to `handleImportFromPicker` in `src/routes/documents.tsx` that calls `importPlethoraPackage` and `convertPlethoraCollectionToDocuments`
- [x] 3.2 Add imported documents to the document store via `importFromFiles` or equivalent store method
- [x] 3.3 Add error handling — display toast/message on import failure and show feedback for empty collections
- [x] 3.4 Close the picker and navigate to the first imported document on success
