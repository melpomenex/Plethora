## ADDED Requirements

### Requirement: Verified evidence survives all answer boundaries

Retrieval and generated answers SHALL retain the original source-reference mapping, validated quote, content identity/version, source type, heading and exact locator when available through persistence, presentation changes, copy/export and synchronization. A selection validated as evidence SHALL remain a first-class source with its original ownership and captured position. Raw retrieved text or a similarity score alone SHALL NOT establish a supported claim. Citation integrity validation SHALL verify references and quotes without claiming semantic proof of every answer assertion.

#### Scenario: Selection is the only supporting evidence
- **GIVEN** a selection belongs to an authorized document with a captured page/section and no retrieved chunk answers the question
- **WHEN** the model validly cites that selection
- **THEN** its quote and origin remain inspectable after saving and reopening the answer
- **AND** it does not disappear because it lacks a retrieval chunk identifier

#### Scenario: Mixed source types preserve exact locators
- **GIVEN** verified PDF, EPUB, article, Markdown and timed transcript passages
- **WHEN** their answers pass through any supported Assistant presentation and reload
- **THEN** each retains its source-appropriate locator and original citation association
- **AND** an unsupported locator is labeled unavailable rather than converted to a guessed page or time

#### Scenario: Invalid citation in otherwise valid answer
- **GIVEN** a model cites a missing reference or a quote absent from supplied evidence
- **WHEN** validation completes
- **THEN** that reference is not shown as verified/actionable and any dangling marker is removed or explicitly marked invalid
- **AND** an answer with no verified support does not retain a supported-evidence label

### Requirement: Retrieval source restrictions fail closed across all paths

Every retrieval path SHALL enforce the frozen authorized document/collection/source-type restrictions before generation and before evidence becomes actionable, including semantic, lexical, supplemental and alternate retrievers. Empty explicit sets, unresolved identities, missing permissions and deleted sources SHALL NOT become unrestricted searches or authorized evidence. The actual embedding and generation destinations SHALL obey the same local-only and consent policy as the submitted request. Historical source-derived text SHALL be reauthorized before reuse.

#### Scenario: Strict document retrieval with unrelated lexical hits
- **GIVEN** a question restricted to PDF A and matching unrelated library passages
- **WHEN** semantic or lexical retrieval is used from the reader Assistant
- **THEN** only authorized passages from A are eligible for generation and citations

#### Scenario: Empty and missing eligibility
- **GIVEN** every selected source is deleted, excluded or inaccessible
- **WHEN** the user submits
- **THEN** the draft remains available with an unavailable-source reason
- **AND** no unrestricted library request or source-derived cloud prompt is sent

#### Scenario: Private history and alternate provider
- **GIVEN** a historical answer depends on local-only content
- **WHEN** a configured fallback or query embedder would send it off-device
- **THEN** the outgoing work is denied or uses a permitted source-free/local path with an honest limitation
- **AND** no fallback label hides the actual processing destination
