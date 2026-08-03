## ADDED Requirements

### Requirement: Deck Manager shall surface cards not matched by any deck
Deck Manager SHALL provide an "Unfiled" view listing every learning item whose tags do not match any existing deck's filters, computed using the same matching logic used elsewhere to determine deck membership.

#### Scenario: User opens the Unfiled view
- **WHEN** user selects "Unfiled" in Deck Manager
- **THEN** the system SHALL display all learning items that do not match the `tagFilters` (or other filter criteria) of any existing deck
- **THEN** items that match at least one existing deck SHALL NOT appear in this view

#### Scenario: Unfiled view is empty
- **WHEN** every learning item matches at least one existing deck
- **THEN** the Unfiled view SHALL show an empty state indicating there are no unfiled cards

### Requirement: Users can select multiple cards and move them to a deck in one action
Deck Manager SHALL allow selecting multiple cards (within a deck view or the Unfiled view) and assigning all selected cards to a target deck — either an existing deck or a newly created one — in a single action.

#### Scenario: Bulk move to an existing deck
- **WHEN** user selects two or more cards in Deck Manager and chooses "Move to deck", then picks an existing deck
- **THEN** the system SHALL reassign all selected cards to that deck using the same tag-based mechanism used for single-card moves
- **THEN** the selected cards SHALL subsequently appear under the target deck and SHALL no longer match their prior deck (unless their tags also independently match it)

#### Scenario: Bulk move creates a new deck
- **WHEN** user selects one or more cards and chooses "Move to deck" → "New deck", then provides a deck name
- **THEN** the system SHALL create a new deck with that name and assign all selected cards to it

#### Scenario: Bulk move from the Unfiled view
- **WHEN** user selects cards while viewing the Unfiled view and moves them to a deck
- **THEN** the selected cards SHALL be assigned to the target deck
- **THEN** the selected cards SHALL no longer appear in the Unfiled view

### Requirement: Every .apkg import path shall create decks matching source Anki deck names
When learning items are imported from a `.apkg` file through any import entry point in the application, the system SHALL ensure a deck exists (creating it if necessary) for each distinct Anki deck name present in the imported items, and imported items SHALL be assigned to that deck.

#### Scenario: Import .apkg via Documents view drag-drop
- **WHEN** user imports a `.apkg` file by dragging it into the Documents view
- **THEN** the system SHALL create a deck for each distinct source Anki deck name found in the import that does not already exist
- **THEN** imported cards SHALL appear under the deck matching their source Anki deck name in Deck Manager

#### Scenario: Import .apkg via Review Home or Review Session
- **WHEN** user imports a `.apkg` file via Review Home or an active Review Session
- **THEN** behavior SHALL be consistent with the Documents view import path: a deck SHALL be created per distinct source Anki deck name, and cards SHALL be assigned accordingly

#### Scenario: Re-importing the same .apkg does not create duplicate decks
- **WHEN** a `.apkg` file is imported more than once, or imported through more than one entry point, and a deck already exists with a matching name
- **THEN** the system SHALL attach imported cards to the existing deck rather than creating a duplicate deck with the same name
