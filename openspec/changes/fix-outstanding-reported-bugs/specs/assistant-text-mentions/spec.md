## ADDED Requirements

### Requirement: Mentions resolve for documents without an outline

The `#` mention popup SHALL offer usable entries for any document that has readable text, including documents with no Markdown headings and no PDF or EPUB outline.

#### Scenario: Document with headings or an outline

- **WHEN** the user types `#` in the assistant while a document with headings or a PDF/EPUB outline is in context
- **THEN** the popup lists that document's sections, as it does today

#### Scenario: Document with neither headings nor an outline

- **WHEN** the user types `#` while a plain imported article with no headings and no outline is in context
- **THEN** the popup lists derived segments covering the document's text
- **AND** each entry shows a preview so it can be told apart from its neighbours
- **AND** the popup is never empty for a document that has text

#### Scenario: Document with no readable text

- **WHEN** the user types `#` while the document in context has no extractable text
- **THEN** the popup states that no sections are available
- **AND** it does not render as an empty, unexplained list

### Requirement: Mentioning the current selection

The assistant SHALL let the user reference the text they have selected in the document, so a question can be asked about an arbitrary portion rather than only a whole section.

#### Scenario: Selection exists

- **WHEN** the user has text selected in the document and opens the `#` mention popup
- **THEN** the current selection is offered as the first entry
- **AND** choosing it attaches exactly the selected text as context

#### Scenario: No selection

- **WHEN** no text is selected
- **THEN** no selection entry is offered
- **AND** the section entries behave as specified above

#### Scenario: Selection is larger than the context budget

- **WHEN** the selected text exceeds the assistant's context budget
- **THEN** the attached context is truncated to the budget
- **AND** the user is told it was truncated

### Requirement: Consistency with Flashcard Studio mentions

Assistant mentions SHALL resolve sections through the same index used by the Flashcard Studio mention UI, so the same document offers the same entries in both surfaces.

#### Scenario: Same document in both surfaces

- **WHEN** the same document is in context in the assistant and in Flashcard Studio
- **THEN** both `#` popups list the same section entries in the same order
