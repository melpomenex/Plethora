## ADDED Requirements

### Requirement: Explicit section mentions resolve to canonical document ranges
The system SHALL resolve every explicitly selected `#` section against the active document's current canonical extracted text before sending an LLM request.

#### Scenario: Selected section is resolved
- **WHEN** a user selects `#Chapter One` for one active document and submits a question or card-creation request
- **THEN** the LLM context contains the content range for `Chapter One` rather than content beginning at document offset zero

#### Scenario: Duplicate heading is disambiguated
- **WHEN** multiple headings share a title but the selected reference contains a breadcrumb or hierarchy path
- **THEN** the system resolves the heading whose structural path matches the selected reference

### Requirement: Focused content is consistent at the provider boundary
The system MUST use the same resolved focused-section content in the user prompt and the structured document context passed to the LLM provider.

#### Scenario: Provider request is assembled
- **WHEN** a focused section request is successfully resolved
- **THEN** both LLM-facing context fields contain the same delimited focused content and source label

### Requirement: Explicit section failures do not silently broaden scope
The system SHALL stop an explicit section-scoped request before contacting the LLM when the selected section cannot be resolved unambiguously from current document text.

#### Scenario: Stale section reference
- **WHEN** a persisted or cached section reference no longer resolves after document text changes
- **THEN** the system reports that the section must be reselected and does not substitute the full document or its first token-budget slice

#### Scenario: Section has no unique active document
- **WHEN** a section mention is submitted without exactly one identifiable active document
- **THEN** the system asks the user to select the owning document and sends no LLM request

### Requirement: Focused context respects model limits without changing its start
The system SHALL enforce the configured context budget by truncating within the resolved section set and SHALL preserve the selected section's starting boundary.

#### Scenario: Selected section exceeds the budget
- **WHEN** a resolved section is larger than the available context budget
- **THEN** the system includes content beginning at that section's start, marks the context as truncated, and does not prepend unrelated document-opening content

### Requirement: Section provenance survives card creation
The system SHALL attach the active document and resolved section provenance to flashcards created from a section-scoped chat request.

#### Scenario: Card tool executes from a section request
- **WHEN** the assistant saves a Q&A or cloze card from selected section context
- **THEN** the resulting chat artifact and tool execution retain the source document ID and human-readable section label

