## ADDED Requirements

### Requirement: Browser page saves remain documents
The system SHALL persist browser-extension `page`, `link`, and legacy empty-type save requests as documents, and SHALL create an extract only for an explicit `extract` request.

#### Scenario: Save Current Tab creates a document
- **WHEN** the extension sends a page save containing a URL and article text
- **THEN** the system creates or enriches one document for that URL with the article text in the document content field
- **AND** the system does not create an extract for the page body

#### Scenario: Explicit selection save creates an extract
- **WHEN** the extension sends an explicit `extract` request for selected text
- **THEN** the system stores the selected text as an extract linked to its parent document
- **AND** the system does not replace the parent document body with the selection

### Requirement: Imported document text is durable
The system MUST durably store non-empty browser-imported article text on the document row so that application process state is not required to read it later.

#### Scenario: Reopen after restart
- **WHEN** a user saves a browser page, closes Incrementum, restarts it, and opens the same document
- **THEN** the reader displays the persisted article text as the document body
- **AND** the text remains associated with the parent document rather than appearing only under Extracts

#### Scenario: Document Q&A after restart
- **WHEN** a browser-imported document is reopened after restart and document Q&A requests its text
- **THEN** Q&A receives the persisted document content
- **AND** it does not report that document text is unavailable

### Requirement: Full document hydration for content consumers
The system SHALL distinguish content-free document summaries from fully loaded documents and SHALL hydrate the full document before a reader or document-text feature consumes its body.

#### Scenario: Open from startup summary
- **WHEN** a restored tab or library action opens a document represented by a startup summary without content
- **THEN** the system fetches the full document by ID before loading the reader body
- **AND** the hydrated document replaces or augments the summary in active state

#### Scenario: Stale hydration response
- **WHEN** the user changes to another document before a full-document request completes
- **THEN** the stale response does not replace the newly active document

### Requirement: Background enrichment is non-destructive
The system MUST apply asynchronous Readability results monotonically and SHALL NOT clear or replace valid document text with an empty, poorer, or stale result.

#### Scenario: Readability fetch fails
- **WHEN** a browser page is stored with extension-provided text and background Readability fetching fails
- **THEN** the original document text remains unchanged and readable after restart

#### Scenario: Readability result is better
- **WHEN** background Readability returns a non-empty article body that is a valid improvement and the document has not been superseded
- **THEN** the system updates the same document with the improved text and rich article metadata

#### Scenario: Document changes during enrichment
- **WHEN** the document is updated after enrichment starts but before its candidate is written
- **THEN** the stale enrichment result is discarded

### Requirement: Duplicate page saves enrich the existing document
The system SHALL treat repeated page saves for the same normalized source URL as idempotent document enrichment.

#### Scenario: Resave an existing empty import
- **WHEN** a matching browser-imported document has empty content and a repeated page save provides article text
- **THEN** the system fills the existing document content
- **AND** it returns the existing document ID without creating a duplicate document or extract

#### Scenario: Resave an existing complete import
- **WHEN** a matching document already has valid text and rich article metadata
- **THEN** the system preserves the valid content unless the new payload is an accepted improvement
- **AND** it does not create a duplicate document or extract

### Requirement: Recoverable legacy imports are repaired safely
The system SHALL repair an affected browser-extension HTML document with empty content when non-empty article HTML is available in that document's metadata, and MUST NOT automatically promote arbitrary extracts into document content.

#### Scenario: Recover from stored article HTML
- **WHEN** a full document lookup finds browser-extension metadata with article HTML but an empty document content field
- **THEN** the system derives and persists plain document text from the stored article HTML
- **AND** returns the repaired text to the reader and Q&A consumers

#### Scenario: No trustworthy recovery source
- **WHEN** an affected document has neither document text nor recoverable article HTML
- **THEN** the system leaves existing extracts unchanged
- **AND** does not silently copy extract text into the document body

### Requirement: Persistence regression coverage
The implementation MUST include automated coverage of the process-boundary behavior for browser page imports.

#### Scenario: Repository state is recreated
- **WHEN** an automated test saves a page, disposes the initial application or repository state, and reopens the same database through a new state instance
- **THEN** a full document lookup returns the saved article text
- **AND** the database contains no page-body extract created by that save

#### Scenario: Summary is hydrated in the frontend
- **WHEN** a frontend test opens a document from a content-free startup summary
- **THEN** the reader requests the full document and renders the returned persisted body
