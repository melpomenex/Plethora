## ADDED Requirements

### Requirement: Native PDF text selection
The system SHALL allow users to select text on PDF pages that expose a PDF text layer using normal browser-style drag or long-press selection behavior.

#### Scenario: User selects text on a text-backed PDF page
- **WHEN** a user drags across text on a PDF page with an accessible text layer
- **THEN** the viewer SHALL preserve a non-empty native text selection
- **THEN** the selected text SHALL match the visible PDF text range selected by the user

#### Scenario: Selection remains usable after pointer release
- **WHEN** a user completes a PDF text selection gesture
- **THEN** the selected text SHALL remain available for copy, highlight, and extract actions
- **THEN** viewer scroll or drag handlers SHALL NOT immediately clear the selection

#### Scenario: User selects text after zoom or layout changes
- **WHEN** a user changes PDF zoom, fit mode, or page layout and then selects text
- **THEN** the viewer SHALL keep the selectable text layer aligned with the rendered page
- **THEN** the selected text SHALL correspond to the visible text range under the gesture

### Requirement: PDF selection copy
The system SHALL preserve normal platform copy behavior for selected PDF text.

#### Scenario: User copies selected PDF text
- **WHEN** a user selects text on a text-backed PDF page and invokes copy using the keyboard, context menu, or selection popup
- **THEN** the clipboard text SHALL contain the selected PDF text
- **THEN** the user SHALL NOT need to invoke a separate extraction command just to copy the selection

### Requirement: Valid PDF selection context
The system SHALL emit PDF selection context only when the active selection originates from PDF text-layer content.

#### Scenario: Selection originates from PDF text layer
- **WHEN** a user selects text whose anchor and focus are inside PDF text-layer roots
- **THEN** the viewer SHALL emit the selected text with PDF document and page context
- **THEN** downstream extract, highlight, and learning-item actions SHALL receive that PDF selection context

#### Scenario: Selection includes surrounding UI text
- **WHEN** the current browser selection includes toolbar, footer, sidebar, popup, or other non-PDF UI text
- **THEN** the PDF viewer SHALL exclude non-PDF UI text from PDF selection context
- **THEN** PDF extract and highlight actions SHALL NOT be enabled from that invalid selection

#### Scenario: Empty or collapsed PDF selection
- **WHEN** the current PDF selection is empty, collapsed, or whitespace-only
- **THEN** the viewer SHALL clear PDF selection context
- **THEN** PDF extract and highlight actions SHALL remain disabled

#### Scenario: Image-only PDF page has no text layer
- **WHEN** a user attempts to select text on a PDF page without accessible text-layer content
- **THEN** the viewer SHALL NOT report a false PDF text selection
- **THEN** selection-based PDF extract and highlight actions SHALL remain disabled

### Requirement: PDF selection actions
The system SHALL let users create highlights, extracts, learning items, or flashcards from valid selected PDF text without manual copy/paste.

#### Scenario: User highlights selected PDF text
- **WHEN** a user selects valid PDF text and triggers the highlight action
- **THEN** the system SHALL create an extract/highlight using the selected text
- **THEN** the resulting record SHALL retain source document and PDF page context when available

#### Scenario: User creates an extract from selected PDF text
- **WHEN** a user selects valid PDF text and triggers extract creation
- **THEN** the extract creation flow SHALL be prefilled with the selected PDF text
- **THEN** the extract payload SHALL include the PDF selection context when available

#### Scenario: User creates a learning item or flashcard from selected PDF text
- **WHEN** a user starts a learning-item or flashcard creation flow from selected PDF text
- **THEN** the selected PDF text SHALL be available to that flow without manual re-entry
- **THEN** the created item SHALL retain source document and PDF page context when available
