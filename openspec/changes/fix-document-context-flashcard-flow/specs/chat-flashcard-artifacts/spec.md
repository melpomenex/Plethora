## ADDED Requirements

### Requirement: Created flashcards appear as learning artifacts in chat
Document Q&A and Assistant SHALL render flashcard creation tool calls as a shared compact card collection instead of raw JSON, serialized parameters, or tool-name-only rows.

#### Scenario: Multiple Q&A cards are created
- **WHEN** an assistant response contains multiple valid `create_qa_card` calls
- **THEN** chat shows a collection count and one compact row per card with its question, answer preview, type, and creation state

#### Scenario: Cloze card is created
- **WHEN** an assistant response contains a valid `create_cloze_card` call
- **THEN** chat shows the cloze text in a compact card row with cloze type and creation state

#### Scenario: Response includes non-card tools
- **WHEN** an assistant response contains flashcard and non-flashcard tool calls
- **THEN** the flashcards use the artifact collection and the other tools remain available through a generic tool-status presentation

### Requirement: Card lifecycle remains visible and useful
Each chat flashcard artifact MUST retain its learning content while communicating pending, saved, or failed execution state.

#### Scenario: Tool execution is pending
- **WHEN** a flashcard tool call has not completed
- **THEN** its row remains readable and displays a non-blocking progress state

#### Scenario: Tool execution succeeds
- **WHEN** a flashcard is persisted successfully
- **THEN** its row displays a saved state and retains the persisted card identifier

#### Scenario: One card in a batch fails
- **WHEN** one flashcard tool call fails while other calls succeed
- **THEN** only the failed row displays its actionable error and retry control while successful rows remain saved

### Requirement: Chat cards are interactive and accessible
Every flashcard row SHALL be operable with pointer and keyboard input, SHALL expose a meaningful accessible name and visible focus state, and SHALL open the appropriate card detail or editing flow when activated.

#### Scenario: Saved card is activated
- **WHEN** a user clicks a saved card row or activates it using the keyboard
- **THEN** the application opens that persisted card in the available card detail or editor flow

#### Scenario: Draft card is activated
- **WHEN** a user activates a generated card that has not yet been persisted
- **THEN** the application opens the draft in an editing flow without discarding its generated content or source context

### Requirement: Card batches remain compact
The card collection SHALL preserve chat readability for large batches by using a compact list and a discoverable expansion mechanism.

#### Scenario: Large card batch is generated
- **WHEN** a response creates more cards than the default visible limit
- **THEN** chat shows an initial subset, the total count, and a control to reveal or collapse the remaining cards

### Requirement: Legacy conversations remain renderable
The system SHALL defensively normalize older messages that contain generic flashcard tool calls but no typed artifact array.

#### Scenario: Legacy tool-call message is opened
- **WHEN** a stored conversation contains valid card parameters in legacy `toolCalls`
- **THEN** the system derives display artifacts without crashing or modifying the stored flashcards

