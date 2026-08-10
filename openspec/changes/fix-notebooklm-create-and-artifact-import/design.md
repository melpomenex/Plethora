## Context

The NotebookLM panel is a mature feature backed by a real automation layer: `src-tauri/src/notebooklm.rs` (~4400 lines) drives a Python/Playwright subprocess against notebooklm.google.com, with ~25 Tauri commands already registered. The frontend consumes these through `src/api/integrations.ts`.

Two things are broken or missing on top of that working base:

1. **Notebook creation never reaches the backend.** `NotebookLMPage.tsx:512-517` and `:568-572` both do:
   ```js
   setNewNotebookTitle(title);
   handleCreateNotebook();
   ```
   `handleCreateNotebook` closes over the `newNotebookTitle` value from the render in which the click handler was created — still `""` — so the guard at line 193 returns immediately. `setNewNotebookTitle` is never called with a real value anywhere else (`grep` confirms only lines 53, 200, 515, 569), so the state is effectively dead. The failure is silent: the guard returns before the `try`, and the `catch` only does `console.error`. `_isCreating` is underscore-prefixed because nothing consumes it.

2. **Only two of seven artifact types can leave the panel.** `NotebookLMStudio.tsx:148` hardcodes `canImport = artifactType === "flashcards" || artifactType === "quiz"`. The remaining five are gated by `canViewArtifact` (line 231) into a read-only modal. `notebooklm_export_job_artifact` (notebooklm.rs:3560) can serialize a job to JSON/markdown and has a client wrapper at `integrations.ts:863`, but no component calls it, and it handles only flashcards/quiz/rawText — not media or structured JSON.

3. **Two generation types the library supports are unreachable, and one is miswired.** The pinned runtime `notebooklm-py[browser]==0.8.0rc1` exposes `generate slide-deck` and `generate infographic`, but the `match` in `notebooklm.rs:1762-1840` has no arm for either and its `_ =>` arm returns `Unsupported NotebookLM artifact type for CLI provider`. Separately, `generate report` takes `--format briefing-doc|study-guide|blog-post|custom`; the backend has distinct `study-guide` (adds `--format study-guide`) and `report` (no flag → CLI default `briefing-doc`) arms, but the sole UI tile is `id: "report"` with `labelKey: "notebooklmStudio.studyGuide"` — so the Study Guide button produces a briefing doc and the `study-guide` arm is dead code.

Version note: the pin at `notebooklm.rs:2566` is deliberate — 0.8.0rc1 carries the Gemini-rebrand login fix, and the bare spec would resolve to 0.7.3, which can no longer log in. The `generate` flag surface for slide-deck, infographic, and report is byte-identical between 0.3.4 and 0.8.0rc1, so no version bump is required for this change. Note that the package restructured between those versions (`cli/generate.py` → `cli/generate_cmd.py`, `cli/download.py` → `cli/download_cmd.py` + `cli/_download_specs.py`); this change calls the CLI, not the Python API, so the restructure does not reach it.

Constraints: the documents library, `FileType` enum (`Pdf/Epub/Markdown/Html/Youtube/Audio/Video/Other`), podcast pipeline, and queue all already exist. This change should consume them, not extend them.

## Goals / Non-Goals

**Goals:**
- Notebook creation works on the first click and reports its outcome.
- Every artifact type has a defined, honest answer to "can I get this into my library?"
- Every generation type the installed CLI supports as a Studio artifact is reachable from the UI, with its per-type options.
- Users can attach documents they already have to a notebook.
- Reuse existing library storage and playback surfaces.

**Non-Goals:**
- CLI surface beyond generating and downloading Studio artifacts: `revise-slide`, per-source generation scoping (`--source`), output language (`--language`), notes, and sharing. Each is real and each needs its own UI; none is required to close the reported bug or the import gap.
- A NotebookLM-specific media player, document type, or storage table.
- Reworking the Playwright automation, the managed Python runtime, or the auth/CLI login flow.
- Changing how flashcards and quizzes import — that path works.
- PPTX export of slide decks. The CLI offers it, but the app can display PDF and cannot display PPTX, so it would be a download-and-hope path.

## Decisions

### 1. Pass the title as a function argument; delete the state

`handleCreateNotebook(title: string)` takes the title directly. `newNotebookTitle`/`setNewNotebookTitle` are removed entirely.

*Why not `useEffect` on the state change, or a `useRef`, or `flushSync`?* All three keep a state variable whose only purpose is to smuggle an argument into a function that could just take one. The parameter version is a smaller diff and removes the class of bug rather than working around it. Both call sites are fixed by the same change — this is the root-cause fix, not a patch at one caller.

