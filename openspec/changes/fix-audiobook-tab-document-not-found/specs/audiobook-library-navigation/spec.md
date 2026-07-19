## ADDED Requirements

### Requirement: Opening an audiobook from the Audiobooks tab opens the viewer
When a user taps an audiobook entry in the Audiobooks tab, the system SHALL open a document viewer tab for that same audiobook and SHALL NOT show a "Document not found" state for a document that exists in the library.

#### Scenario: Open an audiobook immediately after import
- **WHEN** a user imports an audiobook and then taps it in the Audiobooks tab
- **THEN** the document viewer opens and renders the audiobook, ready to play

#### Scenario: Open an audiobook whose viewer tab is not immediately active
- **WHEN** a user taps an audiobook in the Audiobooks tab and the resulting document viewer tab is not the active tab at the moment it is created
- **THEN** the system still loads the document data so that switching to that tab shows the audiobook rather than "Document not found"

#### Scenario: Concurrent document list refreshes do not drop the opened audiobook
- **WHEN** another part of the app refreshes the shared document list (e.g. with a different collection scope) around the same time a document viewer tab is opened for an audiobook
- **THEN** the audiobook document viewer still resolves and displays the audiobook, rather than losing track of it because the shared document list was replaced

#### Scenario: A genuinely missing document still reports not found
- **WHEN** a user opens a document viewer tab for a document id that does not exist in the library
- **THEN** the system shows "Document not found" once loading has settled, and does not falsely display a document

#### Scenario: Opening from the Audiobooks tab is as reliable as opening from the Queue tab
- **WHEN** the same audiobook is opened once from the Queue tab and once from the Audiobooks tab
- **THEN** both actions open the document viewer to the same document with no difference in success or reliability
