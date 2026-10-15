# knowledge-formulation-rules Specification

Defines the system-wide 20 Rules of Knowledge Formulation command (`/20rules`), prompt engine directives, educational reminders, and card generation behaviors across Document Q&A, Assistant, and AI Flashcard Studio based on Dr. Piotr Wozniak's 20 Rules of Knowledge Formulation.

## Purpose

To ensure AI-generated flashcards maximize long-term retention and minimize forgetting and interference, flashcards must adhere to the 20 Rules of Knowledge Formulation (Wozniak / Plethora). This capability introduces a standardized short command (`/20rules`, aliased to `/formulate`), UI action chips, educational reminders of what the rules do and why they matter, and prompt integration that guarantees generated flashcards are atomic, comprehensible, and highly applicable.

## ADDED Requirements

### Requirement: Standardized 20 Rules command and reminder metadata
The system SHALL provide a shared definition of the 20 Rules of Knowledge Formulation with a primary short command name `/20rules` (and aliases `/formulate`, `/rules`), a human-readable title ("20 Rules Formulation"), and an educational reminder summary explaining the core rules:
1. Do not learn if you do not understand
2. Learn before you memorize (build big picture)
3. Build upon the basics
4. Minimum Information Principle (atomic questions & answers)
5. Cloze deletion as mnemonic anchor
6. Use imagery & graphic deletion where applicable
7. Avoid sets, lists, and enumerations (break down into atomic clozes/items)
8. Optimize wording and simplify cues
9. Combat interference with distinct context cues
10. Redundancy from multiple angles (Knowledge Darwinism)
11. Maximize applicability (rules & reasoning over isolated trivia)
12. Provide sources and time anchors

#### Scenario: Metadata access across client modules
- **WHEN** any UI component requests 20 Rules command metadata
- **THEN** the system SHALL return the command name (`/20rules`), label, description, and the educational rule reminder summary

---

### Requirement: Assistant panel support for /20rules command and reminder
The Assistant panel SHALL recognize `/20rules` as an interactive command and quick action chip. When typed or clicked, the Assistant SHALL either explain the 20 Rules with practical examples or synthesize the active document/context into cards strictly formulated according to the 20 Rules using tool calls (`create_qa_card`, `create_cloze_card`).

#### Scenario: User clicks /20rules quick action in Assistant
- **WHEN** the user clicks the `/20rules` quick action button in the Assistant panel
- **THEN** the Assistant input composer is populated with `/20rules `
- **AND** the Assistant shows a concise tooltip or preview describing the 20 Rules formulation action

#### Scenario: User executes /20rules in Assistant without trailing text
- **WHEN** the user sends `/20rules` in the Assistant with an active document or context
- **THEN** the Assistant responds by generating atomic Q&A and cloze cards from the active context adhering to the 20 Rules via tool calls
- **AND** prepends an educational reminder explaining which formulation rules were applied (e.g. minimum information principle, cloze deletion, rule-based framing)

#### Scenario: Assistant help documentation lists /20rules
- **WHEN** the user runs `/help` in the Assistant panel
- **THEN** `/20rules` (and `/formulate`) is listed under Available Commands with an explanation of its purpose

---

### Requirement: Document Q&A tab support for /20rules command and reminder
The Document Q&A tab SHALL support the `/20rules` command chip and text command. When invoked with active document or section mentions, the system SHALL instruct the LLM to strictly apply the 20 Rules to extract atomic knowledge items rather than verbose textual paragraphs.

#### Scenario: User types /20rules in Document Q&A composer
- **WHEN** the user enters `/20rules` in the Document Q&A input and submits
- **THEN** the request combines the active document text or focused section with the 20 Rules system instruction
- **AND** the assistant generates atomic Q&A and cloze cards formatted as executable tool calls (`create_qa_card`, `create_cloze_card`)

#### Scenario: Document Q&A displays 20 Rules quick chip and reminder tooltip
- **WHEN** viewing the Document Q&A composer
- **THEN** a `/20rules` chip is available
- **AND** hovering or clicking the chip reveals a reminder explaining that `/20rules` breaks knowledge down into atomic, highly retainable flashcards

---

### Requirement: AI Flashcard Studio template and reminder card
The AI Flashcard Studio SHALL include a dedicated "20 Rules Formulation" quick template and context chip with short command `/20rules`. In the templates view, the Studio SHALL render a dedicated 20 Rules educational card explaining how the rules prevent memory interference and optimize spaced repetition retention.

#### Scenario: Selecting 20 Rules template in Flashcard Studio
- **WHEN** the user selects the "20 Rules Formulation" template or clicks the `/20rules` chip in the Studio
- **THEN** the Studio prompt input is set to a prompt that instructs the AI to generate flashcards using Dr. Piotr Wozniak's 20 Rules of Knowledge Formulation (atomic Q&A, clozes, no complex lists, high applicability)
- **AND** generation uses the active document, chapter, or selection context

#### Scenario: Educational 20 Rules reminder in Studio templates view
- **WHEN** the user switches to the Studio "Templates" view
- **THEN** a card for "20 Rules Formulation" is displayed with a badge/description reminding the user of the Minimum Information Principle and atomic memory formulation
