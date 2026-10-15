## Why

Users can create a highlight or extract while reading, but cannot undo that choice by right-clicking the saved mark in the source document. They should be able to remove it where they are reading, without finding it in a separate extracts list.

## What Changes

- Add a **Remove highlight/extract** action when right-clicking a persisted annotation in EPUB, PDF, Markdown, HTML, and OCR HTML document readers, including those readers opened from the Queue.
- Resolve the clicked annotation without requiring a live text selection. Preserve the current selection and link menus when no saved annotation is targeted.
- Remove the backing extract through the existing deletion flow, clearing every rendered segment belonging to that extract and updating the reader, extracts list, count, and queue state without reloading the document.
- Keep removal scoped to the chosen saved record, including repeated text and overlapping annotations. Handle failed or stale deletion without removing a different annotation.
- Follow the shared context-menu positioning, dismissal, keyboard, and destructive-action conventions.

## Capabilities

### New Capabilities

- `document-annotation-removal`: Target a saved document highlight/extract through its context menu and persistently remove its backing record and rendered marks.

### Modified Capabilities

None. Existing `readable-reader-highlights`, `context-menus`, and `context-menu-ux` requirements remain applicable; this change adds an annotation-removal workflow rather than changing their rendering or shared menu contracts.

## Impact

- Reader event bridges and context-menu state in `DocumentViewer`, `EPUBViewer`, `PDFViewer`, and `MarkdownViewer`, plus HTML/OCR iframe listeners.
- Persisted highlight descriptors and hit testing for EPUB SVG overlays, PDF fixed/reflow surfaces, and anchored text marks.
- Existing extract deletion API/store, delete confirmation, and dependent view refresh paths. Both Highlight and Create Extract currently save extract records; no separate highlight persistence model is introduced.
- Focused reader/menu and deletion regression tests. No new dependencies or database migration expected.