### 2. Replace `window.prompt` with an in-app modal

`window.prompt` is not reliably implemented across Tauri's webviews — on WebKitGTK it requires a host-side handler and otherwise returns null, which would leave Linux users with the same "nothing happens" symptom even after the closure fix. An in-app modal also gives somewhere to put the pending state and the error, which a native prompt cannot.

*Alternative considered:* keep `prompt()` and fix only the closure. Rejected — it fixes macOS and leaves the reported symptom intact elsewhere, and the reporter's platform is not the only one shipped.

### 3. Import maps onto the existing `documents` table and `FileType` enum

| Artifact type | Imports as | Rationale |
|---|---|---|
| `report`, `study-guide` | `FileType::Markdown` document | Text; becomes queue- and extract-eligible for free |
| `mind-map`, `data-table` | `FileType::Markdown` document, JSON in `metadata` | Existing `MindMapViewer`/`ArtifactViewer` read structured content; `metadata` is already a TEXT column |
| `audio` (Audio Overview) | `FileType::Audio` | Podcast pipeline already handles this variant |
| `video` (Video Overview) | `FileType::Video` | Existing video surface already handles this variant |
| `slide-deck` | `FileType::Pdf` | CLI downloads decks as `.pdf`; the library already renders PDFs and generates covers |
| `infographic` | `FileType::Image` (new) | CLI downloads infographics as `.png` |
| `flashcards`, `quiz` | unchanged | Existing `notebooklm_sync_*` commands work |

No new table and no schema migration — `file_type` is a TEXT column, so a new variant is a code change only. Origin (`sourceNotebookId`, `sourceJobId`) goes in the `metadata` JSON, which also backs the already-imported check.

Slide deck as PDF is the reason that half is cheap: `pdf-cover-rendering` and the whole PDF reading surface already exist, so an imported deck is a normal library document with zero new display code.

### 3a. Imports land at the collection library root

Every imported artifact is created at the root of the user's collection library, which is what puts it in front of the Queue. No NotebookLM-specific collection, no nesting by notebook.

*Why not a per-notebook collection?* It would organize artifacts by where they came from rather than what they are, and it would keep them out of the default queue path — which defeats the reason to import. If per-notebook grouping is wanted later, the origin metadata (Decision 3) already carries what a filter would need.

When no collection context resolves, import falls back to the default library root rather than failing. An import that succeeds in the wrong place is recoverable; one that fails loses the artifact.

### 3b. `FileType::Image` is added rather than reusing `Other`

An infographic stored as `Other` is a library entry the user cannot open — imported in name only, and worse in the queue, where it surfaces for review and then cannot be reviewed. Add `Image` to the enum (`models/document.rs:119`), the TS union (`types/document.ts:9`), and a minimal viewer.

*Cost, honestly:* ~120 `FileType::` references across the Rust codebase. Most matches carry `_ =>` arms and are unaffected; the exhaustive ones will fail to compile and list themselves, which is the good failure mode. The frontend is the riskier half — it routes on `fileType === "..."` string comparisons in ~90 places (24 audio, 23 pdf, 21 epub, 17 youtube …), which are if/else chains that silently fall through rather than exhaustive switches. Adding the union member does not make TypeScript flag those; each viewer-routing chain has to be found by hand.

*Alternative considered:* store the infographic as `Other` and special-case it in the NotebookLM viewer only. Rejected — it makes the artifact viewable only from the panel that generated it, which is precisely the view-only trap this change exists to remove, and it puts an unopenable item in the queue.

*Scope note:* there is no image viewer in `src/components/viewer/` today. "Minimal" means displaying the image with the app's existing zoom/pan conventions — not an editor, not annotation. The app already handles images *inside* documents (`DocumentImageAsset`, `image-registry/`, `ImageSaveOverlay`), so the primitives exist; what is missing is an image *as* a document.

### 3c. Infographics are OCR'd on import through the configured provider

Call the existing `ocr_image_file` command (`commands/ocr.rs:137`) after download. It already dispatches to whichever provider the user has configured — `OCRProviderType` covers Tesseract (the default, `ocr/mod.rs:84`), Nougat, Marker, GLM, plus the cloud options — so the import path names no provider at all. Cloud providers are not special-cased: if the user picked one, that is their configuration, and if they picked a local one, that is respected without the import knowing which.

*Why OCR at all:* an infographic is a dense, text-heavy image. Without a text layer it enters the Queue as something the user can look at but not extract from, which makes it a worse queue item than the report that covers the same material.

*Failure posture:* OCR is best-effort. If it fails, or no provider is installed, the image still imports and is still viewable. An import that succeeds with no text layer beats an import that fails because Tesseract is missing.

