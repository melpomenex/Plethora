## ADDED Requirements

### Requirement: User can attach existing library documents as notebook sources
The system SHALL allow the user to select documents already present in the Incrementum library and attach them to the active notebook as sources, in addition to the existing manual text and URL entry.

#### Scenario: Attach a library document
- **WHEN** the user selects a document from their library and confirms attachment to the active notebook
- **THEN** the document's content is submitted as a source to that notebook and appears in the notebook's source list

#### Scenario: Manual entry still available
- **WHEN** the user opens the add-source control
- **THEN** both library selection and manual text/URL entry are available

#### Scenario: Attachment failure is visible
- **WHEN** attaching a library document fails
- **THEN** the system tells the user the attachment failed and the source list is unchanged

#### Scenario: Already-attached document
- **WHEN** the user selects a document already attached to the active notebook
- **THEN** the system indicates it is already a source rather than attaching a duplicate

### Requirement: Source attachment reflects ingestion state
The system SHALL show the ingestion status of an attached library document using the same source status display as other source types.

#### Scenario: Ingestion in progress
- **WHEN** an attached library document is still being ingested by NotebookLM
- **THEN** the source list shows its pending status until ingestion resolves
