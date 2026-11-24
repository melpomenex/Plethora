## ADDED Requirements

### Requirement: PDF highlights align with the rendered page content box across zoom and rotation

`PdfPageViewWrapper`, `HighlightLayer`, and `SelectionOverlay` SHALL use the reactive PDF.js `viewport` and align overlay coordinates with `.page`'s content box across initial load, zoom, resize, and rotation.

#### Scenario: Zooming a PDF updates highlight overlay positions immediately
- **WHEN** a PDF page with persisted highlights is zoomed from 100% to 160%
- **THEN** `HighlightLayer` receives the updated 160% `viewport` and renders highlights aligned with the text layer

### Requirement: Library Saved Views persist and apply all filter dimensions

Library Saved Views SHALL save and restore `selectedCategory`, `selectedFileType`, `compactFilter`, `captureSource`, search query, sort configuration, and view mode, and switching back to the default view SHALL reset them.

#### Scenario: Applying a Saved View filters documents by saved category
- **WHEN** the user filters Documents by category `"Finance"`, saves the view as `"Finance"`, clears filters, and then selects `"Finance"` from Saved Views
- **THEN** `selectedCategory` is restored to `"Finance"` and only matching documents are displayed
