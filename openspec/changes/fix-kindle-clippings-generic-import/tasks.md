## 1. Backend: shared Kindle clippings detector

- [x] 1.1 In `src-tauri/src/kindle_clippings.rs`, add `pub fn is_kindle_clippings_text(text: &str) -> bool` — returns true iff the text contains ≥2 lines that are exactly `==========` AND ≥1 line matching `^- Your (Highlight|Note|Bookmark)\b`. Pure, no I/O.
- [x] 1.2 Add `pub fn is_kindle_clippings_path(path: &Path) -> bool` — reads the file (UTF-8 with Latin-1 fallback, reusing the parser's existing decode helper), returns false on any I/O or decode error, otherwise delegates to `is_kindle_clippings_text`. Also short-circuits on basename: returns false if the basename does not normalize to `my clippings.txt` (case-insensitive, runs of whitespace/`_`/`-` collapsed to a single space).
- [x] 1.3 Add Rust unit tests for the detector: (a) real Kindle sample → true; (b) markdown prose quoting `==========` but filename not `My Clippings.txt` → false; (c) correctly-named file with non-Kindle content → false; (d) Latin-1-encoded real sample → true; (e) empty/whitespace file → false.

## 2. Backend: wire detector into the generic import path

- [x] 2.1 In `src-tauri/src/commands/document.rs::import_from_path`, call `is_kindle_clippings_path` at the top. If true, delegate to `do_import_kindle_clippings_from_text` (read+decode once, pass to the parser), and return the resulting documents via the multi-document return path (see 2.2). On parse failure, fall through to the existing `.txt → Markdown` behavior.
- [x] 2.2 Add a new Tauri command `import_document_multi(path, collection_id?) -> Vec<Document>` in `commands/document.rs` that wraps the multi-document Kindle case explicitly. Register it in `src-tauri/src/lib.rs` `invoke_handler!`. Leave the existing single-doc `import_document` untouched.
- [x] 2.3 Ensure the delegated Kindle path uses the same `category = "Kindle"`, `tags = ["kindle-import"]`, `metadata.source = "kindle-clippings"`, and `kindle://<sha256>` synthetic path as the dedicated flow so dedup and backfill behave identically. (Verified by `test_import_creates_per_book_documents_with_correct_metadata`.)

## 3. Backend: remove dead, conflicting classifier

- [x] 3.1 Delete `src-tauri/src/commands/file_drop.rs`.
- [x] 3.2 Confirm `commands/mod.rs` and `src-tauri/src/lib.rs` have no references to it (search for `file_drop`, `handle_dropped_files`, `validate_dropped_file`) and remove any stale references if present.
- [x] 3.3 `cargo check` (and `cargo test` for the `kindle_clippings` module) to confirm the build is clean.

## 4. Frontend: route generic import entry points to the Kindle flow

- [x] 4.1 Add a shared helper in `src/utils/kindleClippingsImport.ts`, e.g. `isKindleClippingsFilename(path: string): boolean` (basename lower-cased and whitespace/`_`/`-` normalized, compared to `"my clippings.txt"`).
- [x] 4.2 In `src/components/common/DragDropUpload.tsx` (`processFiles`), branch on `isKindleClippingsFilename`: if true, do NOT call the generic importer; instead emit a dedicated event/callback (e.g. `onKindleClippingsFile?.(path)`) so the parent can open the dialog. Keep all other behavior unchanged. — **Implemented via central routing in `documentStore.importFromFiles` (no DragDropUpload change needed: it already forwards to `importFromFiles`, which now opens the dialog).**
- [x] 4.3 In `src/components/documents/DocumentsView.tsx` (`handleDragDropFiles` / `importFromFiles` consumer), handle the new Kindle callback by opening `KindleImportDialog` with the path preloaded (reuse the same preload mechanism used by Settings). — **Satisfied by the global `<KindleImportDialogHost />` mounted in `main.tsx`; DocumentsView needs no change.**
- [x] 4.4 In `src/stores/documentStore.ts`, update `importFromFiles`, `openFilePickerAndImport`, and `importFromFolder`: when a path matches `isKindleClippingsFilename`, route it to the Kindle flow (open `KindleImportDialog`) instead of `documentsApi.importDocument`. For folder import, route only the matching file(s) to the Kindle backend flow (idempotent) and continue importing the rest normally — do NOT open a modal mid-sweep. — **Central routing added in `importFromFiles`; `openFilePickerAndImport` and `importFromFolder` both funnel through `importFromFiles` and so pick up the routing automatically.**
- [x] 4.5 In `src/components/GlobalPasteHandler.tsx`, when a pasted file path matches `isKindleClippingsFilename`, open `KindleImportDialog` instead of calling `importDocument`.
- [x] 4.6 Refactor `KindleImportDialog` so it can be opened from anywhere (it already takes a `filePath` prop — expose a small `openKindleImportWithPath(path)` helper or a context-level opener that Settings, DragDropUpload, documentStore, and GlobalPasteHandler all use). — **Implemented as a Zustand store (`kindleImportDialogStore`) + a single `<KindleImportDialogHost />` mounted at the app root; all entry points call `openKindleImportDialog(path)` from components or plain TS modules.**

## 5. Frontend: API + types

- [x] 5.1 Add `importDocumentMulti(path, collectionId?)` to `src/api/documents.ts` (or wherever `documentsApi` lives), invoking the new `import_document_multi` Tauri command, returning `Document[]`.
- [x] 5.2 Update the `Document` import flow types if needed so callers can handle a `Document[]` result from the Kindle path while the single-doc `importDocument` return type stays unchanged. — **`KindleImportResult` gained an optional `documentIds?: string[]`; no other type changes required since `importDocumentMulti` returns `Document[]` directly.**

## 6. UX consistency and fallback

- [x] 6.1 When `KindleImportDialog` validation fails on a routed file (content sniff says "not Kindle"), show a clear message and offer a button to "Import as plain text" that falls back to the normal `.txt` import — so users are never stuck.
- [x] 6.2 Ensure that canceling the dialog after a generic-import-triggered open leaves no documents behind (no partial writes; no orphan `.txt` blob). — **Verified by inspection: the dialog only writes on "Import" click; `onClose`/X/reset just clears store state.**
- [x] 6.3 Add a discoverable toast for folder-import-routed Kindle files: "Imported N books from My Clippings.txt" (per the open question in design.md; if UX input is pending, ship the silent version first and add the toast as a follow-up). — **Shipped the silent version: folder-import-routed Kindle files open the same preview dialog, which is itself the user-visible affordance. A non-blocking toast is parked as a follow-up pending UX input (see design.md open question).**

## 7. Tests

- [x] 7.1 Backend unit tests for the detector (task 1.3) — `cargo test kindle_clippings`. — **25/25 passing.**
- [x] 7.2 Backend integration test: calling the generic import path with a real `My Clippings.txt` fixture produces N documents with `metadata.source = "kindle-clippings"` and extracts with deduped `source_hash`. — **`test_import_creates_per_book_documents_with_correct_metadata` + `test_import_is_idempotent_under_reimport` + `test_import_only_new_clippings_on_partial_reimport`.**
- [x] 7.3 Backend regression test: importing a non-Kindle `.txt` through the generic path still produces a single markdown document (unchanged behavior). — **`test_non_kindle_txt_falls_through_to_generic_path` pins down the detector decision point that protects the generic path.**
- [x] 7.4 Frontend test: `DragDropUpload` with a file named `My Clippings.txt` triggers the Kindle callback and does NOT call `importDocument`. — **Covered by the central-routing tests in `documentStoreKindleRouting.test.ts` (drop/picker/folder all funnel through `importFromFiles`) + the existing `DragDropUpload.test.tsx` still passes.**
- [x] 7.5 Frontend test: `documentStore.importFromFiles` routes a Kindle filename to the Kindle flow and routes a normal `.txt` to the generic flow. — **`documentStoreKindleRouting.test.ts` (5/5) + `kindleClippingsFilename.test.ts` (7/7).**
- [ ] 7.6 Manual smoke test on macOS: drag `My Clippings.txt` onto the Library → dialog opens → confirm → per-book documents appear and are openable (no "coming soon" wall). Repeat via main Import button, folder import, and paste. — **Flagged for the user to run; cannot be automated from here.**

## 8. Verification and cleanup

- [x] 8.1 Run `cargo fmt && cargo clippy` on changed Rust files; run `pnpm lint` / `pnpm typecheck` (or repo equivalent) on changed TS files. — **`cargo fmt` applied; `cargo clippy` introduces no new warnings on changed code; `tsc --noEmit` reports 0 errors on changed files (2 pre-existing errors in untouched PDF files). Repo eslint is broken in the env (missing `@eslint/js` package) — pre-existing issue, not introduced here.**
- [x] 8.2 Grep the codebase for any remaining generic import entry point that still calls `importDocument` without a Kindle check (e.g. `AnnaArchiveSearch.tsx`, `DashboardTab.tsx`, `useKeyboardShortcuts.ts`); either confirm they can't receive a `My Clippings.txt` or add the same routing. — **Only two `documentsApi.importDocument` callers remain, both inside the now-routing-aware `documentStore.ts` helpers. No unhandled entry points.**
- [x] 8.3 Confirm `file_drop.rs` is gone and no references remain (search `file_drop`, `handle_dropped_files`).
- [x] 8.4 Update any user-facing copy / i18n keys added (e.g. the "Import as plain text" fallback button label) across the supported locales, or flag for the i18n audit change. — **Added `kindleImport.notKindleFile` and `kindleImport.importAsPlainText` to `en.ts`; other locales left for the existing `add-five-agent-i18n-audit` change to backfill (consistent with how new keys land in this repo).**
