## ADDED Requirements

### Requirement: Library-wide grounded question answering

The system SHALL answer questions against the user's entire library using retrieval over the
semantic index (documents, chunks, extracts, notes, annotations, cards), passing only
retrieved relevant context to the generative model. Whole documents SHALL NOT be blindly
inserted into model context.

#### Scenario: Cross-library question
- **WHEN** a user asks "where else have I encountered this idea?"
- **THEN** the answer is grounded in retrieved library sources with citations, not model memory

#### Scenario: Compact grounded prompt
- **WHEN** a library question is answered
- **THEN** the model receives only the retrieved top-k chunks within the token budget, each
  wrapped as untrusted content with citation markers

### Requirement: Honest handling of weak or missing evidence

When retrieval yields no or weak evidence, the system SHALL say so instead of fabricating an
answer; conflicting sources SHALL be reported as conflicting.

#### Scenario: Unanswerable query
- **WHEN** the library contains no material relevant to the question
- **THEN** the system responds that the library does not appear to cover it rather than
  generating an unsupported answer

#### Scenario: Conflicting sources
- **WHEN** retrieved sources disagree
- **THEN** the answer presents the conflict with citations instead of silently choosing a side

### Requirement: Source references navigate to origin

Answers SHALL expose source references that navigate the user back to the document (page,
section, EPUB position), extract, card, or note each cited chunk came from.

#### Scenario: Citation jumps into the document
- **WHEN** a user taps a cited source reference
- **THEN** the app opens the source document at the chunk's stored location (PDF page, EPUB
  CFI, or extract)

### Requirement: Durable indexing policy

The index SHALL include documents, chunks, extracts, notes, user annotations, and card
question sides. AI-generated responses SHALL NOT be automatically indexed; only user-promoted
artifacts (accepted cards, saved extracts) enter the index through normal domain creation.

#### Scenario: Chat answers do not pollute the library
- **WHEN** a user asks the library many questions
- **THEN** no AI answer text becomes searchable durable knowledge unless the user explicitly
  promotes an artifact through a creation flow

### Requirement: Privacy and offline indicators

Library AI SHALL display whether processing is on-device/offline-ready or cloud, and cloud use
SHALL remain explicit and configurable per the on-device-only preference.

#### Scenario: On-device-only mode
- **WHEN** the user selects on-device-only AI
- **THEN** library answering uses only local retrieval and local models, and cloud providers
  are never invoked
