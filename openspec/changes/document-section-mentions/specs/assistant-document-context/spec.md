## MODIFIED Requirements

### Requirement: PDF Context Window
The system SHALL provide the Assistant a reliable sliding window of PDF text around the current reading position, and when a section is explicitly selected via #mention, prioritize that section over the sliding window.

#### Scenario: Assistant request while positioned on a PDF section
- **GIVEN** the user is viewing a PDF document at a specific page or heading
- **WHEN** the Assistant context is assembled for a question such as "summarize this section" or "summarize section 4.5"
- **THEN** the system includes text from the current page and adjacent pages in the context window
- **AND** includes the current page number in the assembled context
- **AND** includes the active outline or heading label when available

#### Scenario: Assistant with # section mention overrides sliding window
- **GIVEN** the user typed `#2.1 Background` in Assistant input and selected a section
- **WHEN** the context is assembled
- **THEN** the system SHALL use the selected section's focused context (section + neighbors + breadcrumb) as the primary content instead of the generic page window
- **AND** include token badge `Focused: Chapter 2 > 2.1 Background (320 tokens)`
- **AND** NOT include unrelated pages outside the selected section

#### Scenario: PDF text window is not ready yet
- **GIVEN** the user asks the Assistant before live PDF page text extraction has completed
- **WHEN** the context is assembled
- **THEN** the system waits for the PDF context resolver to return usable context or an explicit unavailable-state result
- **AND** MUST NOT send an empty PDF context payload silently to the selected LLM service

### Requirement: # Section Mentions in Assistant
The Assistant textarea SHALL support the same `#` section autocomplete as Document Q&A when a document context exists.

#### Scenario: Trigger # in Assistant shows sections
- **WHEN** the user is viewing a document and types `#` in Assistant panel textarea
- **THEN** the system SHALL show the hierarchical section popup with same grouping, fuzzy search, and keyboard navigation as Q&A

#### Scenario: # disabled in general chat with no document
- **WHEN** Assistant is in general mode with no document loaded
- **THEN** typing `#` SHALL NOT trigger the section popup

#### Scenario: Selecting section in Assistant inserts token and chip
- **WHEN** user selects a section from popup in Assistant
- **THEN** `#{id}` token is inserted and chip with breadcrumb renders, removable via X

### Requirement: Optional OCR Context
The system SHALL use the best available PDF text source for the Assistant context.

#### Scenario: Text layer unavailable but OCR or HTML text exists
- **GIVEN** the PDF text layer is empty, incomplete, or unavailable for the active page window
- **AND** OCR-derived text or converted HTML text exists for the document
- **WHEN** the Assistant context is prepared
- **THEN** the system uses that fallback text for the context window before calling the LLM service

#### Scenario: No usable PDF text source exists
- **GIVEN** the PDF has no usable text layer
- **AND** no OCR-derived or HTML-derived text is available
- **WHEN** the user asks the Assistant about the current PDF location
- **THEN** the application reports that PDF context could not be assembled
- **AND** does not present the resulting model response as though document context had been provided
