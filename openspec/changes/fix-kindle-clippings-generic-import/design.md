## Context

Incrementum already ships a complete, dedup-safe Kindle clippings import pipeline:

- Backend: `src-tauri/src/kindle_clippings.rs` parses `My Clippings.txt` (split on `==========`, parse title/author/metadata/date/content), creates one `Document` per book (`file_path = kindle://<sha256>`, `FileType::Other`, `category = "Kindle"`, `tags = ["kindle-import"]`, `metadata.source = "kindle-clippings"`, inline `content`), and one `Extract` per highlight/note with a `source_hash` for idempotent re-import. `do_backfill_kindle_imports` retroactively generates FSRS items.
- Frontend: `src/utils/kindleClippingsImport.ts` wraps the Tauri commands; `src/components/import/KindleImportDialog.tsx` shows a per-book new-vs-existing preview; `ImportExportSettings.tsx` hosts the only button that reaches this flow ("Select My Clippings.txt").

The bug: this pipeline is reachable from exactly one entry point. Every other import path — drag & drop (`DragDropUpload.tsx`), the main "Import Document" picker and folder import (`documentStore.ts: importFromFiles / openFilePickerAndImport / importFromFolder`), and clipboard paste (`GlobalPasteHandler.tsx`) — calls `import_document`, whose `import_from_path` (`src-tauri/src/commands/document.rs:212-302`) classifies purely by extension: `.txt → Markdown`, content stored verbatim. The resulting document points at the raw clippings text and renders as a single garbled markdown blob (or, via the dead `file_drop.rs:75` which classifies `.txt → Other`, hits the DocumentViewer "preview not available / coming soon" wall at `DocumentViewer.tsx:5998+`). Either way the user sees exactly what they reported: it flashes in the Queue, then can't be displayed.

Two unrelated facts make the bug worse and are in scope to clean up:

1. `src-tauri/src/commands/file_drop.rs` is dead code — not declared in `commands/mod.rs`, not registered in `lib.rs`'s `invoke_handler!`. It also classifies `.txt → Other`, contradicting the live classifier. Leaving a second, unreachable classifier around is a trap.
2. The Kindle documents produced today are displayable only by accident: `FileType::Other` + populated `content` causes `inferFileType` (`DocumentViewer.tsx:613`) to coerce to `markdown`. Any regression in content population would push every Kindle doc into the "coming soon" wall.

The viewer dispatch (`DocumentViewer.tsx`) has no `text`/`txt`/`kindle` branch in its `DocumentType` union. We are not adding one — Kindle docs already render via the markdown coercion, and the fix is about routing, not rendering.

## Goals / Non-Goals

**Goals:**
- Make every generic import entry point detect `My Clippings.txt` and delegate to the existing Kindle parser, so dropped/picked/pasted/folder-imported clippings produce readable per-book documents with extracts instead of unreadable `.txt` blobs.
- Single source of truth for Kindle detection, shared across backend and frontend.
- Preserve the existing preview/dedup UX (open `KindleImportDialog`) regardless of entry point — no silent bulk writes.
- Leave normal `.txt` imports completely unchanged (detection requires both filename and content sniff).
- Remove the dead, conflicting `file_drop.rs` classifier so there is one import-classification code path.

**Non-Goals:**
- Adding a dedicated `text`/`kindle` viewer branch or new `FileType` variant. Kindle docs continue to render via inline `content` + markdown coercion.
- Changing the `My Clippings.txt` parser itself — it already works.
- Migrating or repairing documents that were mis-imported in older sessions. The content-hash dedup makes re-import through the fixed flow safe; users can delete the old blob manually. (A one-click "re-import as Kindle" affordance on existing mis-imported `.txt` docs is a possible follow-up but not required here.)
- Auto-detecting Kindle clippings pasted as raw text (only file-path paste is in scope).
- Kindle `vocab.db` / KFX / USB-attached Kindle support.

## Decisions

**1. Detection = filename AND content sniff, never either alone.**
A file is treated as Kindle clippings iff (a) its basename normalizes to `my clippings.txt` (case-insensitive, treating runs of whitespace and `_`/`-` as equivalent to a single space), AND (b) its decoded text (UTF-8 with Latin-1 fallback, matching the existing parser) contains at least two `==========` separators and at least one metadata line matching `^- Your (Highlight|Note|Bookmark)\b`.
- Why both: filename alone produces false positives (users legitimately have other `My Clippings.txt` files); sniff alone risks misdetecting prose that happens to contain the separator. Requiring both makes the fallback to plain-text import the common case for non-Kindle `.txt` files.
- Alternative considered: filename only. Rejected — false positives silently overwrite a user's mental model of what was imported.
- Alternative considered: sniff only. Rejected — a markdown note quoting the format would match.

**2. The detector lives in `kindle_clippings.rs` as a pure function and is reused by `import_from_path`.**
New `pub fn is_kindle_clippings_text(text: &str) -> bool` (pure, no I/O) plus `pub fn is_kindle_clippings_path(path: &Path) -> bool` (reads the file and calls the text variant). `import_from_path` calls `is_kindle_clippings_path` first; if true, it delegates to `do_import_kindle_clippings_from_text` and returns the resulting `Vec<Document>` instead of a single document.
- Why backend-first: a single backend chokepoint covers paste, folder import, Anna's Archive download, and any future entry point automatically. The frontend routing (decision 4) is layered on top for the preview UX.

