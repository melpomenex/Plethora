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

Item-type selection and composition govern session **membership** — which
items are eligible. Order within that membership SHALL be determined by the
adaptive queue ranker under `adaptive-queue-ranking`, not by item type. No
item-type selection, composition ratio, or filter SHALL change the ranking
knobs, and no ranking knob SHALL change which item types are eligible.

#### Scenario: Extracts only, optimal session
- **WHEN** the user unchecks Documents and Flashcards, leaving Extracts checked, and clicks "Start Optimal Session"
- **THEN** Scroll Mode contains extract items only
- **AND** no document item and no flashcard item appears anywhere in the session

#### Scenario: Extracts plus Documents
- **WHEN** the user checks Extracts and Documents, unchecks Flashcards, and opens Scroll Mode by either entry point
- **THEN** the session contains extract item and document items
- **AND** no flashcard item appears

#### Scenario: Flashcards only
- **WHEN** the user checks Flashcards only and clicks "Start Optimal Session"
- **THEN** the session contains flashcard items only

#### Scenario: All three types selected
- **WHEN** all three toggles are checked
- **THEN** Scroll Mode SHALL include documents, extracts, and flashcards according to the current session composition settings
- **AND** the order within that membership SHALL be the adaptive ranker's order, not an item-type rotation

#### Scenario: Ranking never overrides type selection
- **GIVEN** only Extracts are checked and an energy target that strongly favours documents
- **WHEN** the queue is re-ranked
- **THEN** no document SHALL enter the session
- **AND** the user's `energyTarget` SHALL remain at its configured value

#### Scenario: No type selected
- **WHEN** all three toggles are unchecked and Scroll Mode is opened
- **THEN** Scroll Mode shows its empty state rather than falling back to an unfiltered mix

#### Scenario: Feed items are not governed by the toggles
- **WHEN** RSS-in-queue or podcast-in-queue is enabled in settings and the user unchecks Documents
- **THEN** RSS articles and podcast episodes still appear, because the three toggles do not cover those types
- **AND** no document item appears