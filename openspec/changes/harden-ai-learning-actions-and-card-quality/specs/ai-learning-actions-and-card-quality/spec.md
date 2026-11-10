## Purpose

Harden AI learning agent tool parameter validation, provide graceful recovery when on-device models trigger safety filters, and ensure consistent source lineage for generated flashcards.

## ADDED Requirements

### Requirement: Tool parameter alias normalization
The AI agent tool execution runtime SHALL accept standard parameter aliases (`query`, `search`, `concept`, `term`, `text`) for required string arguments like `topic`. Unexpected auxiliary parameters like `reasoning` or `context` SHALL NOT cause validation failure.

#### Scenario: Model invokes tool with query instead of topic
- **GIVEN** an active Learning Agent session
- **WHEN** the model emits a tool call `get_related_material` with arguments `{"query": "mitochondrial ATP synthesis"}`
- **THEN** the runtime SHALL normalize `query` to `topic`
- **AND** the tool SHALL execute successfully without returning a parameter required error

### Requirement: Graceful on-device safety block recovery
When an on-device model refuses generation due to safety classification (e.g., medical or sensitive topics like Shingles), the system SHALL NOT crash or display an uninformative error toast. It SHALL return a typed `safety_blocked` state with clear user guidance and fallback options.

#### Scenario: Medical summary blocked by Apple Intelligence
- **GIVEN** the user requests a summary of an article concerning Shingles pathology using Apple Intelligence
- **WHEN** the native model returns a safety guardrail block
- **THEN** the system SHALL display an informative alert explaining the provider's safety filter
- **AND** the system SHALL provide a button to retry using a secondary local model (Ollama) or authorized cloud model

### Requirement: Validated source lineage for card creation
The system SHALL validate and resolve foreign key lineage before inserting AI-generated flashcards into SQLite. Flashcards created from extracts SHALL reference the parent document ID in `document_id` and the extract ID in `extract_id`.

#### Scenario: Generating cards from an extract
- **GIVEN** an extract created from document `doc-123`
- **WHEN** the assistant creates a flashcard from the extract
- **THEN** the insertion SHALL succeed with `document_id = "doc-123"` and `extract_id = extract.id`
- **AND** SQLite foreign key error 787 SHALL NOT occur
