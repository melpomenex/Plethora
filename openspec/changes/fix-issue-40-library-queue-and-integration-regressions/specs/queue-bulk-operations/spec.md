## ADDED Requirements

### Requirement: Bulk queue operations resolve every queue item type

Bulk suspend, unsuspend, and delete SHALL resolve each supplied item id against **all** entity types that can appear in the queue — learning items (flashcards), documents, and extracts — and apply the operation appropriate to the resolved type. An id SHALL be reported as failed only when it matches no queue-eligible entity, or when the operation against the resolved entity itself fails.

Suspending a document or an extract SHALL remove it from scheduling in the same way that suspending a flashcard does, and SHALL be reversible by unsuspending it.

#### Scenario: Suspending a selection of documents succeeds

- **WHEN** the user selects two documents in the Reading Queue and chooses Suspend
- **THEN** the result reports two succeeded and zero failed
- **AND** both documents leave the active queue

#### Scenario: Suspending a mixed selection succeeds for every type

- **WHEN** the user selects one document, one extract, and one flashcard and chooses Suspend
- **THEN** the result reports three succeeded and zero failed

#### Scenario: Unsuspending restores a suspended document

- **WHEN** a suspended document is unsuspended
- **THEN** it returns to the queue under its existing schedule

#### Scenario: An unresolvable id is reported as failed

- **WHEN** a bulk operation is given an id matching no queue-eligible entity
- **THEN** that id is reported as failed with a reason identifying it as not found
- **AND** every other id in the same request is still processed

### Requirement: Bulk queue operations resolve their working set once per request

A bulk operation SHALL resolve the entities it needs once per request. It SHALL NOT re-read the full entity table once per supplied id.

#### Scenario: Entity lookup does not scale with selection size

- **WHEN** a bulk operation is invoked with fifty item ids
- **THEN** the number of full-table reads performed does not grow with the number of ids

### Requirement: Bulk queue operations clear the selection on completion

Bulk suspend, unsuspend, and delete SHALL clear the queue selection when they complete, so the bulk action bar does not persist after its action has run. This behavior SHALL be identical across all three operations.

#### Scenario: The action bar is dismissed after suspend

- **WHEN** the user suspends a selection of queue items
- **THEN** the selection is empty
- **AND** the bulk action bar is dismissed

#### Scenario: The action bar is dismissed after unsuspend

- **WHEN** the user unsuspends a selection of queue items
- **THEN** the selection is empty
- **AND** the bulk action bar is dismissed

### Requirement: Bulk operation failures explain themselves

When a bulk operation reports any failures, the user SHALL be able to see why each failed item failed, not only the number that failed. A result in which every item failed SHALL be presented as an error rather than as a neutral status message.

#### Scenario: Per-item errors are available after a partial failure

- **WHEN** a bulk operation reports three succeeded and one failed
- **THEN** the reason for the failed item is available to the user

#### Scenario: A total failure is presented as an error

- **WHEN** a bulk operation reports zero succeeded and two failed
- **THEN** the outcome is presented to the user as an error
- **AND** the reasons for both failures are available
