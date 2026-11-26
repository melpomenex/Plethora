## ADDED Requirements

### Requirement: Canonical Cross-Mode Review State Synchronization

Every committed scheduled flashcard review (`noScheduleUpdate !== true`) SHALL reconcile `useReviewStore`, `useQueueStore`, and mounted Scroll Mode sessions using the authoritative `LearningItem` returned by the backend and canonical learning item identity.

#### Scenario: Completing a card in Review View removes it from Scroll Mode and Reading Queue when future-due
- **WHEN** a due flashcard is rated in Review View and scheduled into the future (`due_date > now`)
- **THEN** `useQueueStore` removes matching queue entries (by `id` or `learningItemId`) and invalidates in-flight queue loads
- **AND** mounted or subsequently opened Scroll Mode sessions exclude that flashcard from due feeds without removing its source document

#### Scenario: Completing a card in Scroll Mode or Quick Review reconciles Review View and Reading Queue
- **WHEN** a due flashcard is rated in Scroll Mode or Dashboard Quick Review and scheduled into the future
- **THEN** `useReviewStore` removes that card from its active queue and advances safely if it was `currentCard`
- **AND** `useQueueStore` removes or updates matching queue entries immediately

#### Scenario: Short relearning intervals and review undo preserve authoritative eligibility
- **WHEN** a card is rated `Again` with a due date still within the due window, or a review is undone via `undoLastReview`
- **THEN** the card's due eligibility is updated from authoritative `due_date` rather than a permanent `reviewedToday` exclusion
- **AND** non-scheduling practice, viewing, revealing, or skipping never triggers scheduled review reconciliation
