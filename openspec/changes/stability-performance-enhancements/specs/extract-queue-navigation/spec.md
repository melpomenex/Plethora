## ADDED Requirements

### Requirement: Queue navigation passes extract context
When a user opens an extract item from the queue, the navigation action SHALL pass `extractId` and `sourceContext` (character offset or page number) to the document viewer.

#### Scenario: Opening extract from queue
- **WHEN** the user clicks on an extract item in the queue list
- **THEN** the system SHALL navigate to the parent document's viewer with the `extractId` and source position metadata

### Requirement: Document viewer auto-scrolls to extract position
The `DocumentViewer` SHALL consume a `focusedExtractId` parameter and auto-scroll to the extract's anchored position (character offset for text documents, page for PDFs) on mount.

#### Scenario: PDF extract navigation
- **WHEN** the viewer opens with a `focusedExtractId` pointing to an extract on page 7
- **THEN** the PDF viewer SHALL scroll to page 7 and highlight the extract region

#### Scenario: Text document extract navigation
- **WHEN** the viewer opens with a `focusedExtractId` pointing to a character offset range
- **THEN** the viewer SHALL scroll to that offset and highlight the extract text

#### Scenario: Extract not found gracefully
- **WHEN** the viewer opens with a `focusedExtractId` that cannot be resolved (deleted extract)
- **THEN** the viewer SHALL open the document at page 1 and display no error
