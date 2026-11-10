## Purpose

Guarantee high pedagogical quality, valid syntactic structure, and appropriate complexity routing for AI-synthesized flashcards and learning curricula.

## ADDED Requirements

### Requirement: Syntactic and structural validation of generated cards
All AI-generated flashcards SHALL undergo strict schema validation before presentation. Cloze cards SHALL contain at least one valid `{{c1::...}}` deletion with non-empty masked content. Items classified as `ordered-steps` SHALL contain at least 2 distinct sequential steps, or SHALL be automatically degraded to standard `qa` cards.

#### Scenario: Validating a cloze card proposal
- **GIVEN** an LLM output proposing a cloze card
- **WHEN** the proposal text lacks `{{c1::...}}` delimiters
- **THEN** validation SHALL fail with a descriptive error
- **AND** the malformed proposal SHALL NOT be rendered in the study queue

#### Scenario: Handling a 1-step ordered steps proposal
- **GIVEN** an LLM output tagged as `ordered-steps` with only 1 question and 1 answer
- **WHEN** `validateGeneratedCard` is executed
- **THEN** the card type SHALL be automatically converted to `qa`
- **AND** the single item SHALL NOT be presented as a multi-step sequence

### Requirement: Accurate card complexity classification
Simple single-sentence Q&A cards and single-deletion cloze cards SHALL be classified as standard complexity and SHALL be editable inline. The system SHALL NOT redirect simple cards to Flashcard Studio.

#### Scenario: Authoring a simple Q&A card in Chat
- **GIVEN** an AI-generated Q&A card with a single question and single answer
- **WHEN** the card artifact is rendered in the Assistant chat panel
- **THEN** inline edit actions SHALL be directly available
- **AND** no mandatory "Open in Flashcard Studio" banner SHALL be displayed
