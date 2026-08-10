## Why

Creating a notebook from the NotebookLM tab silently fails. Both "New Notebook" buttons prompt for a title, then call `setNewNotebookTitle(title)` immediately followed by `handleCreateNotebook()` — which reads `newNotebookTitle` from the *current* render closure (still `""`) and hits the `if (!newNotebookTitle.trim()) return;` guard on `NotebookLMPage.tsx:193`. The state update has not flushed yet, so the create call never reaches the backend and the user sees nothing happen: no error, no toast, no spinner. The backend (`notebooklm_create_notebook`) works fine; only the frontend wiring is broken.

Once a notebook can be created, a second gap becomes visible: of the seven Studio artifact types the app can generate, only Flashcards and Quiz can be brought back into Incrementum. Audio Overview, Video Overview, Study Guide (report), Mind Map and Data Table are view-only — `canImport` is hardcoded to `flashcards || quiz` (`NotebookLMStudio.tsx:148`), and `notebooklm_export_job_artifact` exists in Rust with a frontend wrapper at `integrations.ts:863` but is never called from any component. Work the user generates in NotebookLM cannot leave the panel.

## What Changes

**Notebook creation (the bug)**
- `handleCreateNotebook` takes the title as a parameter instead of reading it from state; the dead `newNotebookTitle` state is removed along with both `setNewNotebookTitle`-then-call sites.
- Replace the two `window.prompt()` call sites with an in-app modal. `window.prompt` is unreliable across Tauri's webviews (unimplemented on WebKitGTK/Linux without a host handler), so even after the closure fix the prompt path would remain platform-dependent.
- Surface failures: the existing `console.error`-only catch becomes a toast, and the already-present-but-unused `isCreating` state drives a disabled/spinner state on the button.
- Creation from the empty state selects the new notebook so the user lands in it directly.

**Adding sources**
- Add an "Add from Library" path to the source picker so users can attach documents already in Incrementum, alongside today's manual text/URL entry (`NotebookLMSidebar.tsx:58`). This is the "let users add their files" half of the request; the `notebooklm_add_source` backend command already accepts the needed shapes.

**New generation types the library already supports**
- Add **Slide Deck** and **Infographic** Studio tiles. The pinned runtime — `notebooklm-py[browser]==0.8.0rc1` (`notebooklm.rs:2566`, pinned for the NotebookLM→Gemini rebrand login fix) — exposes `generate slide-deck` (`--format detailed|presenter`, `--length default|short`) and `generate infographic` (`--orientation`, `--detail`, `--style`), but `notebooklm.rs:1836` falls through to a `_ =>` arm that hard-errors on any type it does not name — so both currently fail at the backend. `canViewArtifact` (`NotebookLMStudio.tsx:231`) already lists `slide-deck` and `infographic`, so the viewer half was anticipated and the generation half never landed.
- Add **Report (briefing doc)** as a distinct tile, and fix the existing one. The CLI's `generate report` takes `--format briefing-doc|study-guide|blog-post|custom`. The backend already has separate `study-guide` and `report` arms — but the only UI tile has id `report` while being labelled `notebooklmStudio.studyGuide`, so **the "Study Guide" button currently generates a briefing doc**, and the `study-guide` arm is unreachable. The Study Guide tile is repointed at `study-guide`; a new Report tile takes `report`.

**Artifact import (the checklist)**
- Answer per type, and make each one true:
  - **Flashcards / Quiz** — already import via `notebooklm_sync_flashcards` / `notebooklm_sync_quiz`. Unchanged.
  - **Study Guide / Report** — import as documents into the library, so they enter the queue and can be extracted from like any other reading material.
  - **Mind Map / Data Table** — structured JSON. Import writes them as a document with the rendered content preserved; they stay viewable through the existing `MindMapViewer` / `ArtifactViewer`.
  - **Audio Overview** — imports as a podcast-type library item, reusing the existing podcast pipeline rather than a NotebookLM-specific player.
  - **Video Overview** — **today the answer is no.** It is view-only via `mediaUrl`. This change retrieves the media and registers it as a library item so it behaves like other video content.
  - **Slide Deck** — imports as a PDF document, which the library already renders covers for. (The CLI can also emit PPTX; PDF is the default and the one the app can display.)
  - **Infographic** — imports as an image document. This requires a new `Image` file type — see below.
