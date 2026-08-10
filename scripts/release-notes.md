### Added

- **NotebookLM artifact import** — every Studio artifact type can now be brought into your library: Reports and Study Guides import as Markdown documents; Mind Maps and Data Tables keep their interactive viewers; Audio Overviews import as podcast-style items, Video Overviews as video items; Slide Decks import as PDFs; and Infographics import as image documents that are also added to the Image Registry (deduplicated by content). Imported artifacts land at the collection library root and become Queue-eligible.
- **Image document type** — images are now a first-class file type with their own viewer (display, zoom, pan), shown distinctly in library listings and tabs.
- **Slide Deck and Infographic generation** — two new Studio tiles with per-type options (deck format/length, infographic orientation/detail/style), plus a dedicated Report tile.
- **Artifact viewer actions** — Copy, Copy as Markdown, Save to Library (honors the active collection), and Export via the native save dialog.
- **Playback position memory** — video and audio artifacts remember where you left off, and the position carries over when the artifact is imported into the library.
- **Handbook search** — search the in-app handbook with jump-to-match navigation.
- **Attach library documents as sources** — pick an existing library document to add as a NotebookLM source, with pending-status tracking and duplicate detection.

### Fixed & Improved

- **Notebook creation works on the first click** — the title is sent directly to NotebookLM via an in-app dialog (no more `window.prompt`/closure bug), with spinner and error toasts; creating from the empty state selects the new notebook.
- **Artifact viewing fixed for images, PDFs, video, and audio** — infographics display as images and slide decks as PDFs; video/audio now resolve through the app's media pipeline with a blob fallback, so previously "unplayable" artifacts play.
- **Study Guide now produces a study guide** — the tile was previously generating a briefing doc; the backend `study-guide` arm is now reachable.
- **NotebookLM CLI JSON parsing fixed** — notebook creation and source-add now parse the pinned CLI's nested output shapes, so both operations succeed instead of failing with "did not return ID".
- **Handbook translation pipeline fixed** — translated handbooks no longer lose paragraph breaks (table rows/list items glued to paragraphs) and fullwidth/marker characters are normalized.
