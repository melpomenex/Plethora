## ADDED Requirements

### Requirement: Shift-click selects an inclusive document range

The Documents view SHALL support Windows/File Explorer-style range selection on desktop. A normal item click SHALL establish the selection anchor, and a Shift-click SHALL select every document ID between the anchor and target, inclusive, in the current view’s visible filtered and sorted order.

#### Scenario: User selects a contiguous range

- **WHEN** the user clicks document A and then Shift-clicks document D in the current order A, B, C, D, E
- **THEN** documents A, B, C, and D are selected
- **AND** document E remains unselected
- **AND** the selection count and bulk-action controls reflect the complete range

#### Scenario: User changes the range endpoint

- **WHEN** the user keeps the same anchor and Shift-clicks a different visible endpoint
- **THEN** the selected range is recalculated from the anchor to the new endpoint
- **AND** stale documents outside the new range are not left selected unless they were independently selected through a modifier toggle

#### Scenario: Anchor is not visible

- **WHEN** the current filter or view no longer contains the selection anchor
- **AND** the user Shift-clicks a visible document
- **THEN** the clicked document is selected as a normal single selection
- **AND** it becomes the new anchor

#### Scenario: Duplicate cards represent one document

- **WHEN** the same document appears in more than one visible Documents section
- **AND** the user Shift-clicks across the sections
- **THEN** the range is calculated from a de-duplicated document-ID order
- **AND** each document ID appears at most once in the selected set

### Requirement: Existing Documents selection interactions remain compatible

Range selection SHALL preserve existing ordinary click, Cmd/Ctrl toggle, checkbox, double-click/open, context-menu, and mobile interaction behavior.

#### Scenario: Modifier toggle remains available

- **WHEN** the user Cmd-clicks on macOS or Ctrl-clicks on Windows/Linux
- **THEN** only the clicked document’s selected state is toggled
- **AND** the existing selection anchor behavior remains usable for a later Shift-click

#### Scenario: Checkbox and card selection agree

- **WHEN** the user selects an item through its checkbox or its card/row click target
- **THEN** both controls update the same selected-ID set
- **AND** Shift and Cmd/Ctrl modifiers are interpreted consistently where the platform provides them

#### Scenario: Mobile selection is used

- **WHEN** the Documents view is used on a mobile form factor
- **THEN** the existing mobile open/selection behavior remains unchanged
- **AND** the desktop Shift-click range interaction is not required for touch input