- Media retrieval uses the CLI's own `download` subcommand, which covers audio, video, slide-deck and infographic through the authenticated session, rather than fetching `mediaUrl` directly.
- All imported artifacts land at the root of the user's collection library, so they enter the Queue for review on the same terms as any other library item.
- `canImport` becomes a per-type capability lookup rather than a two-value hardcode, and the dead `notebooklmExportJobArtifact` wrapper is either wired to a visible export action or deleted.

**New `Image` file type**
- The `FileType` enum (`models/document.rs:119`) has no image variant, so an infographic — which the CLI downloads as `.png` — would land as `Other` and be an unopenable dead entry in the library and the queue. Add `Image` as a first-class file type with a minimal viewer; the viewer directory has no image component today.
- This is the one part of the change that reaches beyond the NotebookLM feature. It is justified by the same reasoning as the rest: an artifact the user cannot open is not imported, it is merely stored. The type is also generally useful — the app already handles images inside documents (`DocumentImageAsset`, `image-registry/`, `ImageSaveOverlay`), just never as a document.

**Explicitly out of scope:** the CLI surface beyond generation and download of these types — `revise-slide`, per-source generation scoping (`--source`), output language selection, notes, and sharing. Each is a real capability worth having later, but none is required to close the reported bug or the import gap, and each carries its own UI.

## Capabilities

### New Capabilities
- `notebooklm-artifact-import`: Bringing generated NotebookLM artifacts (report, study guide, mind-map, data-table, audio, video, slide deck, infographic) back into the Incrementum library as first-class items, including per-type import eligibility, media retrieval, and placement at the collection library root.
- `notebooklm-artifact-generation-types`: Generating slide decks, infographics, and briefing-doc reports, with the per-type options the CLI exposes, and correcting the Study Guide tile to request the study-guide report format.
- `notebooklm-source-attachment`: Attaching existing Incrementum library documents to a notebook as sources, in addition to manual text/URL entry.
- `image-document-type`: Images as a first-class document type — stored, opened in a viewer, and queue-eligible like any other document.

### Modified Capabilities
- `notebooklm-in-app-workspace`: Notebook creation must reach the backend and report its outcome — title is passed explicitly, failures surface to the user, and the in-flight state is visible. (Spec currently lives in the unarchived `add-notebooklm-integration` change; delta applies there.)

## Impact

- **Frontend**: `src/pages/NotebookLMPage.tsx` (create flow, artifact viewing), `src/components/notebooklm/NotebookLMSidebar.tsx` (source attachment), `src/components/notebooklm/NotebookLMStudio.tsx` (`canImport`, import actions), `src/api/integrations.ts` (import/export client wrappers).
- **Backend**: `src-tauri/src/notebooklm.rs` — new `slide-deck` and `infographic` arms in the `generate_artifact` match (~line 1762) plus the `study-guide`/`report` correction; new import commands per artifact type; media retrieval via the CLI `download` subcommand. Reuses the existing documents table and podcast pipeline rather than adding NotebookLM-specific storage.
- **New file type**: `FileType::Image` in `src-tauri/src/models/document.rs:119`, the `fileType` union in `src/types/document.ts:9`, a minimal image viewer in `src/components/viewer/`, and file-type icons. Roughly 120 `FileType::` references exist across the Rust codebase; most sit in matches with `_ =>` arms, so the compiler will surface the exhaustive ones.
- **No new dependencies.** The pinned `notebooklm-py[browser]==0.8.0rc1` already provides every command this change calls; the Python/Playwright sidecar and managed runtime already exist.
- **Risk**: media retrieval introduces network I/O and disk writes on a path that previously only rendered text; failures must not corrupt the library.
- **Behavioural change**: the Study Guide tile begins producing an actual study guide rather than a briefing doc. Previously generated jobs are unaffected.
