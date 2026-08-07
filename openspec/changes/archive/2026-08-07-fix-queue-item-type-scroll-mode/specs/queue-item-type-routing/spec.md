## ADDED Requirements

### Requirement: Queue item-type selection propagates into Scroll Mode

Scroll Mode SHALL build its session from only the item types selected in the
Queue (Documents, Extracts, Flashcards). The Queue's effective selection MUST be
carried into the Scroll Mode tab whenever Scroll Mode is opened from the Queue,
for both the sequential ("Scroll Mode" button) and optimal ("Start Optimal
Session") entry points.

The effective selection is the same one the Queue list itself renders: the
Customize Queue toggles once the user has changed them, and the per-filter
defaults until then.

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
- **THEN** Scroll Mode composes the session exactly as it does today, mixing documents, extracts and flashcards under the existing flashcard-percentage and extract-budget settings

#### Scenario: No type selected
- **WHEN** all three toggles are unchecked and Scroll Mode is opened
- **THEN** Scroll Mode shows its empty state rather than falling back to an unfiltered mix

#### Scenario: Feed items are not governed by the toggles
- **WHEN** RSS-in-queue or podcast-in-queue is enabled in settings and the user unchecks Documents
- **THEN** RSS articles and podcast episodes still appear, because the three toggles do not cover those types
- **AND** no document item appears

### Requirement: Extract queue items open as extracts

An item of type `extract` SHALL be presented as the extract itself — its own
text, with its own rating controls — and SHALL NOT be substituted with its
source document. This applies to the Queue's primary click action, to
sequential Scroll Mode, and to optimal Scroll Mode.

Opening the source document remains available as a secondary action from
inside the extract surface.

#### Scenario: Clicking an extract in the Queue list
- **WHEN** the user clicks an extract row in the Queue
- **THEN** the extract reader opens showing the extract's text
- **AND** the source document is not opened

#### Scenario: Extract reached in Scroll Mode
- **WHEN** Scroll Mode advances to an extract item
- **THEN** the extract scroll card renders with the extract's text and extract rating controls
- **AND** the source document viewer is not rendered in its place

### Requirement: Sequential Scroll Mode renders full extract content

Each extract item in sequential Scroll Mode SHALL render with the extract's
full stored content. An extract that is not part of the currently-due extract
set MUST have its content resolved before it is displayed, rather than being
replaced by a truncated preview or an empty body.

#### Scenario: Extract that is not due
- **WHEN** the Queue shows an extract whose next review date is in the future and the user opens sequential Scroll Mode
- **THEN** that extract's card shows the extract's full content

#### Scenario: Extract content cannot be resolved
- **WHEN** an extract's content cannot be loaded (for example the extract was deleted)
- **THEN** that item is omitted from the session rather than rendered blank
