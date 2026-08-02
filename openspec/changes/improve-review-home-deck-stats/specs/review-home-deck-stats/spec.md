## ADDED Requirements

### Requirement: Deck list shows total, due, and state-breakdown counts
The Review Home deck list SHALL display, for each deck, the total number of cards belonging to that deck, the number currently due, and a breakdown of new/learning/review card counts, computed from the full learning-item set rather than the due-only item set.

#### Scenario: Deck with cards but none due
- **WHEN** a deck contains cards but none are currently due
- **THEN** the deck row SHALL show "0 due" alongside the deck's non-zero total card count, so it reads as "caught up" rather than "empty"

#### Scenario: Deck with no cards
- **WHEN** a deck has zero cards matching its tag filters
- **THEN** the deck row SHALL show an explicit empty-deck state (e.g. "No cards yet") instead of "0 due"

#### Scenario: Deck with a mix of new, learning, and review cards
- **WHEN** a deck has cards in more than one learning state
- **THEN** the deck row SHALL render a visual breakdown (e.g. a segmented bar) proportional to new/learning/review counts, consistent with the existing `DeckStatsPanel` color convention

### Requirement: Deck stats source from full item set
Per-deck statistics SHALL be computed from the complete set of learning items (via `getAllLearningItems`), not solely from the currently-due item set, so that non-due cards are represented in deck totals.

#### Scenario: Stats computed after fetching all items
- **WHEN** Review Home loads or refreshes its data
- **THEN** it SHALL fetch the full learning-item list in addition to the due-item list, and derive each deck's total/new/learning/review counts from the full list

### Requirement: Deck picker modal matches deck list stats
The deck-picker modal (`ReviewDecksModal`) SHALL display the same per-deck total/due/state-breakdown figures as the Review Home deck list, sourced from the same computed stats.

#### Scenario: Opening the deck picker shows consistent numbers
- **WHEN** a user opens the deck-picker modal from Review Home
- **THEN** each deck's displayed total/due counts SHALL match the counts shown in the Review Home deck list for the same deck

### Requirement: Deck stats fetch failure is visible and distinct from zero counts
If the full learning-item fetch used for deck stats fails, the deck list SHALL show an inline error/loading indicator distinct from a zero-count deck state, so a failed fetch is never misread as an empty or caught-up deck.

#### Scenario: Stats fetch fails
- **WHEN** the request to fetch all learning items fails
- **THEN** the deck list SHALL display an error indicator instead of silently rendering "0" counts for every deck
