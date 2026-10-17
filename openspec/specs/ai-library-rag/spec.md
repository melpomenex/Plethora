# ai-library-rag Specification

## Purpose
Incrementum's on-device AI today is a set of per-feature prompt adapters (explain, summarize, simplify, Q&A, flashcard line-parsing) bolted onto the Gemini Nano bridge.

## Requirements

### Requirement: Library-wide grounded question answering

The system SHALL answer questions against the user's library or an explicitly filtered subset of documents using retrieval over the semantic and lexical index (documents, chunks, extracts, notes, annotations, cards, and transcripts), passing retrieved relevant context and bounded conversation history to the generative model. Whole documents SHALL NOT be blindly inserted into model context when they exceed the allocated source token budget. When explicit `document_ids` filters are supplied to retrieval, the semantic retriever SHALL restrict candidate chunks strictly to those `document_ids` (intersecting rather than unioning with any lexical FTS prefilter) and SHALL scale the retrieved chunk token budget according to the active model's resolved policy budget.

#### Scenario: Cross-library question
- **WHEN** a user asks "where else have I encountered this idea?" in `Library` scope
- **THEN** the answer is grounded in retrieved library sources with citations, not unsupported model memory

#### Scenario: Compact grounded prompt
- **WHEN** a library question is answered
- **THEN** the model receives only the retrieved top-k deduplicated chunks within the provider-resolved token budget, each wrapped as untrusted content with citation markers

#### Scenario: Single-document filtered retrieval does not leak other documents
- **WHEN** retrieval is invoked with `filters.document_ids` restricted to Document A while Document B matches the query in FTS5
- **THEN** semantic and lexical retrieval return chunks strictly from Document A and never include chunks from Document B

### Requirement: Honest handling of weak or missing evidence

When retrieval yields no or weak evidence in `Document` or `Library` scope, the system SHALL say so instead of fabricating an answer; conflicting sources SHALL be reported as conflicting. When validating cited quotes against retrieved source chunks, the validator SHALL tolerate minor punctuation, ellipsis (`...`), and whitespace normalization differences so genuinely grounded citations are not falsely discarded and downgraded to `evidenceLevel: "none"`.

#### Scenario: Unanswerable query
- **WHEN** the library contains no material relevant to the question in `Library` scope
- **THEN** the system responds that the library does not appear to cover it (and offers switching to `Chat` scope) rather than generating an unsupported answer

#### Scenario: Conflicting sources
- **WHEN** retrieved sources disagree
- **THEN** the answer presents the conflict with citations instead of silently choosing a side

#### Scenario: Grounded quote with minor punctuation or ellipsis normalization
- **WHEN** the model cites a valid chunk ID and provides a quote that matches the chunk text across normalized clauses separated by an ellipsis (`...`) or typographic punctuation
- **THEN** the citation is accepted as grounded and `evidenceLevel` remains `"supported"`

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
