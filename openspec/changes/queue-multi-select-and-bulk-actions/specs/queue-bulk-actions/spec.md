## ADDED Requirements

### Requirement: Bulk action bar appears only with a non-empty selection
The bulk action bar SHALL render if and only if at least one queue item is selected. It
SHALL float at the bottom center of the viewport above the queue list, SHALL display a
counter reading the selected item count, and SHALL expose a close control that clears
the selection.

#### Scenario: Bar hidden with no selection
- **WHEN** no queue items are selected
- **THEN** the bulk action bar SHALL NOT be rendered

#### Scenario: Counter reflects the selection size
- **WHEN** 12 items are selected
- **THEN** the bar SHALL display a counter indicating 12 selected items

#### Scenario: Close control clears the selection
- **WHEN** 12 items are selected and the user activates the bar's close control
- **THEN** the selection SHALL be empty and the bar SHALL be hidden

### Requirement: Bulk actions are disabled for inapplicable selections
Each bulk action SHALL be enabled only when it applies to every selected item's type.
Actions that apply to a strict subset of item types SHALL be disabled, with a reason
surfaced on hover, when the selection contains an item they cannot act on.

#### Scenario: AI Flashcard Studio requires an all-extract selection
- **WHEN** the selection contains 3 extracts and 1 document
- **THEN** the Bulk AI Flashcard Studio action SHALL be disabled

#### Scenario: Applicable action stays enabled for a mixed selection
- **WHEN** the selection contains documents, extracts, and learning items
- **THEN** the Bulk Delete, Bulk Suspend, Bulk Move, and Bulk Tag actions SHALL be enabled

#### Scenario: Partially applicable action stays enabled and reports what it skipped
- **WHEN** the selection contains documents and learning items and the user sets a priority
- **THEN** the action SHALL remain enabled, the documents SHALL be updated, and the
  learning items SHALL be reported as failures

### Requirement: Bulk priority sets one value across the selection
The Bulk Priority action SHALL open a control accepting an integer priority in the
inclusive range 0 to 100 and SHALL apply that single value, in one backend transaction,
to every selected item that has a priority. Documents and extracts have one; flashcards
do not — the `learning_items` table carries no priority column — so selected flashcards
SHALL be reported as failures with a stated reason rather than silently skipped. Values
outside the range SHALL be clamped into it.

#### Scenario: Priority applied uniformly to items that have one
- **WHEN** 12 documents and extracts are selected and the user sets priority 75
- **THEN** all 12 items SHALL have priority 75 after the operation completes

#### Scenario: Flashcards in the selection are reported, not silently skipped
- **WHEN** a selection of 10 documents and 2 flashcards is given priority 75
- **THEN** the 10 documents SHALL be updated and the 2 flashcards SHALL appear in the
  result's failed list with a reason stating flashcards have no priority

#### Scenario: Out-of-range priority is clamped
- **WHEN** the user submits a priority of 150
- **THEN** the applied value SHALL be 100

### Requirement: Bulk postpone offers fixed and smart modes
The Bulk Postpone action SHALL offer fixed shifts of +1, +3, +7, and +30 days, which
add that exact number of days to each selected item's due date, and a Smart Postpone
mode, which SHALL apply the existing per-item algorithm-weighted interval scaling used
by the single-item smart postpone path rather than a uniform shift.

#### Scenario: Fixed shift adds the same number of days
- **WHEN** 12 items with varying due dates are selected and the user chooses +7 days
- **THEN** each item's due date SHALL advance by exactly 7 days

#### Scenario: Smart postpone varies by item state
- **WHEN** two selected items have different intervals and priorities and the user chooses Smart Postpone
- **THEN** each item SHALL receive the interval increase its own state and priority produce, and the two increases MAY differ

### Requirement: Bulk suspend and unsuspend toggle queue eligibility
The Bulk Suspend action SHALL mark every selected item suspended, and Bulk Unsuspend
SHALL clear that flag. Suspended items SHALL be omitted from upcoming review queues and
SHALL NOT be deleted or otherwise modified.

#### Scenario: Suspended items leave the queue but persist
- **WHEN** 12 items are selected and bulk suspended
- **THEN** those items SHALL NOT appear in subsequent review queues and SHALL still exist in the database

#### Scenario: Unsuspend restores queue eligibility
- **WHEN** 12 suspended items are selected and bulk unsuspended
- **THEN** those items SHALL become eligible for review queues again

### Requirement: Bulk move reassigns collection membership
The Bulk Move action SHALL present the existing collections as targets and SHALL
reassign every selected item's `collection_id` to the chosen collection in one
transaction. It SHALL NOT create a collection as a side effect of the move.

#### Scenario: Items move to the target collection
- **WHEN** 12 items are selected and moved to the collection "Research"
- **THEN** all 12 items SHALL have "Research" as their collection

#### Scenario: Move never creates a collection
- **WHEN** a bulk move completes
- **THEN** the total number of collections SHALL be unchanged

