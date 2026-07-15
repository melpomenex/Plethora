## ADDED Requirements

### Requirement: Ordered Reading Queue
The Reading Queue SHALL render its current visible items in the same deterministic order used to choose the next queue item. The order SHALL be calculated after active search and filter constraints, and each visible item SHALL show a 1-based queue position and the total number of visible items. The first visible item SHALL be identifiable as the next item up.

#### Scenario: Mixed queue shows the effective order
- **GIVEN** the Reading Queue contains documents, extracts, RSS articles, playlist videos, and learning items
- **WHEN** the user opens the Reading Queue
- **THEN** the items SHALL appear in the effective queue order rather than alphabetical or arrival order
- **AND** every row SHALL show its position within the visible queue
- **AND** the first row SHALL be labelled as the item up next

#### Scenario: Filtering recalculates visible positions
- **GIVEN** the queue contains 12 items and the user filters it to 4 matching items
- **WHEN** the filtered queue is rendered
- **THEN** the visible rows SHALL be numbered from 1 through 4 in their effective queue order
- **AND** no hidden item’s position SHALL be shown as a gap in the visible list

#### Scenario: Equal-ranked items remain stable
- **GIVEN** two visible items have the same effective queue rank
- **WHEN** the queue is refreshed without a user filter change
- **THEN** those items SHALL retain a deterministic relative order
- **AND** the displayed positions SHALL not change solely because the data was reloaded

### Requirement: Scrollable Queue Viewport
The Reading Queue SHALL provide a vertically scrollable item-list region sized to the available viewport, while keeping queue controls and the queue’s primary actions usable. Scrolling the list SHALL not require the user to scroll the entire application page to reach later queue items.

#### Scenario: Long queue is browsable on a phone
- **GIVEN** the visible queue contains more items than fit in the mobile viewport
- **WHEN** the user swipes vertically within the item list
- **THEN** the list SHALL scroll through all visible items
- **AND** the queue header and primary controls SHALL remain outside the scrolling content

#### Scenario: Long queue remains usable on desktop
- **GIVEN** the visible queue exceeds the available desktop queue height
- **WHEN** the user scrolls the queue list
- **THEN** the list SHALL reveal later positions without expanding the page indefinitely
- **AND** large lists SHALL retain the existing virtualization behavior where it is already used

#### Scenario: Queue refresh preserves the browsing anchor
- **GIVEN** the user is viewing a later item in the queue
- **WHEN** a queue action refreshes the list
- **THEN** the list SHALL restore the prior item as the visible anchor when that item remains
- **AND** if that item was removed, the nearest remaining item SHALL be used as the anchor

### Requirement: Long-Press Item Action Sheet
On touch-capable Reading Queue surfaces, holding a queue item for the configured long-press duration SHALL open an action sheet for that item. The completed long-press SHALL suppress the follow-up click so the item is not opened or reviewed unintentionally. A hold that becomes a scroll or is cancelled SHALL not open the sheet.

#### Scenario: Long-press opens actions without opening the item
- **GIVEN** a queue row is visible and the user holds it without moving beyond the gesture threshold
- **WHEN** the long-press duration is reached
- **THEN** an item action sheet SHALL open for that row
- **AND** the row’s ordinary tap action SHALL not run

#### Scenario: Scrolling cancels long-press
- **GIVEN** the user touches a queue row and moves far enough to scroll the list before the long-press duration
- **WHEN** the list begins scrolling
- **THEN** the long-press SHALL be cancelled
- **AND** no action sheet SHALL open

#### Scenario: Accessible action entry point is available
- **GIVEN** a user cannot or does not use long-press
- **WHEN** the user focuses the row’s explicit actions control and activates it
- **THEN** the same item action sheet SHALL open
- **AND** focus SHALL move into the sheet and return to the invoking control when the sheet closes

### Requirement: Contextual Queue Item Actions
The item action sheet SHALL show only actions supported by the selected queue item. It SHALL provide navigation to continue the item, review entry for learning items, algorithm-aware postponement for eligible items, removal from the active queue using the item’s supported suspend/dismiss operation, and entry into the existing bulk-selection flow.

#### Scenario: Document actions
- **GIVEN** the selected queue item is an eligible document
- **WHEN** the action sheet opens
- **THEN** it SHALL offer open/resume, postpone, remove from the active queue, and select for bulk actions
- **AND** it SHALL not offer start review as the primary action

#### Scenario: Learning-item actions
- **GIVEN** the selected queue item is a learning item
- **WHEN** the action sheet opens
- **THEN** it SHALL offer start review, algorithm-aware postpone, suspend, and select for bulk actions
- **AND** it SHALL not offer document-only navigation when no document action is supported

#### Scenario: Unsupported mutation is hidden
- **GIVEN** a queue item type has no supported backend operation for removal or postponement
- **WHEN** its action sheet opens
- **THEN** the unsupported action SHALL be omitted
- **AND** the user SHALL still be able to use the supported navigation and selection actions

### Requirement: Safe Queue Action Feedback
After a queue action changes item state, the Reading Queue SHALL close the action sheet, refresh the visible queue order, and communicate success or failure using the existing queue feedback patterns. Removal actions SHALL use existing confirmation and undo behavior where available.

#### Scenario: Postpone updates the queue
- **GIVEN** the user selects postpone for an eligible queue item and confirms the computed schedule change
- **WHEN** the operation succeeds
- **THEN** the sheet SHALL close
- **AND** the item’s updated position or absence SHALL be reflected in the refreshed queue
- **AND** the user SHALL see a success message

#### Scenario: Removal can be undone
- **GIVEN** the user removes an item using an action that supports undo
- **WHEN** the removal succeeds
- **THEN** the item SHALL leave the active queue
- **AND** the user SHALL receive an undo affordance
- **AND** choosing undo SHALL restore the item and refresh its queue position

#### Scenario: Failed action leaves the queue usable
- **GIVEN** a queue mutation fails
- **WHEN** the failure is returned
- **THEN** the sheet SHALL close or return to a recoverable state
- **AND** the user SHALL see an error message
- **AND** the queue SHALL remain available without losing the current browsing location
