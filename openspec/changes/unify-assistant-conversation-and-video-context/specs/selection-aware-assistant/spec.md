## MODIFIED Requirements

### Requirement: Selection takes precedence as Assistant context
When the user asks the Assistant a question from a document or video reader while a non-empty text selection or pinned selection snapshot exists across `Chat`, `Document`, or `Library` scopes, the system SHALL place the selected text first as the primary question context and keep surrounding document, transcript, or library context as secondary grounding. The Assistant SHALL interpret ambiguous references such as "this", "it", or "this paragraph" as referring to the selection, while allowing broader conceptual expansion when in `Chat` scope.

#### Scenario: Selected paragraph is the question subject
- **WHEN** the user selects a paragraph and asks "What else can you tell me about this?" in `Chat` scope
- **THEN** the Assistant answer addresses the selected paragraph first before adding wider context

#### Scenario: Selection disambiguates pronouns
- **WHEN** a selection exists and the user asks "Explain it simply"
- **THEN** the explanation targets the selected text, not an arbitrary document section

#### Scenario: Empty selection falls back to document context
- **WHEN** the user asks a question with no active selection
- **THEN** the system uses the existing document/window context behavior unchanged

### Requirement: Select-to-Ask hands off into the Assistant window thread
When the user invokes "Ask" / "Ask a question" from a text selection (context menu, selection bar, or action sheet) in either the standard document/video viewer or Queue Scroll mode, the system SHALL open or focus the Assistant window, start or continue a thread seeded with the selection quote and document/timestamp reference, place the user's question as the first message, focus the follow-up input, and preserve the selection context for follow-up turns without requiring re-selection.

#### Scenario: Right-click Ask opens Assistant thread
- **WHEN** the user selects text in the standard reader or Queue Scroll mode, right-clicks or taps Ask, and chooses "Ask a question" and types "Why does this matter?"
- **THEN** the Assistant window opens with a thread showing the quoted selection, the document/timestamp reference, and the question, with the reply in progress and the input focused for follow-up

#### Scenario: Follow-up retains selection without re-selecting
- **WHEN** the user asks a follow-up such as "Give me an example" in the same thread after the selection highlight is gone
- **THEN** the Assistant still answers in the context of the original selection plus prior turns

#### Scenario: New selection starts new context
- **WHEN** the user makes a different selection and invokes Ask again
- **THEN** the system starts a new thread (or explicitly re-seeds the context) for the new selection rather than mixing it into the old thread

## ADDED Requirements

### Requirement: Grounded answers preserve citations to the active selection context
When a grounded `Document` or `Library` request includes a `selection-context` passage, the citation validator SHALL register `selection-context` as a valid source reference ID so that model citations to the user's selected passage are preserved rather than stripped or downgraded to `evidenceLevel: "none"`.

#### Scenario: Citing selected passage in grounded Q&A
- **WHEN** the user asks a grounded question with an active selection and the model cites `selection-context`
- **THEN** the citation is retained as valid supporting evidence and the response evidence level is not downgraded to `"none"`
