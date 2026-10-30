## MODIFIED Requirements

### Requirement: Explicit section mentions resolve to canonical document ranges
Chat, Learning Agent, Document Q&A, and Flashcard Studio SHALL resolve every explicitly selected section against current canonical source text before generation. A pinned/current passage SHALL be accepted as bounded passage scope when no explicit section is selected. Selected heading labels SHALL NOT substitute for body content. Markdown/HTML headings, PDF outlines, EPUB tables of contents, duplicate titles, parent/child sections, and multiple selections SHALL resolve by stable ownership/path and current content revision. Overlapping ranges SHALL be deduplicated in source order.

#### Scenario: Selected section is resolved
- **WHEN** the user selects Chapter One and requests cards
- **THEN** the generation request contains that section's body rather than document offset zero

#### Scenario: Duplicate heading is disambiguated
- **WHEN** duplicate titles exist but the chosen reference contains a structural path
- **THEN** only the matching section body is selected

#### Scenario: Selection and multiple sections
- **WHEN** the user chooses a pinned passage or multiple parent/child section references
- **THEN** the bounded passage or deduplicated section set becomes the actual generation source with clear labels

### Requirement: Focused content is consistent at the provider boundary
Every generation provider SHALL receive the same validated section/passage scope, provenance, and source body in its source-bearing request fields, subject only to its explicit budget. Explicit section scope SHALL contain no unrelated neighbor/body sections. Apple/on-device adapters SHALL NOT drop scoped content or silently replace it with full-document context.

#### Scenario: Provider request is assembled
- **WHEN** a focused request resolves successfully
- **THEN** all source-bearing prompt/context fields agree on the body and source labels

#### Scenario: Provider parity
- **WHEN** the same selected section is submitted to mocked local, Apple, and remote adapters
- **THEN** each request contains the intended body and none contains unrelated sections or loses the scope instruction

### Requirement: Explicit section failures do not silently broaden scope
The system SHALL stop scoped generation before provider contact when the section cannot be resolved unambiguously, is stale/empty, has unavailable extracted text, or has no valid owning document. An ambiguous “this section” request without selected scope SHALL provide a section/passage selection method and SHALL NOT fabricate scope or send the full document.

#### Scenario: Stale section reference
- **WHEN** a section no longer resolves after source changes
- **THEN** the user is asked to reselect and no provider request is sent

#### Scenario: Section has no unique active document
- **WHEN** selected scope lacks one valid owning document outside the explicit multi-paper flow
- **THEN** the user is asked to select its owner and no request is sent

#### Scenario: No selected scope or empty body
- **WHEN** the user asks for cards from this section with no bounded selection, or the selected section has no readable body
- **THEN** the UI offers selection/recovery and performs zero generation calls

### Requirement: Focused context respects model limits without changing its start
Budgeting SHALL remain within resolved scope after reserving required instructions/history/output. Truncation SHALL preserve each selected section's starting boundary and disclose retained/omitted coverage. Multiple sections SHALL receive balanced shares with unused budget redistributed in source order. If meaningful nonempty bodies plus instructions cannot fit, the system SHALL stop and request smaller scope rather than broadening scope or silently truncating by characters.

#### Scenario: Selected section exceeds the budget
- **WHEN** one selected section is too large
- **THEN** included body begins at that section's start, explicit truncation is shown, and no document-opening content is prepended

#### Scenario: No provider can fit the required scope
- **WHEN** selected scope cannot fit a provider's minimum request budget
- **THEN** no model call or silent provider switch occurs and the UI offers a smaller selection
