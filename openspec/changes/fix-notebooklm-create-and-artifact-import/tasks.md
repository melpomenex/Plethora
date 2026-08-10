## 1. Fix notebook creation (ship independently)

- [x] 1.1 Change `handleCreateNotebook` in `src/pages/NotebookLMPage.tsx:192` to take `title: string` as a parameter and guard on that parameter instead of state
- [x] 1.2 Delete the `newNotebookTitle` / `setNewNotebookTitle` state (`NotebookLMPage.tsx:53`, `:200`) — it exists only to smuggle the title into the handler
- [x] 1.3 Replace the `window.prompt` call at `NotebookLMPage.tsx:512-517` (sidebar button) with an in-app title modal that calls `handleCreateNotebook(title)` directly
- [x] 1.4 Replace the `window.prompt` call at `NotebookLMPage.tsx:568-572` (empty-state button) with the same modal
- [x] 1.5 Rename `_isCreating` to `isCreating` and wire it to a disabled + pending state on the modal's confirm control
- [x] 1.6 Replace the `console.error` in the create `catch` with a user-visible error toast
- [x] 1.7 Verify creation from the empty state selects the new notebook (already in `handleCreateNotebook`; confirm it still holds after the refactor)
- [ ] 1.8 Run the app and create a notebook from both buttons; confirm it appears in the sidebar list and becomes active

## 2. Shared artifact-type handling

- [x] 2.1 Extract the artifact-type normalization currently inlined at `NotebookLMPage.tsx:224` into one shared helper, covering all three spellings in play (UI `mind-map`, Python `mind_map`/`slide_deck`/`data_table`, Rust `normalize_cli_type`)
- [x] 2.2 Make `ARTIFACT_TYPES` (`NotebookLMStudio.tsx:38-93`) the single source of truth — it already has a per-tile `canImport` field that nothing reads
- [x] 2.3 Replace the hardcoded `canImport` at `NotebookLMStudio.tsx:148` with a lookup against the tile data, and correct the now-stale `canImport: false` values
- [x] 2.4 Point `canViewArtifact` (`NotebookLMStudio.tsx:231`) at the shared normalization so the viewer and importer cannot disagree on a type string
- [x] 2.5 Gate the import action on job status so queued/running/failed/expired-auth jobs offer no import
- [x] 2.6 Add an assert-based check that every Studio tile resolves in both the import map and the backend dispatch — this is what would have caught `slide-deck`/`infographic` sitting in `canViewArtifact` with no way to generate them

## 3. New generation types

- [x] 3.1 Add a `slide-deck` arm to the `generate_artifact` match in `src-tauri/src/notebooklm.rs:1762`, emitting `generate slide-deck [description] --format detailed|presenter --length default|short --wait --json`
- [x] 3.2 Add an `infographic` arm emitting `generate infographic [description] --orientation landscape|portrait|square --detail concise|standard|detailed --style <style> --wait --json`
- [x] 3.3 Add `slide-deck` and `infographic` to `cli_list_filter_for` (`notebooklm.rs:1226`) so job listing filters correctly
- [x] 3.4 Fix the Study Guide tile to send `study-guide` instead of `report`, activating the existing `--format study-guide` arm that is currently unreachable
- [x] 3.5 Add a distinct Report tile sending `report` (briefing-doc), with its own label/description i18n keys
- [x] 3.6 Add Slide Deck and Infographic tiles to `ARTIFACT_TYPES` with icons, colors, and `canImport: true`
- [x] 3.7 Extend `GenerateArtifactRequest` (`src/api/integrations.ts:657`) with the per-type option fields, and show each option only for the types that accept it
- [x] 3.8 Confirm the `_ =>` arm still returns its "Unsupported artifact type" error for genuinely unknown types rather than being loosened
- [ ] 3.9 Generate one slide deck and one infographic against a real notebook and confirm both reach `succeeded`

## 4. Image document type (land as its own commit)

- [x] 4.1 Add `Image` to the `FileType` enum in `src-tauri/src/models/document.rs:119` and to the string mapping in `commands/document.rs:951`
- [x] 4.2 Build and fix the exhaustive `match` sites the compiler surfaces (~120 `FileType::` references exist; most have `_ =>` arms and will not error)
- [x] 4.3 Add `"image"` to the `fileType` union in `src/types/document.ts:9`
- [x] 4.4 Find and update the frontend `fileType === "..."` routing chains — these fall through silently rather than failing to compile, so grep for all of them rather than trusting the type checker
- [x] 4.5 Add a minimal image viewer to `src/components/viewer/` following the existing viewer conventions — display, zoom/pan, no editing
- [x] 4.6 Route image documents to the new viewer from the document open path and from the queue
- [x] 4.7 Add a file-type icon and label for image documents in the library listing
- [x] 4.8 Show an explanatory message when an image file is missing or cannot be decoded, rather than an empty view
- [x] 4.9 Verify a document stored as `Other` still opens exactly as before
- [ ] 4.10 Verify an image document reaches the queue and opens in the image viewer from there

## 5. Text and structured artifact import

