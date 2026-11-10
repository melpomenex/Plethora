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
Every extract view SHALL provide a "Return to Source" affordance that opens the parent document and scrolls precisely to the original paragraph, CFI, or page location from which the extract was taken.

#### Scenario: Navigating back to an EPUB source passage
- **GIVEN** an open extract taken from an EPUB document with recorded CFI `epubcfi(/6/14[chap03]!/4/2/8)`
- **WHEN** the user clicks "Return to Source"
- **THEN** the parent EPUB document SHALL open in the reader
- **AND** the reader SHALL scroll to the exact CFI location and briefly pulse the extracted passage

### Requirement: Extract priority inheritance
When enabled in Settings, newly created extracts SHALL inherit the `priority_score` and `canonical_priority` of their parent document.

#### Scenario: Creating an extract from a high-priority document
- **GIVEN** a document with priority set to 90% and priority inheritance enabled
- **WHEN** the user creates a new extract from that document
- **THEN** the new extract's initial priority SHALL be set to 90%
