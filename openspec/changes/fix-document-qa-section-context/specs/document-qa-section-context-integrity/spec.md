## ADDED Requirements

### Requirement: Selected sections resolve to document body text
When a user selects a heading through `#` in Document Q&A, the system SHALL resolve that selection against the current active document text and SHALL use the resolved section body as LLM context. A heading label or synthetic outline entry alone MUST NOT be treated as section body content.

#### Scenario: Text or Markdown heading selection
- **WHEN** the user selects a heading parsed from text or Markdown and submits a Document Q&A question
- **THEN** the context sent to the selected LLM contains the text beneath that heading
- **AND** the context identifies the selected heading and its breadcrumb

#### Scenario: PDF outline heading selection
- **WHEN** the user selects a PDF outline entry whose initial index node contains only the outline title
- **THEN** the system resolves the corresponding range from extracted PDF text before sending the request
- **AND** the selected LLM receives meaningful body text from that range rather than only the outline title

#### Scenario: EPUB TOC heading selection
- **WHEN** the user selects an EPUB table-of-contents entry
- **THEN** the system resolves the corresponding spine/extracted-text section body before sending the request
- **AND** the selected LLM receives that body through the existing provider path

#### Scenario: Legitimately short source section
- **WHEN** the selected section is short but its range is authoritatively derived from the source document
- **THEN** the system accepts the section as valid context
- **AND** does not reject it solely because it is one line or resembles its heading

### Requirement: Section boundaries preserve hierarchy
The system SHALL define a selected heading's body from that heading through the next heading at the same or a higher hierarchy level, including descendant subsections.

#### Scenario: Parent heading includes subsections
- **WHEN** a user selects a level-one heading followed by level-two and level-three headings
- **THEN** the resolved context includes the parent introduction and descendant subsection content
- **AND** stops before the next level-one heading

#### Scenario: Leaf heading stops at its peer
- **WHEN** a user selects a leaf heading followed by another heading at the same level
- **THEN** the resolved context ends before the peer heading

### Requirement: Outline reconciliation is structurally correct
The system SHALL enrich PDF outline and EPUB TOC nodes with extracted-text ranges using occurrence-aware structural matching that accounts for title, ancestors, hierarchy, available location hints, and source order.

#### Scenario: Duplicate heading titles in different chapters
- **WHEN** two chapters each contain a heading named “Introduction”
- **THEN** each outline node resolves to the “Introduction” body under its own chapter
- **AND** selecting either node does not include the other chapter's body

#### Scenario: Outline node has no confident text match
- **WHEN** an outline node cannot be matched confidently while building the section index
- **THEN** the node remains available for navigation but is marked as lacking authoritative context
- **AND** its title is not represented as resolved body text

### Requirement: Section context is validated at submission
Document Q&A SHALL validate selected section IDs and ranges against the current document and content snapshot immediately before constructing an LLM request.

#### Scenario: Cached range is stale but recoverable
- **WHEN** the document text changed after the section token was inserted and the saved range is stale
- **THEN** the system re-resolves the section using its structural identity against the current text
- **AND** sends the newly resolved body

#### Scenario: Selected section cannot be resolved
- **WHEN** the selected section has no authoritative range and cannot be recovered from current or newly extracted document text
- **THEN** the system does not send a document-grounded request to the LLM
- **AND** displays a clear message that the section context is unavailable and suggests retrying extraction or selecting another section

#### Scenario: Document changes after section selection
- **WHEN** a section token belongs to a different document than the current target document
- **THEN** the system rejects or clears the stale selection
- **AND** MUST NOT resolve the token against the wrong document

### Requirement: All selected sections are honored
When a query contains multiple `#` section mentions, the system SHALL resolve every selected section, preserve document order, and provide their combined body content without duplicating overlapping ranges.

#### Scenario: Multiple distinct sections
- **WHEN** the user selects two non-overlapping sections and submits a question
- **THEN** the LLM context contains both resolved section bodies with distinct labels in document order

#### Scenario: Parent and child selections overlap
- **WHEN** the user selects a parent section and one of its child sections
- **THEN** overlapping source text is included only once in the assembled context
- **AND** both selected labels remain represented as selection metadata

#### Scenario: One of multiple selections fails resolution
- **WHEN** at least one selected section cannot be resolved
- **THEN** the system does not silently send only the resolvable subset
- **AND** reports which selection needs to be reselected or re-extracted

### Requirement: The selected LLM receives one canonical focused context
The system SHALL assemble one canonical focused-section context result and use its formatted body consistently in the composed user prompt and the structured document context supplied to `chatWithContext`.

#### Scenario: Provider request payload contains section body
- **WHEN** a valid section-focused question reaches the configured LLM provider adapter
- **THEN** the composed user message contains the resolved section body
- **AND** `context.content` contains the same canonical focused content
- **AND** neither field substitutes the section title for its body

#### Scenario: User-selected provider is preserved
- **WHEN** the user submits a section-focused question with an enabled LLM/provider configuration
- **THEN** the system sends the canonical focused context through that existing provider and model configuration
- **AND** does not route section-focused requests to a different model or provider

### Requirement: Token budgeting prioritizes selected body content
The system SHALL apply the configured context budget to focused sections by prioritizing selected section bodies, adding optional neighboring context only when capacity remains, and marking any truncation explicitly.

#### Scenario: Section and neighbors fit the budget
- **WHEN** the selected section body and configured neighboring context fit within the available context budget
- **THEN** the system includes the complete selected body and the neighboring context with clear labels

#### Scenario: Selected section exceeds the budget
- **WHEN** the selected section body exceeds the available context budget
- **THEN** the system truncates the body at a sensible boundary where possible
- **AND** includes an explicit truncation marker
- **AND** does not spend budget on optional neighbors before the selected body

#### Scenario: Token estimate reflects resolved content
- **WHEN** a title-only outline node is enriched with its actual body
- **THEN** the displayed and request-time token estimates are computed from the resolved focused content rather than from the heading title alone

### Requirement: Section context regressions are covered at the provider boundary
The implementation SHALL include automated coverage that verifies section resolution and the final LLM request payload for supported document index sources and failure modes.

#### Scenario: Regression suite runs
- **WHEN** automated tests run for section-focused Document Q&A
- **THEN** fixtures cover text/Markdown headings, PDF outlines, EPUB TOCs, duplicate titles, parent sections, multiple mentions, stale IDs or ranges, extraction fallback, truncation, and unresolved context
- **AND** at least one provider-boundary test asserts that body phrases, not merely the selected heading, reach the mocked LLM call
