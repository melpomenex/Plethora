## MODIFIED Requirements

### Requirement: Library-wide grounded question answering

The system SHALL answer questions against the user's entire library using retrieval over the semantic index (documents, chunks, extracts, notes, annotations, cards), optionally unioned with Apple Spotlight candidates merged by chunk id, passing only retrieved relevant context to the generative model. Whole documents SHALL NOT be blindly inserted into model context. The help Ask Plethora index SHALL NOT be merged into this retrieval.

#### Scenario: Cross-library question
- **WHEN** a user asks "where else have I encountered this idea?" via Ask Library or command palette Ask my library
- **THEN** the answer is grounded in retrieved library sources with citations, not model memory and not `defaultHelpRetrieval`

#### Scenario: Compact grounded prompt
- **WHEN** a library question is answered
- **THEN** the model receives only the retrieved top-k chunks within the token budget, each wrapped as untrusted content with citation markers
- **AND** optional SpotlightSearchTool results are wrapped the same way

#### Scenario: Spotlight is an additional candidate source
- **WHEN** `retrieveFromLibrary` runs with Spotlight enabled and C donations exist
- **THEN** Spotlight hits that resolve to `semantic_chunks.id` are merged by id into the existing result list
- **AND** canonical text is still loaded from SQLite

#### Scenario: Generator may be Apple FM
- **WHEN** the router selects `ondevice-apple-foundation`
- **THEN** `ask-library` still uses `src/lib/ai/schemas/libraryAnswer.ts`
- **AND** retrieval may be SQLite-only or SQLite+Spotlight independently

### Requirement: Honest handling of weak or missing evidence

When retrieval (including Spotlight merge) yields no or weak evidence, the system SHALL say so instead of fabricating an answer; conflicting sources SHALL be reported as conflicting.

#### Scenario: Unanswerable query after Spotlight merge
- **WHEN** the library and Spotlight-resolved chunks contain no material relevant to the question
- **THEN** the system responds that the library does not appear to cover it rather than generating an unsupported answer

#### Scenario: Conflicting sources
- **WHEN** retrieved sources disagree
- **THEN** the answer presents the conflict with citations instead of silently choosing a side

### Requirement: Source references navigate to origin

Answers SHALL expose source references that navigate the user back to the document location stored on the SQLite chunk. Spotlight hits that do not resolve to a chunk SHALL NOT be cited as navigable sources.

#### Scenario: Citation jumps into the document
- **WHEN** a user taps a cited source reference from an Apple-path Ask Library answer
- **THEN** the app opens the source document at the chunk's stored location (PDF page, EPUB CFI, or extract)

### Requirement: Durable indexing policy

The index SHALL include documents, chunks, extracts, notes, user annotations, and card question sides. AI-generated responses SHALL NOT be automatically indexed. Spotlight remains a derived projector (C), not a second canonical store.

#### Scenario: Chat answers do not pollute the library
- **WHEN** a user asks the library many questions on iOS
- **THEN** no AI answer text becomes searchable durable knowledge unless the user explicitly promotes an artifact through a creation flow

### Requirement: Privacy and offline indicators

Library AI SHALL display whether processing is on-device or cloud. Cloud use SHALL remain explicit and configurable. System-wide Spotlight display SHALL remain default off.

#### Scenario: On-device-only mode
- **WHEN** the user selects on-device-only AI (`preferOnDevice` and `allowCloudFallback` false) and Apple FM is available
- **THEN** library answering uses only local retrieval and local models
- **AND** cloud providers and Private Cloud Compute are never invoked

#### Scenario: On-device-only without FM
- **WHEN** the user is on-device-only and Apple FM is unavailable
- **THEN** Ask Library reports a typed unavailable state rather than silently using cloud or PCC
