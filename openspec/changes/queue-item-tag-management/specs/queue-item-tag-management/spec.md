## ADDED Requirements

### Requirement: Add a tag from the Queue item Details popover
The Details popover SHALL allow a user to add a new tag to the currently displayed item when its type is `document`, `extract`, or `learning-item`, without navigating away from the Queue.

#### Scenario: Add a valid new tag
- **WHEN** the user types a tag name into the tag input in the Details popover and confirms it (Enter or an add control)
- **THEN** the tag is optimistically added to the item's tag pill list, persisted via the item's existing update command, and the input is cleared for another entry

#### Scenario: Attempt to add a duplicate tag
- **WHEN** the user submits a tag name that already exists on the item (case-insensitive match)
- **THEN** no duplicate pill is added and no update request is sent

#### Scenario: Attempt to add an empty or whitespace-only tag
- **WHEN** the user submits an empty or whitespace-only value
- **THEN** no tag is added and the input remains focused for correction

#### Scenario: Save fails after optimistic add
- **WHEN** the backend update call for a newly added tag fails
- **THEN** the optimistically added pill is removed, the tag input is restored with the attempted value, and an error toast is shown

### Requirement: Remove a tag from the Queue item Details popover
The Details popover SHALL allow a user to remove an existing tag from the currently displayed item when its type is `document`, `extract`, or `learning-item`.

#### Scenario: Remove a tag
- **WHEN** the user activates the remove control on a tag pill
- **THEN** the tag is optimistically removed from the displayed list and the removal is persisted via the item's existing update command

#### Scenario: Save fails after optimistic removal
- **WHEN** the backend update call for a tag removal fails
- **THEN** the removed pill is restored to the displayed list and an error toast is shown

### Requirement: RSS items keep read-only tags in the Details popover
The Details popover SHALL NOT expose tag add/remove controls when the displayed item's type is `rss`.

#### Scenario: Viewing an RSS item's details
- **WHEN** the Details popover is opened for an item of type `rss`
- **THEN** any tags are shown as plain read-only pills with no add input and no remove control

### Requirement: Browse items sharing a tag
The system SHALL allow a user to click a tag pill (outside its remove control) in the Details popover to open a modal listing every document, extract, and learning item that carries that exact tag.

#### Scenario: Open the tag-browse modal
- **WHEN** the user clicks a tag pill in view mode
- **THEN** a modal opens showing all documents, extracts, and learning items whose tags include that tag, grouped by item type, each entry showing at minimum its title and type

#### Scenario: No other items share the tag
- **WHEN** the user clicks a tag pill and no other item (besides the current one) carries that tag
- **THEN** the modal opens showing only the current item, or an explicit empty-state message if the current item itself is excluded from its own listing

#### Scenario: Navigate to a listed item
- **WHEN** the user clicks an entry in the tag-browse modal
- **THEN** the modal closes and the corresponding document or extract is opened, or the learning item's parent document is opened, in the main view

#### Scenario: Close the tag-browse modal without navigating
- **WHEN** the user dismisses the tag-browse modal (close control, Escape, or backdrop click)
- **THEN** the modal closes and the Queue Details popover remains in its prior state

### Requirement: Common item actions available from the Details popover
The Details popover SHALL expose postpone, dismiss/undismiss, and delete actions for the currently displayed item, matching the behavior of the equivalent actions already available from the Queue's item context menu.

#### Scenario: Postpone from the Details popover
- **WHEN** the user activates the postpone action in the Details popover
- **THEN** the same smart-postpone logic used by the Queue context menu runs against the current item and the popover reflects the updated scheduling stats on success

#### Scenario: Dismiss/undismiss from the Details popover
- **WHEN** the user activates the dismiss (or undismiss) action for a `document` item
- **THEN** the item's dismissed state is toggled using the existing dismiss/undismiss behavior already present in the popover

#### Scenario: Delete from the Details popover
- **WHEN** the user activates the delete action and confirms the resulting confirmation prompt
- **THEN** the item is deleted using the same delete flow as the Queue context menu, and the Details popover closes

#### Scenario: Cancel a delete confirmation
- **WHEN** the user activates the delete action but declines the confirmation prompt
- **THEN** the item is not deleted and the Details popover remains open and unchanged
