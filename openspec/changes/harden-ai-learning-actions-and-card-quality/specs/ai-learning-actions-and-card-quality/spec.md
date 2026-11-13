## Purpose

Harden AI learning agent tool parameter validation, provide graceful recovery when on-device models trigger safety filters, and ensure consistent source lineage for generated flashcards.

## ADDED Requirements

### Requirement: Tool parameter alias normalization
The AI agent tool execution runtime SHALL accept standard parameter aliases (`query`, `search`, `concept`, `term`, `text`) for required string arguments like `topic`. The runtime SHALL reject unsupported fields, non-string values, missing semantic input and conflicting aliases before executing the tool.

#### Scenario: Model invokes tool with query instead of topic
- **GIVEN** an active Learning Agent session
- **WHEN** the model emits a tool call `get_related_material` with arguments `{"query": "mitochondrial ATP synthesis"}`
- **THEN** the runtime SHALL normalize `query` to `topic`
- **AND** the tool SHALL execute successfully without returning a parameter required error

#### Scenario: Conflicting aliases

- **WHEN** a call contains different values for topic and query or contains an unknown field
- **THEN** validation reports an invalid argument and performs no retrieval

### Requirement: Graceful on-device safety block recovery
When an on-device model refuses generation due to safety classification (e.g., medical or sensitive topics like Shingles), the system SHALL NOT crash or display an uninformative error toast. It SHALL return a typed `safety_blocked` state with clear user guidance and fallback options.

#### Scenario: Medical summary blocked by Apple Intelligence
- **GIVEN** the user requests a summary of an article concerning Shingles pathology using Apple Intelligence
- **WHEN** the native model returns a safety guardrail block
- **THEN** the system SHALL display an informative alert explaining the provider's safety filter
- **AND** the system SHALL preserve the pending work and allow an explicit alternative provider selection subject to existing scope and cloud disclosure controls

### Requirement: Validated source lineage for card creation
The system SHALL validate and resolve foreign key lineage before inserting AI-generated flashcards into SQLite. Flashcards created from extracts SHALL reference the parent document ID in `document_id` and the extract ID in `extract_id`.

#### Scenario: Generating cards from an extract
- **GIVEN** an extract created from document `doc-123`
- **WHEN** the assistant creates a flashcard from the extract
- **THEN** the insertion SHALL succeed with `document_id = "doc-123"` and `extract_id = extract.id`
- **AND** SQLite foreign key error 787 SHALL NOT occur

### Requirement: Section scope follows generation through acceptance

Section or selection requests SHALL resolve and disclose source scope before sending content. Accepted drafts SHALL retain verified source lineage.

#### Scenario: Section cannot be resolved

- **WHEN** a selected section cannot be matched to its source revision
- **THEN** the user sees a scoped error and can choose a valid section without any broadened provider request

### Requirement: Terminal Assistant response states are actionable

The Assistant SHALL represent empty, interrupted, cancelled, failed and refused runs separately from completed answers and tool-only turns, with retry when appropriate.

#### Scenario: Stream ends with no answer

- **WHEN** a stream ends without meaningful text or completed tool activity
- **THEN** it shows an actionable empty-response state instead of a successful blank turn

### Requirement: Shared generated-card acceptance

Generation surfaces SHALL present editable validated drafts and per-candidate save results. Repeated acceptance of an already saved candidate SHALL return its existing receipt.

#### Scenario: One invalid candidate in a batch

- **WHEN** a user accepts a batch with a malformed cloze and a valid source-grounded Q&A card
- **THEN** the Q&A is saved once, the malformed draft remains editable with its error, and the count reflects durable saves

### Requirement: Extract learning actions report typed failure

Summaries and Learn This SHALL resolve the current source and use the authorized route. Failure SHALL preserve the source and pending edits.

#### Scenario: Source changed during summarization

- **WHEN** the underlying extract changes before the summary result arrives
- **THEN** the stale result is discarded and the current source is offered for retry
