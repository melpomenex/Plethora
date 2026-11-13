## Purpose

Enhance extract note editing with indentation controls, establish seamless return-to-source navigation, and support priority inheritance from parent documents.

## ADDED Requirements

### Requirement: Hierarchical indentation in extract note editor
The extract rich text editor SHALL provide Indent and Outdent actions in its toolbar and respond to `Tab` and `Shift+Tab` keystrokes within list items to increase or decrease nesting levels.

#### Scenario: Indenting a sub-point in an extract note
- **GIVEN** an active list item in `ExtractContentEditor`
- **WHEN** the user presses `Tab` or clicks the Indent toolbar button
- **THEN** the list item SHALL be nested under the preceding item as a sub-list
- **AND** focus SHALL remain within the editor text

### Requirement: Bidirectional return to source navigation
Extract views SHALL offer Return to Source. When the stored locator resolves against the current revision, it SHALL open the exact location. Stale or ambiguous locations SHALL expose a document-level fallback with an explanation.

#### Scenario: Navigating back to an EPUB source passage
- **GIVEN** an open extract taken from an EPUB document with recorded CFI `epubcfi(/6/14[chap03]!/4/2/8)`
- **WHEN** the user clicks "Return to Source"
- **THEN** the parent EPUB document SHALL open in the reader
- **AND** the reader SHALL scroll to the exact CFI location and briefly pulse the extracted passage

### Requirement: Extract priority inheritance
When enabled in Settings, newly created extracts SHALL inherit the effective manual priority of their parent document, preserving an explicit priority override.

#### Scenario: Creating an extract from a high-priority document
- **GIVEN** a document with priority set to 90% and priority inheritance enabled
- **WHEN** the user creates a new extract from that document
- **THEN** the new extract's initial priority SHALL be set to 90%

### Requirement: Direct cloze creation from reader selection

Supported reader selections SHALL open an editable prefilled cloze draft and save directly as a source-linked learning item.

#### Scenario: Save a reader cloze without an extract

- **WHEN** the user selects source text, chooses Create Cloze and saves a valid draft
- **THEN** the card appears in eligible Review and document-associated cards with the source locator
- **AND** no extract is created

### Requirement: Extract and Reschedule is an atomic reading action

The combined action SHALL persist the new extract and the requested source schedule/lifecycle together with explicit independent queue membership and priority choices.

#### Scenario: Source reschedule fails

- **WHEN** the source schedule write fails during the combined operation
- **THEN** no extract or schedule change commits and the selection and dialog remain recoverable

#### Scenario: Successful save response is lost

- **WHEN** the user retries the same operation ID with the original payload
- **THEN** the existing receipt is returned and only one extract exists
