## Purpose

Makes the reader's text selection the primary context for Assistant questions and carries select-to-Ask into a persistent multi-turn thread in the Assistant window.

## ADDED Requirements

### Requirement: Selection takes precedence as Assistant context
When the user asks the Assistant a question from a document reader while a non-empty text selection exists, the system SHALL place the selected text first as the primary question context and keep surrounding document context as secondary grounding. The Assistant SHALL interpret ambiguous references such as "this", "it", or "this paragraph" as referring to the selection.

#### Scenario: Selected paragraph is the question subject
- **WHEN** the user selects a paragraph and asks "What else can you tell me about this?"
- **THEN** the Assistant answer addresses the selected paragraph first before adding wider context

#### Scenario: Selection disambiguates pronouns
- **WHEN** a selection exists and the user asks "Explain it simply"
- **THEN** the explanation targets the selected text, not an arbitrary document section

#### Scenario: Empty selection falls back to document context
- **WHEN** the user asks a question with no active selection
- **THEN** the system uses the existing document/window context behavior unchanged

### Requirement: Selected text is quoted and attributed in the prompt
The system SHALL include the verbatim selected text (whitespace-normalized, truncated to a documented limit with an explicit truncation marker when over-limit) plus the source document reference (title and, where available, page/locator) in the Assistant request context.

#### Scenario: Selection quoted with source
- **WHEN** the user asks about a selection in a document titled "Photosynthesis"
- **THEN** the Assistant request contains the selected excerpt and the document title

#### Scenario: Over-long selection is truncated with marker
- **WHEN** the selected text exceeds the context limit
- **THEN** the request keeps the head of the selection, appends a truncation marker, and still answers from the visible quoted portion

### Requirement: Select-to-Ask hands off into the Assistant window thread
When the user invokes "Ask" / "Ask a question" from a text selection (context menu, selection bar, or action sheet), the system SHALL open or focus the Assistant window, start or continue a thread seeded with the selection quote and document reference, place the user's question as the first message, focus the follow-up input, and preserve the selection context for follow-up turns without requiring re-selection.

#### Scenario: Right-click Ask opens Assistant thread
- **WHEN** the user selects text, right-clicks, and chooses "Ask a question" and types "Why does this matter?"
- **THEN** the Assistant window opens with a thread showing the quoted selection, the document reference, and the question, with the reply in progress and the input focused for follow-up

#### Scenario: Follow-up retains selection without re-selecting
- **WHEN** the user asks a follow-up such as "Give me an example" in the same thread after the selection highlight is gone
- **THEN** the Assistant still answers in the context of the original selection plus prior turns

#### Scenario: New selection starts new context
- **WHEN** the user makes a different selection and invokes Ask again
- **THEN** the system starts a new thread (or explicitly re-seeds the context) for the new selection rather than mixing it into the old thread

### Requirement: Selection context is visible and dismissible
The Assistant thread seeded from a selection SHALL display the active selection context (excerpt + source) as a context chip or quote block, and the user SHALL be able to clear it, after which follow-ups revert to plain document/thread context.

#### Scenario: Context chip visible
- **WHEN** an Ask handoff creates a thread
- **THEN** the thread shows which excerpt and document the answers are grounded in

#### Scenario: Clearing context
- **WHEN** the user clears the selection context chip
- **THEN** subsequent questions in that thread no longer treat the old selection as primary