**3. `import_document` returns a flexible shape; we standardize on `Vec<Document>` (or `Document | Document[]`).**
Today `import_document` returns a single `Document`. Kindle clippings produce many. Two viable shapes:
- (a) Change the command return type to `Vec<Document>` and update all frontend callers to read `[0]` for the single-doc case, or
- (b) Add a separate command (`import_document_multi`) and have the frontend call it when Kindle detection fires, leaving `import_document` untouched.

Chosen: **(b) add `import_document_multi`**. It avoids touching every existing single-document caller and keeps the multi-doc return shape localized to the Kindle case. If the frontend has already routed the file to the Kindle flow (decision 4), this command is rarely needed — but it exists as the backend safety net for entry points that bypass the frontend (e.g., backend-initiated imports).

- Alternative considered: change `import_document` to `Vec<Document>`. Rejected — wider blast radius, and most callers expect one document.

**4. Frontend generic importers sniff by basename and route to the Kindle flow, opening `KindleImportDialog`.**
`DragDropUpload.processFiles`, `documentStore.importFromFiles / openFilePickerAndImport / importFromFolder`, and `GlobalPasteHandler` each check `basename(path).toLowerCase() === "my clippings.txt"`. On match they do NOT call `importDocument`; instead they open `KindleImportDialog` with the path preloaded (the dialog already does its own validate→import with dedup). If the dialog's validation fails (content sniff rejects), the dialog reports "not a Kindle clippings file" and the user can fall back to manual import.
- Why frontend routing when the backend also detects: the dialog's preview/dedup UX is the product behavior we want at the entry points; backend detection (decisions 2–3) is the safety net for paths that skip the frontend (folder imports triggered headlessly, backend-driven downloads).
- Filename-only sniff on the frontend is acceptable because the backend does the authoritative content sniff and the dialog validates before writing.
- Alternative considered: skip frontend routing and let the backend return multiple docs silently. Rejected — bypasses the preview UX and would bulk-write many documents without consent.

**5. Delete `commands/file_drop.rs`.**
It is unregistered dead code with a contradictory `.txt → Other` classifier. Deleting it removes the trap and leaves `document.rs::import_from_path` as the sole live classifier. If a future drag/drop backend hook is needed, it should be wired through `commands/mod.rs` and share the Kindle detector.
- Alternative considered: rewire and register it. Rejected — it duplicates `import_from_path` with no current caller; resurrecting dead code is riskier than removing it.

**6. Detection tolerates encoding the same way the parser already does.**
UTF-8 first, Latin-1 fallback (the existing parser handles Latin-1 `My Clippings.txt` from older Kindles). The detector reuses the same decode helper so a file the parser would accept is one the detector flags.

## Risks / Trade-offs

- [Risk] Users with a legitimately-named `My Clippings.txt` that is NOT Kindle clippings now get routed to the Kindle dialog instead of a normal text import. → Mitigation: the dialog validates and rejects non-Kindle content with a clear message; the content sniff means the detector won't fire for unrelated content even if the frontend routing does.
- [Risk] Backend `is_kindle_clippings_path` reads the file once for detection and the parser reads it again. → Mitigation: files are small (typically <1 MB). If this matters, the parser can accept pre-decoded text and the detector can hand it through. Acceptable for now.
- [Risk] Changing `import_from_path` to return `Vec<Document>`-shaped output for Kindle breaks the single-doc expectation of some backend callers. → Mitigation: decision 3 keeps `import_document` returning one doc and isolates the multi-doc case in `import_document_multi`.
- [Risk] Folder import that contains `My Clippings.txt` mixed with many other files must not balloon into a modal for one file. → Mitigation: folder-import path imports the clippings file via the backend Kindle flow (which is idempotent/dedup) and the other files normally; the modal preview is only opened for explicit single-file drops/picks/pastes, not for folder sweeps.
- [Risk] Users who already mis-imported `My Clippings.txt` in a prior session still have dead `.txt` blobs in their library after this fix. → Mitigation: non-goal for this change (see Non-Goals); the dedup-safe re-import path lets users clean up manually. Note as a follow-up.

## Migration Plan

No schema migration. Deploy steps:
1. Ship the backend detector + `import_document_multi` + removal of `file_drop.rs`.
2. Ship the frontend routing in the four generic entry points + `KindleImportDialog` preload.
3. For users with existing mis-imported `My Clippings.txt` blobs: the fixed flow produces the same `kindle://<sha256>` documents with the same `source_hash`-deduped extracts, so re-importing through any generic entry point will not duplicate anything. Users can delete the old `.txt` blob manually.

Rollback: revert the frontend routing first (restores prior drag/drop behavior); revert the backend detector second. No data is written by detection itself.

## Open Questions

- Should we add a one-click "Re-import as Kindle clippings" action on existing `.txt` documents whose content matches the Kindle sniff, to clean up prior mis-imports automatically? (Listed as a follow-up; not required for this change.)
- For folder import, do we want a non-blocking toast ("Imported N books from My Clippings.txt") instead of silently delegating to the backend Kindle flow? Lean yes for discoverability; pending UX input.
