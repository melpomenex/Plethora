## ADDED Requirements

### Requirement: Unified floating selection drawer for all text documents
The system SHALL display the floating selection drawer for text documents of type `epub`, `markdown`, `html`, `other` (plain text), and PDF OCR-HTML whenever there is selected text, matching the EPUB selection toolbar experience.

#### Scenario: Selecting text in Markdown, HTML, or plain text document
- **WHEN** the user selects text in a Markdown, HTML, or other text document
- **THEN** the system displays the unified selection drawer showing "Create Extract" with the character count and a "Lookup" button

### Requirement: Persistent selection drawer visibility
The system SHALL preserve the visibility of the selection drawer even after the text selection itself is cleared by mouse or keyboard interactions, allowing the user to click the action buttons.

#### Scenario: Selection drawer remains visible after text selection is cleared
- **WHEN** the user selects text in a text document and then clicks or taps in a way that clears the browser selection range
- **THEN** the floating selection drawer remains visible on the screen containing the selected text

### Requirement: Selection drawer dismissal
The system SHALL dismiss the selection drawer and clear the selection context when the user clicks outside the drawer (handling iframe event bubbling correctly) or presses the Escape key.

#### Scenario: Click outside to dismiss in HTML iframe viewer
- **WHEN** the selection drawer is visible in an HTML viewer iframe and the user clicks elsewhere inside the iframe document
- **THEN** the selection is cleared and the drawer is dismissed

#### Scenario: Pressing Escape key to dismiss
- **WHEN** the selection drawer is visible and the user presses the Escape key
- **THEN** the selection is cleared and the drawer is dismissed

### Requirement: Selection drawer in RSS feed view
The system SHALL display the same unified floating selection drawer with character counts and dictionary lookup when text is selected on RSS feed articles in the Queue.

#### Scenario: Selecting text in RSS article
- **WHEN** the user selects text in an RSS feed article in the Queue
- **THEN** the system displays the unified selection drawer showing "Create Extract" with the character count and a "Lookup" button