*Alternative considered:* a dedicated `notebooklm_artifacts` table with its own viewer. Rejected — it duplicates the library and puts imported artifacts outside the queue, which is the main reason to import them at all.

### 4. One artifact-type table drives tiles, `canImport`, and backend dispatch

`ARTIFACT_TYPES` in `NotebookLMStudio.tsx:38-93` *already carries a per-tile `canImport` field* — and line 148 ignores it in favour of a hardcoded `flashcards || quiz`. So the map exists; nothing reads it. Make line 148 read the tile data, and add the two new tiles to the same array.

Note the existing type-string inconsistency: `NotebookLMPage.tsx:224` normalizes `mind-map|mind_map|mindmap` and `data-table|data_table|datatable`, and the Python `ArtifactType` enum uses underscores (`mind_map`, `slide_deck`, `data_table`) while the Rust `normalize_cli_type` converts `_`/space to `-`. Three spellings are in play. Normalize once, in one shared helper used by tiles, viewer, and importer — this is exactly how `slide-deck` and `infographic` ended up in `canViewArtifact` with no way to generate them.

### 5. Media retrieval goes through the CLI's `download` subcommand

`cli/download.py` provides `download audio|video|slide-deck|infographic`, dispatching to `client.artifacts.download_*` through the authenticated session. Use it rather than fetching `job.payload.mediaUrl` over plain HTTP.

*Why:* it removes the question of whether `mediaUrl` is session-scoped or expiring (it sidesteps the URL entirely), it is the same auth path every other command already uses, and it is less code than a fetch-with-auth-headers implementation in Rust. This closes what was an open question in the first draft of this design.

Retrieval is transactional: download to a temp path, verify the transfer completed, then move into place and create the `Document` row. A failure at any step deletes the temp file and creates nothing. This is the one genuinely new failure mode — existing artifact paths only render text already in memory — and a half-downloaded file registered as a library item is a corrupt queue entry the user has to diagnose. Ordering row creation last makes "no row" the only failure state.

### 5a. Audio duration is probed locally; chapters do not exist upstream

**Duration:** the CLI's `Artifact` model carries `id, title, type, status, created_at, url, variant, generation_prompt` and nothing else — no duration field. But duration is already solved locally: `probeAudioDuration` is called from `PodcastManager.tsx:377-387` for any downloaded episode missing a duration, backed by `lofty` (already a dependency, `Cargo.toml:136`, used for cover art in `processor/audio.rs`). An imported audio artifact is a downloaded file with a `podcast_episodes` row whose `duration` column is nullable — which is exactly the case that backfill already handles. Duration costs nothing beyond confirming the existing path fires.

**Chapters:** NotebookLM does not produce them. Searching the entire runtime package for "chapter" returns three hits, all example prompt text (`notebooklm generate audio "deep dive focusing on chapter 3"`). Audio Overviews are single continuous podcasts with no segment markers in the API or the downloaded file. There is no chapter metadata to import, so "100% support" here means correctly carrying everything that exists — which is duration — rather than building chapter plumbing that would never receive data. If NotebookLM adds chapters later, the podcast pipeline is where they would land.

### 6. Study Guide is repointed rather than left alone

The Study Guide tile starts sending `study-guide` (adding `--format study-guide`), and a new Report tile sends `report` (briefing doc). This changes what an existing button produces.

*Alternative considered:* leave Study Guide as-is and add Report alongside, so nothing changes for existing users. Rejected — that permanently ships a button labelled "Study Guide" that generates a briefing doc, and the backend's `study-guide` arm stays dead. The label is the contract; the wiring is the bug.

### 7. Library-document attachment reuses `notebooklm_add_source`

The command already accepts `{notebookId, kind, content, title}`. Attaching a library document is a document picker that reads content from the selected document and calls the existing command — no backend change.

*Trade-off:* this sends content, not a file handle, so very large documents push a large payload through the automation layer. Acceptable for now; see Risks.

### 8. Wire `notebooklmExportJobArtifact` — and fix the bug wiring it exposes

Export is surfaced as an action in the artifact viewer. Two things have to be true first.

**The markdown branch is broken for most types.** `notebooklm.rs:3576-3607` builds its markdown from `payload.flashcards` and `payload.quiz_items` only. For a report, mind-map, or data-table job both are empty, so `lines` stays empty and the export writes an **empty file**. Wiring the button without fixing this ships a feature that silently produces nothing for 7 of 9 types. The branch must also emit `rawText` (reports, study guides) and `jsonContent` (mind-maps, data-tables).

