## ADDED Requirements

### Requirement: Explicit browser page saves remain documents
The system SHALL persist browser-extension `page` and `link` saves as one HTML document for the normalized source URL, and SHALL create an extract only for an explicit `extract` request.

#### Scenario: User saves the current tab
- **WHEN** the user invokes Save Current Tab and the extension sends page text or rich HTML
- **THEN** the system creates or enriches one document for the source URL
- **AND** the page body is stored on the document rather than as a whole-page extract

#### Scenario: User saves a selection
- **WHEN** the user explicitly invokes Create Extract for selected text
- **THEN** the system stores the selection as an extract linked to the relevant document
- **AND** the system does not replace the parent document body with the selection

### Requirement: Browser page imports SHALL prefer readable content
The system SHALL persist non-empty extension-captured article text and structured article HTML when those representations are available, and SHALL use an article-quality extraction fallback for empty or navigation-heavy page payloads before falling back to generic page text.

#### Scenario: Rich extension capture
- **WHEN** a page save contains non-empty article text and rich HTML
- **THEN** the document stores the article text as its canonical plain-text body
- **AND** the associated structured HTML remains available for rich rendering

#### Scenario: Link-only save
- **WHEN** a page or link save contains no usable body text
- **THEN** the system attempts the configured readable article extraction path
- **AND** it stores the extracted plain text and article HTML together when extraction succeeds

#### Scenario: Readability extraction fails
- **WHEN** readable extraction fails or returns empty content
- **THEN** the system may store a bounded generic text fallback
- **AND** the document metadata identifies that fallback as lower-confidence/raw content
- **AND** the fallback does not prevent a later explicit save from enriching the same document

### Requirement: Imported content SHALL render as a readable document
The document reader SHALL render stored browser-imported article HTML as sanitized structured content when available, and SHALL preserve paragraph and line boundaries when using plain-text content.

#### Scenario: Article HTML is available
- **WHEN** a reader opens a browser-imported document with stored article HTML
- **THEN** the reader displays headings, paragraphs, lists, tables, figures, and links as readable document structure
- **AND** unsafe active content is not executed

#### Scenario: Only plain text is available
- **WHEN** a reader opens a browser-imported document without rich HTML
- **THEN** the reader displays the canonical plain text with readable spacing and line/paragraph boundaries
- **AND** it does not collapse the entire page into one dense text blob

### Requirement: Imported document bodies SHALL be durable and hydrated
The system MUST persist browser-imported body text on the document record and MUST fetch the full document before body-dependent reader, assistant, search, or Q&A features consume a content-free summary.

#### Scenario: Reopen after restart
- **WHEN** a user saves a browser page, restarts the application, and opens the document from the library
- **THEN** the full document lookup returns the persisted body
- **AND** the reader displays the article without requiring the original browser tab to remain open

#### Scenario: Summary opened from a restored tab
- **WHEN** a restored tab contains a content-free document summary
- **THEN** the application fetches and merges the full document before body-dependent features use it
- **AND** a late response for a no-longer-active document cannot replace the active document

### Requirement: Browser import enrichment SHALL be monotonic and deduplicated
Repeated saves for the same normalized source URL SHALL enrich the existing document without creating duplicates, and asynchronous extraction SHALL NOT replace valid newer content with empty, poorer, or stale data.

#### Scenario: Repeat save fills a sparse document
- **WHEN** a normalized source URL already has a sparse browser document and a later explicit save contains readable content
- **THEN** the existing document is enriched
- **AND** no second document or page-body extract is created

#### Scenario: Stale background result
- **WHEN** a background readable extraction completes after the document has been updated with newer content
- **THEN** the stale candidate is discarded
- **AND** the newer document content remains unchanged

### Requirement: Recoverable legacy browser imports SHALL be repaired safely
The system SHALL derive and persist plain text from stored browser article HTML when an affected document has empty body text, and MUST NOT promote arbitrary extracts into document content.

#### Scenario: Stored article HTML can recover the body
- **WHEN** a full document lookup finds browser-import metadata with non-empty article HTML and an empty body
- **THEN** the system derives plain text from that HTML and returns the repaired document
- **AND** repeating the lookup does not create duplicate content or records

#### Scenario: No trustworthy recovery source exists
- **WHEN** an affected document has neither body text nor recoverable article HTML
- **THEN** the system leaves existing extracts unchanged
- **AND** it does not silently copy an extract into the document body
