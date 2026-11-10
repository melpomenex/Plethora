## Why

Incremental reading relies on extracting salient passages, clarifying them with commentary, and structuring knowledge into hierarchical outlines before synthesizing flashcards. However, Plethora's extract and notes editor currently lacks indentation controls (indent and outdent toolbar buttons and Tab/Shift-Tab key shortcuts, screenshot 17), making hierarchical outlines impossible. Furthermore, extracts lack bidirectional navigation back to the exact passage in the parent document, and newly created extracts do not inherit priority from their parent document. Enriching extract workflows directly supports SuperMemo-style incremental reading.

## What Changes

- Add Indent and Outdent toolbar buttons and keyboard shortcuts (Tab / Shift-Tab) to `ExtractContentEditor.tsx` and TipTap / rich text extensions.
- Implement deep "Return to Source" navigation in the extract viewer, anchoring to exact EPUB CFI, PDF page/rect, or text offsets in the parent document.
- Support optional priority inheritance: when enabled in Settings, newly created extracts inherit their parent document's priority score.
- Register extract priority inheritance in the Settings Search Catalog (`setting-extract-priority-inheritance`).

## Capabilities

### New Capabilities

- `incremental-reading-extract-workflows`: Hierarchical list and block indentation in extract editors, bidirectional source navigation, and parental priority inheritance for incremental reading items.

### Modified Capabilities

- `add-scroll-mode-extract-editor`: Support rich text indentation within Scroll Mode extract editing.
- `settings-search-coverage`: Register extract priority inheritance in settings catalog.

## Impact

- **Frontend**: `src/components/extracts/ExtractContentEditor.tsx`, `src/components/extracts/ExtractReaderView.tsx`, `src/components/viewer/DocumentViewer.tsx`.
- **Backend**: `src-tauri/src/database/extracts.rs`, `src-tauri/src/commands/extract.rs`.
- **Settings Search**: `src/components/settings/search/settingsSearchCatalog.ts`, `src/components/settings/search/settingsSearchCoverage.ts`.
- **Invariants**: Existing extract HTML bodies remain valid. Extract creations and edits preserve SQLite foreign keys.