### Requirement: Bulk tag management adds and removes tags
The Bulk Tag action SHALL allow adding one or more tags to, and removing one or more
tags from, every selected item in one transaction. Adding a tag an item already carries
SHALL be a no-op for that item rather than an error, and removing a tag an item does not
carry SHALL likewise be a no-op.

#### Scenario: Tag added across the selection
- **WHEN** 12 items are selected and the tag "physics" is added
- **THEN** all 12 items SHALL carry the tag "physics"

#### Scenario: Adding an existing tag does not duplicate it
- **WHEN** an item already carries "physics" and "physics" is added in bulk
- **THEN** that item SHALL carry exactly one "physics" tag and the operation SHALL report success

### Requirement: Bulk lifecycle transitions extracts and documents
The Bulk Lifecycle action SHALL expose three transitions: Done, which graduates the item
out of the active queue; Dismiss, which hides it from the queue without deleting it; and
Forget, which resets the item's memory state so it is treated as new. Forget SHALL be
confirmed before dispatch because it discards scheduling history.

#### Scenario: Done graduates the selection
- **WHEN** 12 items are selected and transitioned to Done
- **THEN** those items SHALL NOT appear in the active review queue

#### Scenario: Forget resets memory state after confirmation
- **WHEN** the user chooses Forget for 12 items and confirms
- **THEN** each item's memory state SHALL be reset to its new-item baseline

#### Scenario: Forget is abortable
- **WHEN** the user chooses Forget and declines the confirmation
- **THEN** no item SHALL be modified

### Requirement: Bulk AI Flashcard Studio receives combined extract context
The Bulk AI Flashcard Studio action SHALL, for a selection consisting entirely of
extracts, open the Flashcard Studio with the selected extracts' texts supplied together
as generation context, so that one session can produce cards spanning them.

#### Scenario: Studio opens with all selected extract texts
- **WHEN** 5 extracts are selected and the user opens Bulk AI Flashcard Studio
- **THEN** the Studio SHALL open with all 5 extract texts available as context

### Requirement: Bulk delete confirms and offers undo
The Bulk Delete action SHALL present a confirmation dialog stating the exact number of
items to be deleted and stating that the deletion is permanent. On confirmation it SHALL
delete them and report how many were removed. It SHALL NOT offer Undo.

Deletion is irreversible in the current schema: `bulk_delete_items` hard-deletes every
type — `DELETE FROM documents`, `delete_extract`, and a direct delete for learning items
— and no soft-delete column exists to restore from. An Undo affordance here could only
appear to work, which is a worse outcome than not offering one, so the confirmation
carries the warning instead. Restoring Undo to this action requires a soft-delete
backend, which is out of scope for this change.

#### Scenario: Confirmation states the count
- **WHEN** 12 items are selected and the user activates Bulk Delete
- **THEN** the confirmation dialog SHALL state that 12 items will be deleted

#### Scenario: Confirmation states that deletion is permanent
- **WHEN** the Bulk Delete confirmation is shown
- **THEN** it SHALL state that the deletion cannot be undone

#### Scenario: No Undo is offered for a deletion that cannot be reversed
- **WHEN** a bulk delete completes
- **THEN** the resulting feedback SHALL NOT offer an Undo action

#### Scenario: Declining the confirmation deletes nothing
- **WHEN** the user activates Bulk Delete and dismisses the confirmation
- **THEN** no item SHALL be deleted

### Requirement: Every bulk action dispatches exactly one backend call
Each bulk action SHALL be executed by a single batch IPC command wrapping a single
SQLite transaction, regardless of how many items are selected. The frontend SHALL NOT
issue one IPC invocation per selected item.

#### Scenario: One invocation for a large selection
- **WHEN** 200 items are selected and a bulk priority update is submitted
- **THEN** exactly one IPC command SHALL be invoked

#### Scenario: A failed batch leaves no partial write
- **WHEN** a batch command fails partway through its transaction
- **THEN** no selected item SHALL have been modified

### Requirement: Bulk results report per-item outcomes
Each batch command SHALL return a result enumerating which item ids succeeded and which
failed, so that a partially applicable batch — for example, ids that no longer exist —
reports accurately rather than failing wholesale.

#### Scenario: Missing ids are reported as failures
- **WHEN** a batch of 12 ids includes 1 id that no longer exists
- **THEN** the result SHALL report 11 successes and that 1 id as failed

### Requirement: Bulk actions patch local state optimistically
On submitting a bulk action the store SHALL apply the expected change to local queue
state immediately, without waiting for the backend, and SHALL re-run filters and sort
against the patched state. If the backend rejects the operation the store SHALL revert
to the pre-submission state and surface an error.

#### Scenario: UI updates before the backend responds
- **WHEN** a bulk priority update is submitted for 12 items
- **THEN** those 12 rows SHALL show the new priority before the IPC call resolves

#### Scenario: Rejection reverts the optimistic patch
- **WHEN** the backend rejects a bulk priority update
- **THEN** the 12 rows SHALL return to their previous priorities and an error SHALL be surfaced

#### Scenario: Selection clears after a successful mutation
- **WHEN** a bulk action completes successfully
- **THEN** the selection SHALL be cleared and the bulk action bar SHALL be hidden
