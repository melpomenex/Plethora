## ADDED Requirements

### Requirement: Document row checkboxes toggle selection independently of row-click semantics

The Documents view SHALL support two distinct selection gestures. Clicking a document's **row body** SHALL follow file-explorer semantics: a plain click replaces the selection, Shift extends a range from the anchor, and the platform toggle modifier (Cmd on macOS, Ctrl elsewhere) adds or removes a single document. Clicking a document's **checkbox** without Shift SHALL toggle that document's membership in the selection, whether or not the platform toggle modifier is held. Shift-clicking a checkbox SHALL extend a range from the anchor, matching the row-body gesture.

A checked checkbox SHALL therefore always be clearable in a single unmodified click. Clearing the last selected document SHALL dismiss the bulk action bar.

#### Scenario: Clicking a checked checkbox deselects that document

- **WHEN** exactly one document is selected and the user clicks that document's checkbox
- **THEN** the document becomes unselected
- **AND** the selection is empty
- **AND** the bulk action bar is dismissed

#### Scenario: Clicking a checkbox adds without clearing others

- **WHEN** two documents are selected and the user clicks a third document's checkbox with no modifier keys held
- **THEN** all three documents are selected

#### Scenario: Shift-clicking a checkbox extends a range

- **WHEN** the user clicks one document's checkbox and then Shift-clicks a later document's checkbox
- **THEN** every document between the two, inclusive, is selected

#### Scenario: Row-body click retains replace semantics

- **WHEN** two documents are selected and the user clicks a third document's row body with no modifier keys held
- **THEN** only the third document is selected

#### Scenario: Row-body click on an already-selected document does not clear it

- **WHEN** a single document is selected and the user clicks that same document's row body with no modifier keys held
- **THEN** the document remains selected

### Requirement: Bulk tag, move, and reprioritize use in-app dialogs

Bulk Tag, Move, and Reprioritize SHALL collect their input through in-app dialog components consistent with the rest of the application. They SHALL NOT depend on `window.prompt()`, whose availability in the desktop WebView is not guaranteed.

Each dialog SHALL be dismissible without applying a change, and dismissing it SHALL leave the selection intact.

#### Scenario: Tag dialog applies a tag to every selected document

- **WHEN** the user selects three documents, chooses Tag, enters a tag name, and confirms
- **THEN** all three documents carry the tag
- **AND** the change is persisted

#### Scenario: Cancelling a bulk dialog changes nothing

- **WHEN** the user selects two documents, opens the Reprioritize dialog, and dismisses it
- **THEN** neither document's priority changes
- **AND** both documents remain selected

### Requirement: Bulk move persists the target collection

Bulk Move SHALL persist the target collection for every selected document. When the user names a collection that does not exist, the collection SHALL be created and the documents SHALL be moved into it. A move SHALL NOT be reported as successful unless the collection assignment has been written.

#### Scenario: Moving documents to an existing collection

- **WHEN** the user selects two documents and moves them to an existing collection
- **THEN** both documents belong to that collection after the operation
- **AND** both documents appear under that collection after a reload

#### Scenario: Moving documents to a new collection

- **WHEN** the user selects a document and moves it to a collection name that does not yet exist
- **THEN** the collection is created
- **AND** the document belongs to the new collection after a reload

#### Scenario: A failed move is reported, not silently swallowed

- **WHEN** the collection assignment fails for one of three selected documents
- **THEN** the user is told that two of three documents moved and one failed

### Requirement: Bulk actions report their outcome and release the selection

Every bulk action in the Documents view SHALL report how many documents succeeded and how many failed, and SHALL clear the selection once the action completes. When at least one document fails, the reason SHALL be available to the user rather than only a count.

#### Scenario: Selection is released after a completed bulk action

- **WHEN** the user applies any bulk action to a selection and the action completes
- **THEN** the selection is empty
- **AND** the bulk action bar is dismissed

#### Scenario: Partial failure exposes the reason

- **WHEN** a bulk action succeeds for two documents and fails for one
- **THEN** the result reports two succeeded and one failed
- **AND** the failure reason for the third document is available to the user

### Requirement: Extract counts reflect extracts created in the current session

A document's extract count SHALL be updated when an extract is created from or deleted for that document, without requiring a document reload or an application restart. Every surface that displays the count — list, grid, and compact views — SHALL show the updated value.

#### Scenario: Creating an extract increments the displayed count

- **WHEN** a document showing 0 extracts is opened and the user creates an extract
- **AND** the user returns to the Documents view
- **THEN** the document shows 1 extract

#### Scenario: Deleting an extract decrements the displayed count

- **WHEN** a document shows 3 extracts and the user deletes one of them
- **THEN** the document shows 2 extracts without a reload

### Requirement: Document priority is adjustable from the library and by keyboard

The Documents view SHALL allow changing a document's priority without opening it, from the compact and grid views. A keyboard shortcut SHALL adjust the priority of the focused or active document, registered through the application's shortcut registry so that it appears in the shortcut list and can be rebound.

#### Scenario: Adjusting priority from the compact view

- **WHEN** the user changes a document's priority from the compact view
- **THEN** the new priority is persisted
- **AND** the displayed priority updates without a reload

#### Scenario: Adjusting priority by keyboard

- **WHEN** a document is active in the Documents view and the user presses the priority-adjustment shortcut
- **THEN** the document's priority changes by the configured step
- **AND** the change is persisted

#### Scenario: The priority shortcut is discoverable and rebindable

- **WHEN** the user opens the keyboard shortcut settings
- **THEN** the priority-adjustment shortcut is listed
- **AND** it can be reassigned like any other shortcut
