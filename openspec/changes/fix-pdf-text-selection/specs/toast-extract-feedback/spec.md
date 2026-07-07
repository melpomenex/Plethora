## MODIFIED Requirements

### Requirement: Instant highlight creation without dialog
When a user triggers the highlight action from any viewer (PDF selection popup, EPUB selection, HTML selection, RSS selection, or viewer toolbar), the system SHALL create the extract immediately without opening a modal dialog. For PDF selections, the action SHALL only be enabled when the selected text is non-empty and backed by valid PDF selection context from the PDF text layer.

#### Scenario: PDF highlight via selection popup
- **WHEN** user selects text in a PDF and clicks the "Highlight" button in the `SelectionPopup`
- **THEN** the system creates an extract with the selected text using the default highlight color, flashes the selection, and shows a success toast notification

#### Scenario: PDF highlight blocked for invalid selection
- **WHEN** user opens PDF selection actions while the current selection is empty, collapsed, outside the PDF text layer, or from surrounding UI
- **THEN** the system SHALL NOT create an extract
- **THEN** the system SHALL NOT show a success toast for the invalid selection

#### Scenario: EPUB highlight via selection
- **WHEN** user selects text in an EPUB and triggers the highlight action
- **THEN** the system creates an extract with the selected text using the default highlight color and shows a success toast notification

#### Scenario: HTML/Markdown viewer highlight
- **WHEN** user selects text in the HTML/Markdown viewer and triggers the highlight action
- **THEN** the system creates an extract with the selected text using the default highlight color and shows a success toast notification

#### Scenario: RSS article highlight
- **WHEN** user selects text in an RSS article and triggers the highlight action
- **THEN** the system creates an extract with the selected text using the default highlight color and shows a success toast notification
