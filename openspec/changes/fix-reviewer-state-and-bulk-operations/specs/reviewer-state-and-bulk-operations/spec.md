## ADDED Requirements

### Requirement: Bulk flashcard deletion is transactional and reports partial failures

The system SHALL delete only the selected flashcard IDs transactionally, unlink associated `element_tree` nodes, record sync delete tombstones, update `useQueueStore` and deck counts, and surface per-item errors instead of reporting silent success when any item fails.

#### Scenario: Bulk deleting selected cards leaves unselected cards intact and persists across restart
- **WHEN** the user selects multiple flashcards in Deck Manager and confirms Delete
- **THEN** only the succeeded card IDs are removed from persistence and UI state
- **AND** unselected cards and source documents remain untouched
- **AND** any failed IDs remain visible with an accurate error message

### Requirement: Completed Scroll Mode items leave the active Reading Queue

When a user completes a review item (flashcard rating, extract review, or document rating) in Scroll Mode, the system SHALL synchronize `useQueueStore` so the completed item no longer persists in the Reading Queue if its next due date is outside the active queue window.

#### Scenario: Rating a flashcard in Scroll Mode removes it from Reading Queue
- **WHEN** the user rates a due flashcard in Scroll Mode such that its next due date moves into the future
- **THEN** `useQueueStore` removes or updates that item immediately
- **AND** returning to the Reading Queue tab does not show the completed card as due

### Requirement: Reviewer and Deck Manager tag edits persist and reconcile across stores

Tag additions, removals, and bulk retags performed in Review Mode or Deck Manager SHALL persist to the canonical backend and reconcile `useReviewStore`, `useQueueStore`, and local component props without reverting.

#### Scenario: Editing tags in Review Mode persists after closing popover and restarting
- **WHEN** the user adds or removes a tag in Review Mode's Edit Tags popover
- **THEN** the tag change is persisted via the backend API and `useReviewStore.currentCard.tags` updates immediately
- **AND** reopening the popover or reloading the session displays the updated tags
