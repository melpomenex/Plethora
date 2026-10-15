## Purpose

Provides a consistent, user-controlled presentation for thinking segments emitted by conversational AI models, keeping them distinct from final answers across the app's chat surfaces.

## ADDED Requirements

### Requirement: Separate thinking segments from assistant answers
The system SHALL identify content enclosed by `<think>` and `</think>` in conversational AI responses and render it separately from the answer, without exposing the raw delimiter tags in the chat transcript.

#### Scenario: Completed response contains a thinking segment
- **WHEN** a completed assistant response contains one or more `<think>…</think>` segments
- **THEN** the transcript presents their contents in a distinct thinking section and presents content outside those segments as the assistant answer
- **AND** the raw delimiter tags are not rendered

#### Scenario: Response contains no thinking segment
- **WHEN** an assistant response contains no thinking delimiters
- **THEN** the response is presented using the existing answer rendering behavior

#### Scenario: Thinking delimiters arrive across stream chunks
- **WHEN** a streamed response splits an opening or closing thinking delimiter across chunks
- **THEN** the system buffers the incomplete delimiter and does not render partial tag text as answer content

#### Scenario: Stream ends with an unclosed thinking segment
- **WHEN** generation completes or fails after a thinking segment opens without a closing delimiter while the conversation remains visible
- **THEN** the received segment content remains in the distinct thinking section
- **AND** no raw partial delimiter is rendered
- **AND** the thinking section indicates that generation did not complete when applicable

### Requirement: Make thinking visible through an accessible disclosure
The system SHALL make the thinking section collapsible and clearly labeled so users can choose whether to inspect model-generated thinking while keeping it visually distinct from the answer.

#### Scenario: Thinking is generated
- **WHEN** the system receives content inside a thinking segment
- **THEN** it shows a clearly labeled, collapsed-by-default thinking section with a visible in-progress indicator
- **AND** expanding the section reveals the received thinking content, which can continue updating during generation

#### Scenario: Thinking generation completes
- **WHEN** generation completes after emitting thinking content
- **THEN** the in-progress indicator changes to a completed state
- **AND** the user can expand or collapse the section without changing the answer

#### Scenario: Thinking generation is interrupted
- **WHEN** generation is cancelled or fails after emitting thinking content
- **THEN** the thinking section remains inspectable and communicates that generation was interrupted

#### Scenario: Keyboard or assistive technology operates the disclosure
- **WHEN** a user navigates the thinking section with a keyboard or assistive technology
- **THEN** its label, expanded state, and in-progress, completed, or interrupted status are programmatically available
- **AND** new streamed thinking content does not repeatedly announce the entire section

### Requirement: Use consistent thinking presentation across conversational AI surfaces
The system SHALL provide the same thinking disclosure behavior wherever users read conversational AI responses, including the assistant panel and document Q&A.

#### Scenario: Thinking appears in assistant panel
- **WHEN** the assistant panel renders a response containing thinking content
- **THEN** it uses the shared thinking disclosure and answer separation behavior

#### Scenario: Thinking appears in document Q&A or another chat surface
- **WHEN** document Q&A or another conversational AI surface renders a response containing thinking content
- **THEN** it uses the same thinking disclosure, status, and answer separation behavior
