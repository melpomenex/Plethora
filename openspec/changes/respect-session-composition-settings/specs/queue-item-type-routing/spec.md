## MODIFIED Requirements

### Requirement: Queue item-type selection propagates into Scroll Mode

The list-sourced Scroll Mode session SHALL build from only the item types selected in the
Queue (Documents, Extracts, Flashcards). The Queue's effective selection MUST be carried
into the Scroll Mode tab whenever Scroll Mode is opened from the Queue via the sequential
("Scroll Mode") button, because that session is a replay of the list the user is looking at.

The effective selection is the same one the Queue list itself renders: the
Customize Queue toggles once the user has changed them, and the per-filter
defaults until then.

The optimal ("Start Optimal Session") entry point does not replay the list and is NOT
governed by these toggles. Its membership is governed by the composition shares — see the
`session-composition` capability.

#### Scenario: Extracts only, sequential Scroll Mode
- **WHEN** the user unchecks Documents and Flashcards, leaving Extracts checked, and clicks "Scroll Mode"
- **THEN** Scroll Mode contains extract items only
- **AND** no document item and no flashcard item appears anywhere in the session

#### Scenario: Extracts plus Documents
- **WHEN** the user checks Extracts and Documents, unchecks Flashcards, and opens Scroll Mode via the sequential button
- **THEN** the session contains extract items and document items
- **AND** no flashcard item appears

#### Scenario: Flashcards only
- **WHEN** the user checks Flashcards only and clicks "Scroll Mode"
- **THEN** the session contains flashcard items only

#### Scenario: All three types selected
- **WHEN** all three toggles are checked
- **THEN** Scroll Mode composes the session exactly as it does today, thinning the list to the composition shares while keeping its order

#### Scenario: No type selected
- **WHEN** all three toggles are unchecked and the sequential Scroll Mode is opened
- **THEN** Scroll Mode shows its empty state rather than falling back to an unfiltered mix

#### Scenario: Toggles do not gate an Optimal Session
- **WHEN** the user unchecks Flashcards and clicks "Start Optimal Session" with the Flashcards share above 0
- **THEN** the session still contains flashcards at their configured share

#### Scenario: Feed items are not governed by the toggles
- **WHEN** RSS-in-queue or podcast-in-queue is enabled in settings and the user unchecks Documents
- **THEN** RSS articles and podcast episodes still appear, because the three toggles do not cover those types
- **AND** no document item appears
