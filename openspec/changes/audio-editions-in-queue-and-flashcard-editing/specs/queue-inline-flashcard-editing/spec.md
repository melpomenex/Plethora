## Purpose

Enables users to edit flashcards in place while reviewing their Queue in Scroll Mode and Queue list views without leaving or disrupting their review session.

## ADDED Requirements

### Requirement: On-card edit trigger and keyboard shortcut in Queue Scroll Mode

When reviewing flashcards in Queue Scroll Mode, each flashcard item SHALL display an on-card edit control (pencil icon) and listen for the `Cmd+E` (macOS) / `Ctrl+E` (Windows/Linux) shortcut when focused on the card.

#### Scenario: Opening editor via button click
- **WHEN** the user is viewing a flashcard in Queue Scroll Mode and clicks the on-card edit button
- **THEN** the inline card editor modal opens immediately
- **AND** displays the card's question, answer, cloze markup (if applicable), and tags

#### Scenario: Opening editor via keyboard shortcut
- **WHEN** a flashcard is active in Queue Scroll Mode and the user presses Cmd+E or Ctrl+E
- **THEN** the inline card editor modal opens
- **AND** focus moves to the primary editable input field

### Requirement: In-place flashcard saving in Queue Scroll Mode

Saving modifications in the inline card editor SHALL immediately update the rendered card in the active Queue Scroll session and persist the changes to storage without reloading the queue, resetting the scroll position, or interrupting the review sequence.

#### Scenario: Successful card update
- **WHEN** the user edits a flashcard's question or answer in the editor and clicks Save
- **THEN** the changes are persisted with version history
- **AND** the card currently rendered in Scroll Mode updates its displayed content immediately
- **AND** the editor closes, allowing the user to reveal the answer or rate the card

#### Scenario: Persistence failure rollback
- **WHEN** persistence fails due to a network or storage error
- **THEN** the system displays an error toast
- **AND** the card in the scroll session retains or restores its original content

### Requirement: Flashcard editing from Queue listings

In Queue list views, items of type `learning-item` SHALL provide an "Edit Flashcard" option in their row action sheet and context menu to allow quick adjustments without navigating to Decks.

#### Scenario: Editing flashcard from queue context menu
- **WHEN** the user right-clicks or opens the action menu on a flashcard queue row and chooses "Edit Flashcard"
- **THEN** the inline card editor dialog opens
- **AND** saving updates the queue row preview and tags in place

### Requirement: Studio hand-off for complex interaction types

When editing cards with complex interaction types (such as image occlusion), the editor SHALL provide an "Edit in Studio" action that opens the card in the full Flashcard Studio or image occlusion composer with its context preserved.

#### Scenario: Editing image occlusion card from queue
- **WHEN** the user opens the editor for an image occlusion card in the Queue and clicks "Edit in Studio"
- **THEN** the inline modal closes and the image occlusion tool opens seeded with the card's source image
