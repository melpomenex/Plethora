## Purpose

Ensure stable focus during card authoring, complete tag lifecycle updates in Deck Manager, error-free card editing in Scroll Mode, and advance-on-delete semantics in review sessions.

## ADDED Requirements

### Requirement: Stable focus during card authoring
The Q&A card creation modal SHALL focus the Question field exactly once upon mounting. Subsequent keystrokes in any input field (including the Answer textarea) SHALL NOT steal or redirect focus back to the Question input.

#### Scenario: Typing an answer in the Q&A modal
- **GIVEN** the Q&A Creator Popup is open
- **WHEN** the user clicks into the Answer field and types multiple characters
- **THEN** focus SHALL remain continuously in the Answer field
- **AND** no focus jump to the Question field SHALL occur

### Requirement: Complete tag editing and add affordance in Deck Manager
Deck Manager card rows SHALL reflect tag changes immediately upon persistence without requiring a page reload. Cards with zero tags SHALL display a visible affordance to add a tag.

#### Scenario: Adding a tag to an untagged card
- **GIVEN** a card in Deck Manager that currently has no tags
- **WHEN** the user hovers over or focuses the row
- **THEN** a "+ Tag" button SHALL be rendered
- **AND** clicking it SHALL open the tag editor popover
- **AND** saving a tag SHALL immediately display the new tag badge on that row

### Requirement: Advance-on-delete review session transition
Deleting a card during an active review session SHALL immediately remove the card from the session, advance presentation to the next item, and SHALL NOT require or prompt for a recall rating.

#### Scenario: Deleting a card in review
- **GIVEN** an active review session presenting card 3 of 10
- **WHEN** the user deletes card 3
- **THEN** card 3 SHALL be deleted from SQLite
- **AND** the session SHALL immediately present card 4 (now card 3 of 9)
- **AND** no recall grade rating buttons SHALL be required to advance
