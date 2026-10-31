## MODIFIED Requirements

### Requirement: Bulk actions are disabled for inapplicable selections
Each bulk action SHALL be enabled only when it applies to every selected item's type. Actions that apply to a strict subset of item types SHALL be disabled, with a reason surfaced on hover, when the selection contains an item they cannot act on.

#### Scenario: AI Flashcard Studio requires an all-extract selection
- **WHEN** the selection contains 3 extracts and 1 document
- **THEN** the Bulk AI Flashcard Studio action SHALL be disabled

#### Scenario: Applicable action stays enabled for a mixed selection
- **WHEN** the selection contains documents, extracts, and learning items
- **THEN** the Bulk Delete, Bulk Suspend, Bulk Move, and Bulk Tag actions SHALL be enabled

#### Scenario: Partially applicable action stays enabled and reports what it skipped
- **WHEN** a priority selection includes an item that no longer exists
- **THEN** the action SHALL remain enabled, existing items SHALL be updated, and the missing item SHALL be reported as a failure

#### Scenario: Priority applies to a mixed selection
- **WHEN** the selection contains documents, extracts, and learning items and the user sets a priority
- **THEN** the priority action SHALL remain enabled and apply to each selected item

### Requirement: Bulk priority sets one value across the selection
The Bulk Priority action SHALL open a control accepting an integer priority in the inclusive range 0 to 100 and SHALL apply that single value, in one backend transaction, to every selected item, including documents, extracts, and flashcards. Values outside the range SHALL be clamped into it. Missing or otherwise unresolvable items SHALL be reported as failures rather than silently skipped.

#### Scenario: Priority applied uniformly to items that have one
- **WHEN** 12 documents and extracts are selected and the user sets priority 75
- **THEN** all 12 items SHALL have priority 75 after the operation completes

#### Scenario: Flashcards in the selection are reported, not silently skipped
- **WHEN** a selection of 10 documents and 2 flashcards is given priority 75
- **THEN** all 12 items SHALL retain the corresponding priority after the operation completes and SHALL be reported as successes

#### Scenario: Out-of-range priority is clamped
- **WHEN** the user submits a priority of 150
- **THEN** the applied value SHALL be 100

#### Scenario: Missing items are reported
- **WHEN** an item in the selection no longer exists when the batch is resolved
- **THEN** the result SHALL identify the missing item as failed with a reason
