## ADDED Requirements

### Requirement: Extract mode toggle wired to viewer state
The extract mode toggle button SHALL directly control the active document viewer's extract mode state via the viewer state machine (`useDocumentViewer` / `DocumentViewer`).

#### Scenario: User toggles extract mode on
- **WHEN** the user clicks the "Toggle Extract Mode" button while extract mode is off
- **THEN** the viewer SHALL enter extract mode and display visual indicators (cursor change to crosshair, active mode badge)

#### Scenario: User toggles extract mode off
- **WHEN** the user clicks the "Toggle Extract Mode" button while extract mode is on
- **THEN** the viewer SHALL exit extract mode and restore normal cursor and interaction behavior

### Requirement: Visual indicators across viewer types
Extract mode visual indicators (cursor styling, selection handles, active mode badge) SHALL render consistently across PDF, EPUB, Markdown, and HTML document viewers.

#### Scenario: PDF viewer shows extract mode indicators
- **WHEN** extract mode is active in a PDF document
- **THEN** the cursor SHALL change to crosshair, and an "Extract Mode" badge SHALL be visible in the viewer header

#### Scenario: EPUB viewer shows extract mode indicators
- **WHEN** extract mode is active in an EPUB document
- **THEN** the same visual indicators SHALL appear as in the PDF viewer
