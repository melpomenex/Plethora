## ADDED Requirements

### Requirement: Answers list their retrieval sources as structured entries
When a Document Q&A answer is produced from library retrieval, the answer SHALL be followed by a sources list containing one entry per retrieval citation. Each entry SHALL identify the source document by title and SHALL show a quote from the cited passage.

#### Scenario: Retrieval-backed answer lists its sources
- **WHEN** a Document Q&A answer is produced from retrieved library passages
- **THEN** a sources list SHALL be shown below the answer
- **AND** the list SHALL contain one entry per cited passage
- **AND** each entry SHALL show the source document title and a quote from the cited passage

#### Scenario: Answer without retrieval shows no sources list
- **WHEN** a Document Q&A answer is produced without any retrieval citations
- **THEN** no sources list SHALL be shown

### Requirement: Each source entry states where in the document it came from
Each source entry SHALL show the location of the cited passage within its document when that location can be determined, using the location form appropriate to the document: a page number for paginated documents, a timestamp for transcript-backed media, and a section or passage indication otherwise.

#### Scenario: PDF source shows a page number
- **GIVEN** an answer cites a passage from a PDF document
- **WHEN** the sources list is shown
- **THEN** the entry for that passage SHALL show the page number the passage appears on

#### Scenario: Transcript source shows a timestamp
- **GIVEN** an answer cites a passage from a document backed by a timed transcript
- **WHEN** the sources list is shown
- **THEN** the entry for that passage SHALL show the timestamp of the passage

#### Scenario: Location cannot be determined
- **GIVEN** an answer cites a passage whose location in its document cannot be determined
- **WHEN** the sources list is shown
- **THEN** the entry SHALL still show the document title and the passage quote
- **AND** the entry SHALL NOT show a location

### Requirement: Activating a source opens the document at the cited passage
Activating a source entry SHALL open its document and navigate to the cited passage. Activation by click, tap, or keyboard SHALL behave identically.

#### Scenario: Opening a PDF source
- **GIVEN** a sources list contains an entry for a passage in a PDF document
- **WHEN** the user activates that entry
- **THEN** the PDF SHALL open at the page containing the cited passage
- **AND** the cited passage SHALL be visibly highlighted

#### Scenario: Opening an EPUB source
- **GIVEN** a sources list contains an entry for a passage in an EPUB document
- **WHEN** the user activates that entry
- **THEN** the EPUB SHALL open at the location of the cited passage
- **AND** the cited passage SHALL be visibly highlighted

#### Scenario: Opening an HTML or markdown source
- **GIVEN** a sources list contains an entry for a passage in an HTML, markdown, or plain text document
- **WHEN** the user activates that entry
- **THEN** the document SHALL open scrolled to the cited passage
- **AND** the cited passage SHALL be visibly highlighted

#### Scenario: Opening a transcript-backed source
- **GIVEN** a sources list contains an entry for a passage in a document backed by a timed transcript
- **WHEN** the user activates that entry
- **THEN** the document SHALL open seeked to the timestamp of the cited passage
- **AND** the matching transcript segment SHALL be visibly highlighted

#### Scenario: Keyboard activation matches click activation
- **GIVEN** a source entry has keyboard focus
- **WHEN** the user activates it from the keyboard
- **THEN** the same document SHALL open at the same cited passage as activating it by click

#### Scenario: Activating a second source from the same answer
- **GIVEN** the user has already opened one source from an answer
- **WHEN** the user activates another source entry pointing at the same document
- **THEN** the document SHALL navigate to the newly cited passage

### Requirement: Unresolvable sources are inert and explain themselves
A source entry whose document is unavailable, or whose cited passage cannot be located in that document, SHALL NOT be activatable and SHALL state why it cannot be opened. The system SHALL NOT open a document at an arbitrary position in place of the cited passage.

#### Scenario: Cited document no longer exists
- **GIVEN** a sources list contains an entry whose document has since been deleted
- **WHEN** the sources list is shown
- **THEN** the entry SHALL be shown as not activatable
- **AND** the entry SHALL state that the document is no longer available

#### Scenario: Cited passage no longer found in the document
- **GIVEN** a sources list contains an entry whose cited passage cannot be located in the current content of its document
- **WHEN** the sources list is shown
- **THEN** the entry SHALL be shown as not activatable
- **AND** the entry SHALL state that the passage could not be located
- **AND** activating the entry SHALL NOT open the document

### Requirement: Copying an answer preserves its sources
Copying a Document Q&A answer SHALL include its sources in the copied text, listing for each source the document title and the cited passage location where one is known.

#### Scenario: Copying an answer that has sources
- **GIVEN** an answer with a sources list
- **WHEN** the user copies the answer
- **THEN** the copied text SHALL contain the answer text
- **AND** the copied text SHALL list each source's document title and known location

### Requirement: Q&A sessions saved before structured citations still render
Document Q&A messages persisted without structured citation data SHALL continue to render their answer and any previously embedded source text without error and without a duplicated sources list.

#### Scenario: Reopening an older session
- **GIVEN** a saved Q&A session whose messages carry no structured citation data
- **WHEN** the session is reopened
- **THEN** each answer SHALL render as it was saved
- **AND** no empty or duplicated sources list SHALL be shown
