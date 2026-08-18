## ADDED Requirements

### Requirement: Saving a card materializes its deck reference

Whenever a card is saved with a deck reference (a deck selected in the studio picker, a `deck:` tag, or a seeded deck tag), the corresponding deck entity SHALL be created in the shared deck store in the same action if it does not exist, so a deck referenced at creation time is immediately visible and editable in Deck Manager without waiting for another surface's reconciliation.

#### Scenario: Card with a new deck tag creates the deck

- **WHEN** a card is saved carrying a deck tag for which no deck entity exists
- **THEN** the deck entity exists after the save
- **AND** opening Deck Manager lists it with the card matched

### Requirement: Deck visibility parity between creation and management

Every deck that can be referenced or offered when creating a card SHALL appear in Deck Manager, and every deck in Deck Manager SHALL be offerable when creating a card — both surfaces read the same store with no filtering that hides decks from one but not the other. No synthetic or system deck SHALL be shown in one surface but excluded from the other.

#### Scenario: Picker decks appear in Deck Manager

- **WHEN** the user selects or creates a deck while saving a card and then opens Deck Manager
- **THEN** that deck is listed and editable (rename; delete follows existing card-preserving semantics)

#### Scenario: Decks are not device-filtered within a session

- **WHEN** a deck is created in any in-app surface during a session
- **THEN** every deck surface in that session (picker, manager, review home) reflects it
