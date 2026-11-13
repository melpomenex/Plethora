## Why

Readers need to distinguish passages they have already extracted from ordinary highlights. Current extract-backed annotations render in PDF, EPUB, HTML and Markdown, while the display lacks a separately controllable processed-passage state.

## What Changes

- Reuse the persisted locator and existing renderer projections for exact processed-passage markers.
- Add a per-reader visibility control, distinguish ordinary highlights visually, and make markers open their extracts.
- Qualify exact-anchor support by reader type and preserve old highlights, annotation metadata and reading position.

## Capabilities

### New Capabilities

- `document-highlighting` includes the existing extract-backed annotation behavior and the processed-passage marker requirement.

### Modified Capabilities

This change carries one delta for the capability listed above.

## Impact

DocumentViewer highlight projections, PDF/EPUB/HTML/Markdown renderer adapters, and current extract persistence and navigation. The [extract workflow change](../enhance-incremental-reading-extract-workflows/) owns the shared source return behavior.
