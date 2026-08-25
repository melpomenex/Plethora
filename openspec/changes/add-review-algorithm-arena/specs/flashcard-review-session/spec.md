## ADDED Requirements

### Requirement: Eligible Plethora Precision reviews include an interval decision phase

When the Arena review preference is `choose`, the Review tab's eligible Plethora Precision flashcard session SHALL model the review as grade, Arena decision, commit, then advance. Grading alone SHALL NOT remove the card, increment session metrics, show completion feedback, publish sync events, create an undo snapshot, or load the next card. Those effects SHALL occur only after the selected interval commits successfully. With the default `automatic` preference, the session SHALL atomically commit Arena Pick and advance without entering a visible decision phase. Ineligible reviews SHALL retain their existing lifecycle.

#### Scenario: Grading pauses before advance

- **WHEN** the user grades an eligible Plethora Precision learning item
- **THEN** the reviewed card remains the current card with its answer visible
- **AND** the session enters the Arena phase without changing queue or completion metrics

#### Scenario: Commit advances exactly once

- **WHEN** the user confirms an Arena interval and the backend commit succeeds
- **THEN** the card is removed from the pending queue according to existing bury rules
- **AND** session metrics, feedback, sync publication, and undo state update exactly once
- **AND** the session advances to the next card or completion state

#### Scenario: Arena commit fails before advance

- **WHEN** confirmation fails before the review is committed
- **THEN** the current card and queue position remain unchanged
- **AND** completion feedback and sync publication do not occur

#### Scenario: Automatic Arena scheduling bypasses the decision phase

- **WHEN** the user grades an otherwise eligible Plethora Precision learning item with Arena review mode set to `automatic`
- **THEN** Arena Pick commits atomically without creating pending decision state
- **AND** queue and session effects occur only after that automatic commit succeeds

### Requirement: Pending Arena review is protected during navigation

The Review tab SHALL treat an uncommitted Arena grade as pending work. Returning from the Arena to rating SHALL discard only the pending grade/selection and SHALL NOT mutate scheduling data. Exiting the Review tab or resetting the session while a grade is pending SHALL require explicit discard confirmation. Normal previous/next queue navigation SHALL be unavailable until the pending review is committed or discarded.

#### Scenario: User returns to rating

- **WHEN** the user activates Back to rating from the Arena
- **THEN** the same answer remains available for regrading
- **AND** no schedule, queue, or history mutation exists from the discarded grade

#### Scenario: User exits with a pending grade

- **WHEN** the user attempts to leave the Review tab while an Arena grade is pending
- **THEN** the system asks whether to discard the pending grade
- **AND** leaving after confirmation does not create a review event

#### Scenario: User attempts queue navigation

- **WHEN** the Arena is loading, ready, or committing and the user invokes previous/next card navigation
- **THEN** the session does not change cards
- **AND** it directs the user to confirm or return to rating first

### Requirement: Undo restores the pre-Arena learning-item state

After a committed Arena review, the existing one-step review undo SHALL restore the learning item, queue, metrics, and scheduling state that existed before grading. The undo snapshot SHALL include every algorithm-state field affected by the chosen interval and SHALL reverse the review-result/provenance event according to the app's existing undo policy.

#### Scenario: Undo a model-selected interval

- **WHEN** the user commits an FSRS candidate through the Arena and then invokes undo
- **THEN** the card's due date, interval, algorithm state, queue position, and session metrics return to their pre-grade values
- **AND** the committed Arena decision is no longer treated as an active review event

### Requirement: Hands-free audio preserves automatic progression

When hands-free audio auto-advance is active for an otherwise eligible Plethora Precision review, the session SHALL auto-confirm Arena Pick after grading rather than stopping on a visual-only chooser. The system SHALL announce the chosen relative interval, record the selection source as `arena`, and preserve the same atomic commit and error guarantees as the visual Arena flow.

#### Scenario: Audio review auto-confirms Arena Pick

- **WHEN** hands-free audio mode grades an eligible Plethora Precision card through its configured automatic action
- **THEN** the weighted Arena recommendation is committed atomically
- **AND** the chosen interval is announced before the flow advances

#### Scenario: Audio auto-confirm commit fails

- **WHEN** the automatic Arena Pick commit fails in hands-free mode
- **THEN** the session does not advance
- **AND** it announces that scheduling needs attention and exposes the recoverable Arena error state
