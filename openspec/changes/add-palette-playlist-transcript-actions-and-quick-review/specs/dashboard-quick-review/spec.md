## Purpose

Makes the Dashboard Quick Review widget genuinely useful by wiring it to real due spaced-repetition learning items and persisting FSRS review ratings instead of displaying non-functional document placeholders.

## ADDED Requirements

### Requirement: Dashboard Quick Review displays real due learning items
The system SHALL populate the Dashboard Quick Review widget with actual due flashcards and learning items from the user's review queue (filtered by active collection or study deck when applicable), displaying the card prompt on the front and the answer plus source document context on the back.

#### Scenario: User has due review cards
- **WHEN** the user opens the Dashboard and due learning items exist
- **THEN** the Quick Review widget displays the due cards (with cloze deletions properly masked on the front and revealed on the back) along with the remaining due count and source document title

#### Scenario: User has no due review cards
- **WHEN** the user opens the Dashboard and zero learning items are due
- **THEN** the Quick Review widget displays the "All caught up!" empty state with an action to open the full Review tab or practice ahead

### Requirement: Rating a card in Dashboard Quick Review persists an FSRS review
The system SHALL submit a real spaced-repetition review (`Again`, `Hard`, `Good`, or `Easy`) when the user rates a card in the Dashboard Quick Review widget, updating the card's scheduling state and refreshing dashboard due statistics.

#### Scenario: User flips and rates a due card on the Dashboard
- **WHEN** the user reveals the answer of a card in the Dashboard Quick Review widget and selects a rating ("Again", "Hard", "Good", or "Easy")
- **THEN** the system persists the FSRS review rating via the review API, advances to the next due card, and updates the dashboard's due card count
