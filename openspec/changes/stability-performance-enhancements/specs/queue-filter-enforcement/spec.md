## ADDED Requirements

### Requirement: Hard post-filter enforces item type exclusions
After `computeOptimalQueue` returns its result, the queue store SHALL apply a hard post-filter step that removes items violating the session's item-type and percentage constraints before setting the active queue state.

#### Scenario: Flashcard ratio set to 0%
- **WHEN** the user sets the flashcard percentage to 0% in queue session settings
- **THEN** zero flashcard items SHALL appear in the active session queue, regardless of what `computeOptimalQueue` returns

#### Scenario: Extracts-only mode
- **WHEN** the user selects "Extracts Only" queue filter
- **THEN** only extract items SHALL appear in the active session queue; documents and flashcards SHALL be excluded

### Requirement: Item type percentages enforced in queue composition
The `itemTypes` and percentage parameters SHALL be enforced inside `computeOptimalQueue` and `queueStore.fetchQueue` so that the returned queue respects user-specified ratios.

#### Scenario: 70% extracts, 30% flashcards
- **WHEN** the user configures 70% extracts and 30% flashcards
- **THEN** the resulting queue SHALL contain approximately 70% extract items and 30% flashcard items (±5% tolerance for small queue sizes)
