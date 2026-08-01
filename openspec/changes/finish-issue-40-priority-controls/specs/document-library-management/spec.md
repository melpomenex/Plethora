## MODIFIED Requirements

### Requirement: Document priority is adjustable from the library and by keyboard

A document's priority is a continuous value in the range 0-100, expressed through a slider control. The Documents view SHALL allow changing priority without opening the document from **every** layout — list, grid, and compact — each of which renders an inline continuous 0-100 slider bound to the document record and persisting through the document-update API. A read-only badge alone is not sufficient; a discrete increment-only stepper is not sufficient.

A keyboard shortcut (`Shift+P` by default) SHALL open a priority popup anchored to the active item, containing a 0-100 slider **and** a numeric input that accepts a typed integer in 0-100. The popup SHALL operate on the current selection: when exactly one item is selected it sets that item's priority; when multiple items are selected (via multi-select or shift-click range select) it mass-sets the same priority to every selected document. The same shortcut SHALL open the popup in the document reader for the currently-open document. The shortcut SHALL be registered through the application's primary shortcut registry so it is discoverable in the shortcut list and rebindable; it SHALL NOT remain split across the secondary shortcut registry.

The continuous priority value SHALL genuinely drive document queue ordering: the queue-ordering calculation SHALL consume the 0-100 value as its priority input, so that distinct slider positions produce distinct ordering within a set of due documents. (Document *due-date* scheduling is out of scope and unchanged.) Existing documents with no user-set priority SHALL be treated as the neutral midpoint so that the migration does not silently demote them.

Cancelling the popup (Escape or click-outside) SHALL apply no change and leave the selection intact. A multi-document set SHALL report how many documents succeeded and how many failed, and SHALL clear the selection on completion like other bulk actions. Every write path — single update, generic document update, and the bulk/mass-set path — SHALL keep the slider value, the derived rating, and the priority score mutually consistent through one canonical server-side derivation.

#### Scenario: Adjusting priority from the compact view

- **WHEN** the user drags the inline continuous slider on a document in the compact view
- **THEN** the document's 0-100 priority is persisted
- **AND** the displayed priority updates without a reload

#### Scenario: Adjusting priority from the grid view

- **WHEN** the user drags the inline continuous slider on a grid card without opening the document
- **THEN** the new priority is persisted
- **AND** the grid card's displayed priority updates without a reload

#### Scenario: Adjusting priority from the list view

- **WHEN** the user drags the inline continuous slider on a list row without opening the document
- **THEN** the new priority is persisted
- **AND** the list row's displayed priority updates without a reload

#### Scenario: Shift+P opens the priority popup for a single selected item

- **WHEN** exactly one document is selected in the Documents view and the user presses the priority shortcut
- **THEN** a popup opens containing a 0-100 slider and a numeric input, anchored to the selected item
- **AND** committing a value sets that document's priority and persists it

#### Scenario: Shift+P mass-sets priority across a multi-selection

- **WHEN** the user shift-clicks (or multi-selects) several documents and presses the priority shortcut
- **THEN** the popup opens indicating it will set priority for multiple documents
- **AND** committing a value writes that same 0-100 priority to every selected document
- **AND** the result reports how many succeeded and how many failed

#### Scenario: Shift+P opens the popup in the reader

- **WHEN** a document is open in the reader and the user presses the priority shortcut
- **THEN** the popup opens for the open document
- **AND** committing a value persists the priority and the reader's priority control reflects it

#### Scenario: Typing a number sets an exact priority

- **WHEN** the priority popup is open and the user types a number into the numeric input
- **THEN** the slider moves to that value and committing persists exactly that value
- **AND** values outside 0-100 are clamped to the valid range

#### Scenario: Cancelling the popup changes nothing

- **WHEN** the user opens the priority popup and dismisses it with Escape or click-outside
- **THEN** no document's priority changes
- **AND** the selection remains intact

#### Scenario: The priority shortcut is discoverable, rebindable, and single-sourced

- **WHEN** the user opens the keyboard shortcut settings
- **THEN** the priority shortcut is listed under the primary shortcut registry
- **AND** it can be reassigned like any other shortcut
- **AND** it does not also exist under the secondary shortcut registry

#### Scenario: The continuous slider genuinely orders the queue

- **WHEN** two documents are equally due and one has a higher 0-100 priority than the other
- **THEN** the higher-priority document orders first in the queue
- **AND** two documents whose slider values differ only slightly can obtain different ordering positions

#### Scenario: Unset-priority documents remain neutral

- **WHEN** a document has no user-set priority (slider and rating both unset) and the queue is built
- **THEN** the document is ordered as if at the neutral midpoint, not demoted to the bottom
