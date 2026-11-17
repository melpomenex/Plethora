## Purpose

Isolates text selection and right-click context menu interactions within the Assistant panel so users can select text, preserve their reading scroll position, and invoke Assistant context menu actions without triggering document-viewer extract UI or losing their selection.

## ADDED Requirements

### Requirement: Assistant text selection does not trigger document-viewer extract UI or selection pinning
When the user selects text inside the Assistant panel (including user prompts, assistant markdown responses, or system/artifact blocks) while any document type is open alongside it, the host document viewer SHALL ignore that selection. Selecting text in the Assistant panel SHALL NOT display the document viewer's floating "Create Extract" or "Lookup" action pill, SHALL NOT update the document viewer's active document selection, and SHALL NOT pin the Assistant's own text as a document selection context chip.

#### Scenario: Selecting text in Assistant response alongside an audio or video document
- **WHEN** a user has an audio or video document open with the Assistant panel visible and selects text inside an Assistant message
- **THEN** the native text selection remains highlighted in the Assistant panel
- **AND** the document viewer does NOT show the floating "Create Extract" button
- **AND** the Assistant panel does NOT pin the selected text as a selection context chip

#### Scenario: Selecting text in Assistant response alongside a text or PDF document
- **WHEN** a user has a PDF, EPUB, HTML, or Markdown document open with the Assistant panel visible and selects text inside an Assistant message
- **THEN** the document viewer's selection state and floating extract controls remain unaffected by the Assistant selection

### Requirement: Assistant scroll position is preserved during text selection and right-click
Selecting text or right-clicking anywhere inside the Assistant conversation viewport SHALL NOT jump or reset the conversation scroll position (such as scrolling back to the start of the query or the top of the thread).

#### Scenario: Selecting text while scrolled into a long Assistant response
- **WHEN** a user scrolls down to read an Assistant response and drags or double-clicks to select text within that response
- **THEN** the Assistant conversation viewport remains at the user's current scroll position without jumping to the query or top of the thread

#### Scenario: Right-clicking inside the Assistant panel after scrolling
- **WHEN** a user scrolls to a position in the Assistant conversation and right-clicks either on selected message text or on non-text background space in the panel
- **THEN** the Assistant conversation viewport remains at the same scroll position

### Requirement: Right-clicking in the Assistant panel preserves selection and opens the Assistant context menu
Right-clicking on message text (whether selected or unselected) or on non-text areas of the Assistant panel SHALL open the Assistant context menu without clearing the user's active text selection. When text is selected inside the Assistant panel, the context menu SHALL include selection actions (including Copy Selection, Extract Selection, Ask about Selection, and Summarize Selection) that operate on the selected text.

#### Scenario: Right-clicking selected text in an Assistant message
- **WHEN** a user selects text inside an Assistant message and right-clicks on the selected text
- **THEN** the active text selection is NOT cleared on mouse-down
- **AND** the Assistant context menu opens at the cursor position with selection actions (such as Copy Selection) enabled for the selected text

#### Scenario: Right-clicking outside message text in the Assistant panel
- **WHEN** a user right-clicks on a non-text area of the Assistant panel while text is selected in an Assistant message
- **THEN** the active text selection remains intact and the Assistant context menu opens with the selection actions and general chat actions available
