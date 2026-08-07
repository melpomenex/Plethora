## MODIFIED Requirements

### Requirement: Queue item-type selection propagates into Scroll Mode

Scroll Mode SHALL build its session from only the item types selected in the
Queue (Documents, Extracts, Flashcards). The Queue's effective selection MUST be
carried into the Scroll Mode tab whenever Scroll Mode is opened from the Queue,
for both the sequential ("Scroll Mode" button) and optimal ("Start Optimal
Session") entry points.

The effective selection is the same one the Queue list itself renders: the
Customize Queue toggles once the user has changed them, and the per-filter
defaults until then.

The toggles take precedence over the composition targets: an unchecked type
contributes no items whatever its slider says, and its share is redistributed
across the checked types.

#### Scenario: Extracts only, optimal session
- **WHEN** the user unchecks Documents and Flashcards, leaving Extracts checked, and clicks "Start Optimal Session"
- **THEN** Scroll Mode contains extract items only
- **AND** no document item and no flashcard item appears anywhere in the session

#### Scenario: Extracts plus Documents
- **WHEN** the user checks Extracts and Documents, unchecks Flashcards, and opens Scroll Mode by either entry point
- **THEN** the session contains extract items and document items
- **AND** no flashcard item appears

#### Scenario: Flashcards only
- **WHEN** the user checks Flashcards only and clicks "Start Optimal Session"
- **THEN** the session contains flashcard items only

#### Scenario: All three types selected
- **WHEN** all three toggles are checked
- **THEN** Scroll Mode composes the session from the Documents / Extracts / Flashcards composition targets in Queue Settings

#### Scenario: An unchecked type with a non-zero slider
- **WHEN** the user unchecks Flashcards while the Flashcards slider sits at 55%
- **THEN** no flashcard appears in the session
- **AND** the 55% share is redistributed across Documents and Extracts in proportion to their own targets

#### Scenario: No type selected
- **WHEN** all three toggles are unchecked and Scroll Mode is opened
- **THEN** Scroll Mode shows its empty state rather than falling back to an unfiltered mix

#### Scenario: Feed items are not governed by the toggles
- **WHEN** RSS-in-queue or podcast-in-queue is enabled in settings and the user unchecks Documents
- **THEN** RSS articles and podcast episodes still appear, because the three toggles do not cover those types
- **AND** no document item appears
