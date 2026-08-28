# assistant-message-flashcard-action Specification

Per-message flashcard generation from Assistant responses using the existing `/20rules` knowledge formulation system and MCP card tools.

## ADDED Requirements

### Requirement: Per-message flashcard action
The Assistant panel SHALL render a flashcard-generation control on eligible Assistant responses, positioned between Copy and Share actions, using the Brain icon with an accessible label.

#### Scenario: Action visible on genuine Assistant answer
- **WHEN** an eligible Assistant response is rendered
- **THEN** Copy, Flashcards, and Share controls are shown in that order

#### Scenario: Action hidden on ineligible messages
- **WHEN** the message is a user message, system message, empty Assistant message, tool-confirmation message, or running-tool placeholder
- **THEN** the Flashcards control is not shown

---

### Requirement: Clicked response is authoritative source
When Flashcards is invoked on a specific Assistant response, that response's content SHALL be the sole formulation source. Unrelated conversation history MUST NOT be supplied to the LLM.

#### Scenario: Older message selected
- **WHEN** multiple Assistant responses exist and the user invokes Flashcards on an earlier response
- **THEN** card generation uses that earlier response's content, not the latest Assistant message

#### Scenario: No chat history contamination
- **WHEN** Flashcards is invoked on an Assistant response in a multi-turn conversation
- **THEN** the LLM request uses empty conversation history and the clicked content as context override

---

### Requirement: Reuse existing 20 Rules system
Flashcard generation SHALL activate the shared `/20rules` path (`isTwentyRulesCommand`, `buildTwentyRulesSystemPrompt`, `buildFlashcardToolInstruction`) without duplicating formulation prompts.

#### Scenario: Twenty-rules mode engaged
- **WHEN** Flashcards is invoked
- **THEN** the request is processed as a `/20rules` formulation turn through the existing shared module

---

### Requirement: Existing card tools and MCP pipeline
Generated cards SHALL be emitted via `create_qa_card`, `create_cloze_card`, or `batch_create_cards` and executed through `executeToolCalls` → `callAppMCPTool`. Results SHALL render in `ChatFlashcardCollection`.

#### Scenario: Tool calls executed and displayed
- **WHEN** the LLM returns card tool calls for a Flashcards action
- **THEN** cards are persisted via MCP and shown in the existing flashcard collection UI

---

### Requirement: Document association preserved
When the Assistant has active document/media context, generated cards SHALL retain association with the underlying document/deck using metadata captured at action time.

#### Scenario: Document context at click
- **WHEN** Flashcards is invoked while viewing a document and the user switches documents before tools execute
- **THEN** cards are tagged with the document identity from when the action started

---

### Requirement: Context resolver bypass
`resolveForPrompt()` MUST NOT replace the clicked Assistant response with full document text when generating cards from a message action.

#### Scenario: Document resolver does not override message source
- **WHEN** Flashcards is invoked on an Assistant answer while a document with `resolveForPrompt` is active
- **THEN** the LLM context content equals the clicked message content

---

### Requirement: Concurrency safety
The Flashcards control SHALL show per-message loading feedback and prevent duplicate concurrent generation from repeated clicks.

#### Scenario: Double-click prevention
- **WHEN** the user clicks Flashcards while generation is in progress for that message
- **THEN** a second generation batch is not started

---

### Requirement: Mobile and keyboard accessibility
Message actions SHALL be usable on touch devices without hover and expose `aria-label` and keyboard focus behavior.

#### Scenario: Touch visibility
- **WHEN** the Assistant is viewed on a coarse-pointer or small viewport
- **THEN** message actions remain visible and activatable without hover