- [x] 5.1 Add a Rust import command that creates a `Document` from a completed job, writing source notebook + job ids into the document's `metadata` JSON
- [x] 5.2 Import `report` and `study-guide` jobs as `FileType::Markdown` from the job's text payload
- [x] 5.3 Import `mind-map` and `data-table` jobs as `FileType::Markdown` with the structured JSON preserved in `metadata`
- [x] 5.4 Decline import with an explanatory error (and create no document) when a structured job has absent or unparseable JSON content
- [x] 5.5 Add the already-imported check: reject re-import of a job id already recorded in an existing document's metadata, telling the user rather than silently duplicating
- [x] 5.6 Add the frontend client wrapper in `src/api/integrations.ts` and the import action in the Studio job list
- [ ] 5.7 Verify an imported Study Guide appears in the library and is queue-eligible
- [ ] 5.8 Verify an imported mind-map still renders through `MindMapViewer` rather than as raw text

## 6. Media artifact import

- [x] 6.1 Add a Rust retrieval path invoking the CLI's `download <type>` subcommand (`cli/download_cmd.py` + `cli/_download_specs.py` in 0.8.0rc1 cover audio, video, slide-deck `.pdf`, infographic `.png`) rather than fetching `mediaUrl`
- [x] 6.2 Implement retrieval to a temp path, off the UI thread, with progress reflected in job state
- [x] 6.3 Register the media as a `Document` only after the transfer completes and verifies — move into place, then create the row
- [x] 6.4 On any retrieval failure, delete the temp file and create no document; surface the failure to the user
- [x] 6.5 Distinguish an auth failure from a transfer failure so the user is told to reconnect rather than regenerate
- [x] 6.6 Import `audio` as `FileType::Audio` and confirm it plays through the existing podcast surface
- [ ] 6.7 Confirm the existing `probeAudioDuration` backfill (`PodcastManager.tsx:377-387`, lofty-backed) populates duration for the imported episode — no new probing code should be needed
- [x] 6.8 Import `video` as `FileType::Video` and confirm it plays through the existing video surface
- [x] 6.9 Import `slide-deck` as `FileType::Pdf` and confirm the library renders it and generates a cover
- [x] 6.10 Import `infographic` as `FileType::Image` (depends on group 4) and confirm it opens in the image viewer
- [x] 6.11 Run OCR on imported infographics via the existing `ocr_image_file` command (`commands/ocr.rs:137`), letting it dispatch to the user's configured provider — do not name a provider in the import path
- [x] 6.12 Make OCR best-effort: on failure or with no provider installed, still import the image and surface no blocking error
- [ ] 6.13 Verify an extract can be created from the OCR'd text of an imported infographic
- [x] 6.14 Create every imported document at the collection library root and confirm each one reaches the Queue
- [x] 6.15 Fall back to the default library root when no collection context resolves, rather than failing the import
- [x] 6.16 Verify a retry after a failed download produces exactly one library item

## 7. Attach library documents as sources

- [x] 7.1 Add a library document picker to the add-source control in `src/components/notebooklm/NotebookLMSidebar.tsx:58`, alongside the existing text/URL entry
- [x] 7.2 Read the selected document's content and submit it through the existing `notebooklm_add_source` command (no backend change)
- [x] 7.3 Detect and report when the selected document is already a source on the active notebook instead of attaching a duplicate
- [x] 7.4 Replace the `console.error`-only failure path so attachment errors are visible to the user
- [x] 7.5 Warn (or cap) when the selected document exceeds a size threshold before pushing its content through the automation layer
- [ ] 7.6 Verify an attached document shows pending status until NotebookLM finishes ingesting it

## 8. Cleanup and verification

- [x] 8.1 Fix the markdown branch in `notebooklm_export_job_artifact` (`notebooklm.rs:3576-3607`) to emit `rawText` and `jsonContent` — today it reads only flashcards/quiz, so reports, mind-maps, and data-tables export as an **empty file**
- [x] 8.2 Return an explicit "nothing to export" error when a job's payload carries no content, instead of writing an empty file
- [x] 8.3 Add an export action to the artifact viewer, offered only for payload-backed types (flashcards, quiz, report, study-guide, mind-map, data-table)
- [x] 8.4 Wire it with `save()` from `@tauri-apps/plugin-dialog` (pattern at `DeckManager.tsx:530`) plus `writeTextFile` from `@tauri-apps/plugin-fs`, using the command's returned `fileName` as the default path and a filter matching the chosen format
- [x] 8.5 Handle a cancelled picker as a no-op, and a failed write as a visible error
- [x] 8.6 Verify each payload-backed type exports non-empty content in all three formats (json, markdown, html)
- [x] 8.7 Confirm no export action appears for audio, video, slide-deck, or infographic
- [x] 8.8 Add the i18n keys for the new modal, tiles (Report, Slide Deck, Infographic), generation options, import actions, picker, image viewer, and error messages
- [x] 8.9 Note both behaviour changes in the changelog — the Study Guide tile now produces a study guide rather than a briefing doc, and images are a new document type
- [ ] 8.10 Walk the full flow in the running app: create notebook → attach a library document → generate one artifact of each type → import each → confirm each lands at the library root and reaches the Queue
- [ ] 8.11 Confirm each checklist item is demonstrable: Video Overview imports, and Mind Map / Quiz / Audio Overview / Study Guide / Report / Data Table / Slide Deck / Infographic each have a working import or an explicit, visible reason they do not
