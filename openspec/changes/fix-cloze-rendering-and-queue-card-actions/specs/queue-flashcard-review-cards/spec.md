## Purpose

Defines how flashcards are presented and managed while the user reviews them in Queue Scroll Mode, including reliable cloze masking and card-level editing and deletion.

## ADDED Requirements

### Requirement: Cloze prompts hide deleted text until reveal

When a cloze flashcard is shown in Queue Scroll Mode, the prompt SHALL render supported cloze markers as a hidden answer and SHALL NOT expose the marker syntax or deleted text before reveal. This behavior SHALL work when cloze ranges are missing, empty, or unavailable. Revealing the card SHALL show the deleted text in context. Supported syntax includes simplified `{{answer}}` markers and the application's numbered `{{cN::answer}}` and `[[cN::answer]]` forms.

#### Scenario: Simplified cloze marker with empty ranges
- **WHEN** the user reviews a cloze card whose text is `Larger groups had {{military and economic advantages}}.` and whose stored cloze ranges are empty
- **THEN** the prompt displays `Larger groups had [...].` with the answer hidden
- **AND** the literal braces and hidden answer are not visible before reveal

#### Scenario: Reveal a simplified cloze marker
- **WHEN** the user reveals a card whose text is `Larger groups had {{military and economic advantages}}.`
- **THEN** the prompt displays `military and economic advantages` in its original context

#### Scenario: Numbered cloze marker with a hint
- **WHEN** the user reviews a cloze card containing `{{c1::mitochondria::cell organelle}}`
- **THEN** the unrevealed prompt shows the hint in place of the answer

#### Scenario: Reveal a numbered cloze marker
- **WHEN** the user reveals a card containing `{{c1::mitochondria::cell organelle}}`
- **THEN** the prompt shows `mitochondria` without the marker syntax

#### Scenario: Cloze ranges are unavailable
- **WHEN** a cloze card has valid marker syntax but no usable stored ranges
- **THEN** Queue Scroll Mode parses the marker syntax and renders the same hidden and revealed states

### Requirement: Queue review cards provide top-right edit and delete actions

Each flashcard shown in Queue Scroll Mode SHALL provide pencil (edit) and trash (delete) icon controls at the top right of the card. The controls SHALL have accessible names and SHALL remain available without obscuring the prompt or review controls.

#### Scenario: Edit a card in place
- **WHEN** the user selects the pencil control on a flashcard in Queue Scroll Mode
- **THEN** the existing inline card editor opens for that card
- **AND** after a successful save, the updated card is shown in the active queue session without resetting the user's place

#### Scenario: Delete the current card
- **WHEN** the user selects the trash control on a flashcard in Queue Scroll Mode
- **THEN** the card is deleted through the application's undoable card deletion flow
- **AND** the deleted card is removed from the active session and the next available item is presented
- **AND** the queue's session position is preserved
