## ADDED Requirements

### Requirement: Synced NotebookLM cards default to a deck named after the source notebook
When the system creates Incrementum cards from a NotebookLM flashcard or quiz artifact, it SHALL default the destination deck to one derived from the source notebook's title, creating that deck if it does not already exist, rather than requiring the user to pick a deck with no default.

#### Scenario: First sync from a notebook creates a matching deck
- **WHEN** the user syncs flashcards generated from a NotebookLM notebook titled "Organic Chemistry Ch. 4" and no deck with that name exists yet
- **THEN** the system creates a new deck named "Organic Chemistry Ch. 4" and places the synced cards in it

#### Scenario: Repeat sync from the same notebook reuses the existing deck
- **WHEN** the user syncs additional flashcards from a notebook whose title matches (case-insensitively) an existing deck's name
- **THEN** the system places the newly synced cards in that existing deck instead of creating a duplicate

#### Scenario: User overrides the suggested deck before confirming
- **WHEN** the user is presented with the notebook-derived deck name as a default during sync confirmation and changes it to a different existing or new deck name
- **THEN** the system places the synced cards in the user-chosen deck instead of the notebook-derived one

#### Scenario: Notebook title is empty or unusable as a deck name after sanitization
- **WHEN** the source notebook has no title, or its title becomes empty after removing characters that are unsafe for deck tags
- **THEN** the system defaults the destination deck to a generic name ("NotebookLM Import") instead of failing the sync

### Requirement: Synced cards retain source notebook provenance independent of deck assignment
The system SHALL record which NotebookLM notebook a synced card originated from, independent of and surviving changes to the card's deck assignment.

#### Scenario: Card provenance is queryable after deck reassignment
- **WHEN** a card synced from a NotebookLM notebook is later moved to a different deck or its deck is renamed
- **THEN** the system still reports the card's originating notebook when queried
