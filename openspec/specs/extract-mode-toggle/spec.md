# extract-mode-toggle Specification

## Purpose
Queue curation is one-item-at-a-time. The store already tracks selectedIds and the backend already exposes batch commands, but nothing in the UI lets a user *build* a selection: there is no Shift + Click range, no Cmd/Ctrl + Click toggle, no Cmd/Ctrl + A, no Escape. BulkActionBar renders three verbs (suspend, unsuspend, delete) out of the eight the workflow needs. Curating a 200-item queue is therefore still 200 interactions.

## Requirements

### Requirement: Extract Mode gates auto-extraction of text selections
While Extract Mode is active in the document viewer, completing a text selection SHALL
create an extract from the selected text without further confirmation. While Extract
Mode is inactive, completing a text selection SHALL retain the current behavior — the
selection popover or menu — and SHALL NOT create an extract. The toggle SHALL therefore
change reader behavior, not only its own appearance.

#### Scenario: Selection auto-extracts when the mode is on
- **WHEN** Extract Mode is active and the user selects a passage of text
- **THEN** an extract SHALL be created from that passage

#### Scenario: Selection does not auto-extract when the mode is off
- **WHEN** Extract Mode is inactive and the user selects a passage of text
- **THEN** no extract SHALL be created and the existing selection affordance SHALL appear

#### Scenario: Toggling off stops auto-extraction
- **WHEN** Extract Mode is active, the user toggles it off, and then selects a passage
- **THEN** no extract SHALL be created

### Requirement: Extract Mode applies to every viewer type
Extract Mode SHALL gate auto-extraction identically in the PDF, EPUB, Markdown, and HTML
viewers. The extract created SHALL carry the position metadata that viewer already
records for manual extracts — page number for PDF, and character or CFI offset for the
text-based viewers — so that the extract remains navigable back to its source.

#### Scenario: PDF selection records its page
- **WHEN** Extract Mode is active in the PDF viewer and the user selects text on page 12
- **THEN** the created extract SHALL record page 12 as its position

#### Scenario: EPUB selection records its position
- **WHEN** Extract Mode is active in the EPUB viewer and the user selects text
- **THEN** the created extract SHALL record the position metadata the EPUB viewer uses for manual extracts

#### Scenario: Markdown and HTML selections auto-extract
- **WHEN** Extract Mode is active in the Markdown or HTML viewer and the user selects text
- **THEN** an extract SHALL be created with that viewer's character-offset position metadata

### Requirement: Extract Mode state is visible and confined to the document view
The Extract Mode control SHALL indicate its active state, and the reader surface SHALL
show a crosshair cursor while the mode is active. The mode SHALL be available only in the
document view mode, and SHALL reset to inactive when the viewer unmounts, so that opening
a document never starts in an unexpected auto-extracting state.

#### Scenario: Active state is indicated
- **WHEN** Extract Mode is active
- **THEN** the toggle SHALL render in its active style and the reader SHALL show a crosshair cursor

#### Scenario: Mode resets on reopen
- **WHEN** the user activates Extract Mode, closes the document, and reopens it
- **THEN** Extract Mode SHALL be inactive

### Requirement: Auto-extraction confirms its result
Each extract created by Extract Mode SHALL produce user-visible feedback confirming
creation. A failure to create the extract SHALL surface an error rather than failing
silently, so the user is never left believing a passage was captured when it was not.

#### Scenario: Successful auto-extraction is confirmed
- **WHEN** Extract Mode creates an extract from a selection
- **THEN** feedback confirming the extract was created SHALL be shown

#### Scenario: Failed auto-extraction surfaces an error
- **WHEN** extract creation fails while Extract Mode is active
- **THEN** an error SHALL be surfaced to the user

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
