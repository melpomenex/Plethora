## Why

The legacy third-party collection .zip import feature is completely non-functional. The backend Rust module (`src-tauri/src/legacy_third_party_import.rs`) containing the ZIP parsing and Tauri commands is dead code — it's never declared in `lib.rs` and its commands aren't registered in `tauri::generate_handler![]`. On the frontend, the `handleImportFromPicker` in `routes/documents.tsx` only handles `url`, `arxiv`, and `local` sources — the `legacy-third-party` (and `anki`/`screenshot`) sources are silently dropped. Users who select "legacy third-party collection" in the import picker will see the file picker, select a .zip, and nothing happens.

## What Changes

- Register the `legacy-third-party` module in `src-tauri/src/lib.rs` so it compiles
- Add `import_legacy_third_party_package` and `validate_legacy_third_party_package` to `tauri::generate_handler![]`
- Wire the `legacy-third-party` source in the frontend `handleImportFromPicker` to actually call the import utility and create documents
- Replace the fragile string-based XML parsing with a proper XML parser (`quick-xml`)
- Add error handling and user feedback (toast/notification on success/failure)

## Capabilities

### New Capabilities
- `legacy-third-party-import`: End-to-end legacy third-party collection .zip import — backend module registration, command handler wiring, frontend import flow, and proper XML parsing

### Modified Capabilities
(none — this is fixing a non-functional feature, not modifying existing spec-level behavior)

## Impact

- **Backend**: `src-tauri/src/lib.rs` (module + handler registration), `src-tauri/src/legacy_third_party_import.rs` (XML parser swap to `quick-xml`), `Cargo.toml` (add `quick-xml` dependency)
- **Frontend**: `src/routes/documents.tsx` (add `legacy-third-party` case to import handler), `src/utils/legacyThirdPartyImport.ts` (already exists, will be used)
- **Dependencies**: Add `quick-xml` crate to `Cargo.toml`
- **Risk**: Low — activating dead code and wiring it to existing UI. No changes to working features.