**Export only applies to payload-backed types.** The command returns `content: String`. That works for anything whose substance lives in the payload — flashcards, quiz, report, study-guide, mind-map, data-table. For audio, video, slide-deck, and infographic the artifact *is* a binary file, which a string cannot carry, and saving that file is what **import** already does. So the export action is offered for payload-backed types only. This is not a limitation to work around; it is the correct boundary between the two features.

**Writing the file** uses the established pattern minus the Rust half: `save()` from `@tauri-apps/plugin-dialog` picks the path (as in `DeckManager.tsx:530`), then `writeTextFile` from `@tauri-apps/plugin-fs` writes the returned string. Both plugins are already dependencies. Unlike the `.apkg` export, which passes a path into Rust because the payload is binary and large, this content is already a string in hand — routing it back through Rust to write it would be more code for the same result.

*Alternative considered:* delete the command instead. Rejected — the underlying capability is genuinely wanted (getting a study guide out as markdown), the Rust side is nearly complete, and the missing piece is ~10 lines of frontend plus one match arm.

## Risks / Trade-offs

- **Media downloads may be large or slow** → download off the UI thread with progress reflected in job state; the transactional ordering (Decision 5) means a cancelled or failed download leaves no trace.
- **Expired auth during download** → the job status vocabulary already has `expired-auth`; retrieval must distinguish it from a transfer failure so the user reconnects instead of regenerating.
- **Artifact type spelling drift across three layers** (Decision 4) → Python uses `slide_deck`, Rust normalizes to `slide-deck`, the UI already carries three spellings for mind-map. Normalize in one shared helper, or the next type added drifts the same way these two did.
- **Repointing Study Guide changes existing behaviour** (Decision 6) → the study-guide format is what the label always promised, and old jobs are untouched. Worth a line in the changelog.
- **Larger surface = more to keep working** → this change roughly doubles the artifact types with an import path. The single type table (Decision 4) is what keeps that from being seven parallel code paths.
- **`FileType::Image` is the widest blast radius in this change** (Decision 3b) → it touches document code far outside the NotebookLM feature, and the frontend's `fileType === "..."` chains fail silently rather than at compile time. Land it as its own commit, ahead of the infographic import that needs it, so a regression is bisectable to one change rather than tangled with artifact work.
- **An imported infographic is an image with no text layer** → it will sit in the queue as something the user looks at but cannot extract from. The app has `mistral-ocr-integration` already; running OCR on import would make infographics genuinely reviewable. Deliberately not in this change — see Open Questions.
- **Large library documents as sources** (Decision 7) → cap or warn above a size threshold rather than silently sending a multi-megabyte payload into the automation layer.
- **Duplicate imports** → the already-imported check reads `metadata`, which is a JSON string scan rather than an indexed lookup. Fine at expected job counts; if the Recent Jobs list ever grows large this becomes a linear scan worth indexing.
- **Scope pressure** → "add all the features this library lets us leverage" is open-ended. This design covers the seven tiles that exist. Each new generation type is a UI tile plus an import path plus a viewer; adding them speculatively is how the current view-only gap got here.

## Migration Plan

No data migration — no schema change. The create fix is independently shippable and should land first, since it is a small diff that unblocks manual testing of everything else. Import behavior is additive: existing jobs remain viewable whether or not they are imported.

Rollback: the create fix reverts cleanly. Import is behind new commands, so reverting removes the actions and leaves already-imported library items intact as ordinary documents.

## Open Questions

- ~~Do `mediaUrl` values survive past the Playwright session?~~ **Resolved** — moot. The CLI's `download` subcommand covers audio, video, slide-deck, and infographic through the authenticated session, so the URL is never used (Decision 5).
- ~~Is the CLI version pinned?~~ **Resolved** — pinned to `0.8.0rc1` at `notebooklm.rs:2566` for the Gemini-rebrand login fix. The flags this change needs are unchanged from 0.3.4, so no bump is required.
- ~~Which `FileType` should an infographic use?~~ **Resolved** — a new `Image` variant (Decision 3b).
- ~~Where do imported artifacts land?~~ **Resolved** — the collection library root, so they reach the Queue (Decision 3a).
- ~~Should an imported infographic be OCR'd?~~ **Resolved** — yes, through the user's configured provider via the existing `ocr_image_file` command, best-effort (Decision 3c).
- ~~Does the podcast pipeline need duration/chapter metadata the audio artifact does not carry?~~ **Resolved** — duration is probed locally by the backfill that already exists; chapters do not exist in NotebookLM at all (Decision 5a).
- ~~Export: surface it or delete it?~~ **Resolved** — surface it, for payload-backed types only, and fix the empty-markdown bug that wiring exposes (Decision 8).

No open questions remain. Every decision has been settled against the code.
