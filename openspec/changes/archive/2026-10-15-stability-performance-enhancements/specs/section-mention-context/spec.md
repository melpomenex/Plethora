## ADDED Requirements

### Requirement: Section heading resolution via `#` mention
The `useDocumentSections` hook SHALL parse document outline headings and resolve `#` mentions in the AI Assistant or Document Q&A to the corresponding section's plain text range.

#### Scenario: User types `#` and selects a section
- **WHEN** the user types `#` in the AI Assistant input and selects a heading from the autocomplete
- **THEN** the system SHALL resolve the heading to its bounded text range in the document

#### Scenario: Section resolution for nested headings
- **WHEN** a document contains nested headings (H1 > H2 > H3) and the user selects an H2 section
- **THEN** the resolved text SHALL include content from the H2 heading until the next H2 or H1, inclusive of nested H3 content

### Requirement: Section context injection into LLM payload
Selecting a section via `#` SHALL inject the bounded section content into the LLM system/user context payload, scoping the AI's response to that section.

#### Scenario: LLM receives section context
- **WHEN** the user asks a question with a `#Section Name` mention
- **THEN** the LLM prompt SHALL include the full text of that section as focused context
- **AND** the AI response SHALL be grounded in that section's content
