## Why

Users naturally try to bring their Kindle `My Clippings.txt` into the app by dragging it onto the Library or using the main "Import Document" button. Incrementum already has a fully built Kindle clippings parser, but it is only reachable from a single Settings → Import/Export entrypoint. Through every other path the file goes through the generic document importer, which stores it as an unreadable `.txt`/markdown blob that the viewer can't render — it briefly appears in the Queue, then shows "Preview not available / coming soon." The import machinery exists; the generic pipeline just never invokes it.

## What Changes

- Add Kindle-clippings detection to the generic document import path in the Rust backend (`import_from_path`), keyed on filename (`My Clippings.txt`, case-insensitive) plus a content sniff of the `==========` / `- Your (Highlight|Note|Bookmark)` format, and delegate to the existing `kindle_clippings` parser when matched.
- Add a frontend pre-check in the generic import entry points (`DragDropUpload`, `documentStore.importFromFiles`, `openFilePickerAndImport`, `importFromFolder`, `GlobalPasteHandler`) so a detected `My Clippings.txt` opens the existing `KindleImportDialog` for the preview/dedup UX instead of being silently stored as a `.txt` document.
- Remove or wire up the dead `commands/file_drop.rs` (currently unregistered, with a contradictory `.txt → Other` classifier) so there is a single source of truth for `.txt` classification.
- Treat the file path of a generic-imported `My Clippings.txt` as a multi-document source: the importer returns all per-book documents, not a single document.
- If detection runs but the content does not parse as Kindle clippings, fall back to the existing plain-text/markdown behavior so normal `.txt` files are unaffected.

## Capabilities

### New Capabilities
- `kindle-clippings-generic-detection`: Automatic detection of Kindle `My Clippings.txt` files across all import entry points (drag & drop, file picker, folder import, paste) with delegation to the dedicated Kindle clippings parser.

### Modified Capabilities
<!-- No existing spec-level behavior is changing; this restores and extends the intended Kindle import flow. -->

## Impact

- `src-tauri/src/commands/document.rs` — `import_from_path` gains Kindle detection and delegation; may return multiple documents for a single source file.
- `src-tauri/src/commands/file_drop.rs` — delete or rewire; today it is dead code with a conflicting `.txt → Other` classifier.
- `src-tauri/src/kindle_clippings.rs` — expose a reusable `is_kindle_clippings(path_or_bytes)` detector used by the generic import path.
- `src/components/common/DragDropUpload.tsx` — detect `My Clippings.txt` and route to the Kindle import flow.
- `src/stores/documentStore.ts` — `importFromFiles`, `openFilePickerAndImport`, `importFromFolder` route detected Kindle files to `importKindleClippings` / open `KindleImportDialog`.
- `src/components/GlobalPasteHandler.tsx` — same routing for pasted file paths.
- `src-tauri/src/commands/document.rs` Tauri command signature — `import_document` may need to return either a single document or a list when the source is multi-document (Kindle); frontend callers updated accordingly.
- No data migrations: existing wrongly-imported `My Clippings.txt` documents can be re-imported through the dedicated flow; the content-hash dedup prevents duplicate extracts.
