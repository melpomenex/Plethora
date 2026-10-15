# library-qa Specification

## Purpose

Lets users ask questions scoped to a passage, the current document, or their entire library, answered by embedding-based retrieval with cited, deep-linkable sources — and tells the truth about what was searched and what wasn't.

## ADDED Requirements

### Requirement: Questions resolve to passage, document, or library scope

Every question SHALL resolve to exactly one scope: Passage (the selected or edited chip text), Document (the current document), or Library (all indexed library content). Passage scope SHALL use only the chip text as context. Document and Library scopes SHALL retrieve relevant chunks via the semantic index before generating an answer.

#### Scenario: Scope picker changes retrieval breadth

- **WHEN** the user switches the scope picker from Passage to Library and submits the same question
- **THEN** the answer is produced from retrieval across the library index rather than only the selected passage

#### Scenario: Passage scope uses only the selected text

- **WHEN** the scope is Passage
- **THEN** no library retrieval is performed
- **AND** the answer is grounded only in the passage text

### Requirement: Answers cite deep-linkable sources

Answers produced under Document or Library scope SHALL include source citations for the retrieved chunks used. Each citation SHALL identify the document and location, and tapping a citation SHALL navigate to that location in the reader.

#### Scenario: Library answer cites its sources

- **WHEN** a Library-scoped question is answered using chunks from two documents
- **THEN** the answer lists both documents as sources
- **WHEN** the user taps a source
- **THEN** the reader opens that document at the cited location

### Requirement: Composer suggests questions from the passage context

When the composer opens with passage context, it SHALL offer suggested questions derived from that context (e.g. definitions of key terms, relation to surrounding concepts). Tapping a suggestion SHALL submit it as the question.

#### Scenario: Suggested questions appear on open

- **WHEN** the composer opens with a selected passage
- **THEN** at least one suggested question about the passage is shown
- **WHEN** the user taps a suggested question
- **THEN** it is submitted without typing

### Requirement: Cross-document concept tracing

The composer SHALL offer a "Where else is this discussed?" suggestion that searches the library index for the selected concept and returns a jump-list of related passages in other documents. Each entry SHALL deep-link to its location.

#### Scenario: Concept traced across the library

- **WHEN** the user taps "Where else is this discussed?" for a selected concept
- **THEN** a list of related passages from other library documents is shown
- **WHEN** the user taps an entry
- **THEN** the reader opens that document at the passage

### Requirement: Index freshness is disclosed honestly

If library documents exist that are not yet indexed, the Library scope SHALL disclose that the answer may be incomplete (e.g. "2 documents not yet indexed") rather than silently omitting them. The disclosure SHALL NOT block asking.

#### Scenario: Unindexed documents are disclosed

- **WHEN** the library contains documents not yet in the semantic index
- **AND** the user asks a Library-scoped question
- **THEN** the answer is still produced
- **AND** the UI discloses that some documents were not searched

### Requirement: Retrieval mode and privacy are surfaced

The active answering mode SHALL be visible in the composer: on-device generation, cloud generation, or retrieval-only (no generation). In retrieval-only mode, question and context content SHALL NOT be sent to any cloud service; only matching passages SHALL be returned.

#### Scenario: Retrieval-only mode sends nothing to the cloud

- **WHEN** the active mode is retrieval-only
- **AND** the user submits a question
- **THEN** the response contains retrieved passages only, with no generated answer
- **AND** no question or document content leaves the device

#### Scenario: Active mode is visible

- **WHEN** the composer is open
- **THEN** the current answering mode (on-device, cloud, or retrieval-only) is indicated
