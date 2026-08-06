## ADDED Requirements

### Requirement: Plain click sets the selection anchor
Clicking a queue row without a modifier key SHALL replace the entire selection with
that single row and SHALL record it as the selection anchor. The anchor SHALL be stored
as an item id, and each queue surface SHALL supply its own rendered row order when
resolving a click, because the surfaces do not render the same list — the review queue
layers session-customization filters on top of the shared filtered list, so a single
stored index would address a different row depending on which surface asked.

#### Scenario: Plain click replaces a multi-row selection
- **WHEN** rows 2, 3, and 4 are selected and the user plain-clicks row 7
- **THEN** only row 7 SHALL be selected and the anchor SHALL be row 7

#### Scenario: Anchor is recorded on first click
- **WHEN** the selection is empty and the user plain-clicks row 5
- **THEN** row 5 SHALL be selected and the anchor SHALL be row 5

### Requirement: Shift + Click selects a contiguous range
`Shift + Click` on a queue row SHALL select every row between the anchor and the clicked
row, inclusive, in the currently rendered list order, unioned onto the selection as it
stood when the anchor was last set. The range SHALL be computed in either direction. The
anchor SHALL NOT move on a `Shift + Click`, so successive `Shift + Click`s from the same
anchor SHALL re-derive the range rather than accumulate, while rows picked out by an
earlier `Cmd/Ctrl + Click` SHALL survive.

#### Scenario: Forward range selection
- **WHEN** the anchor is row 2 and the user `Shift + Click`s row 6
- **THEN** rows 2, 3, 4, 5, and 6 SHALL be selected

#### Scenario: Backward range selection
- **WHEN** the anchor is row 6 and the user `Shift + Click`s row 2
- **THEN** rows 2, 3, 4, 5, and 6 SHALL be selected

#### Scenario: Successive shift-clicks re-derive rather than accumulate
- **WHEN** the anchor is row 2, the user `Shift + Click`s row 6, then `Shift + Click`s row 4
- **THEN** exactly rows 2, 3, and 4 SHALL be selected and rows 5 and 6 SHALL NOT be selected

#### Scenario: Shift + Click with no prior anchor behaves as a plain click
- **WHEN** the selection is empty, no anchor is set, and the user `Shift + Click`s row 5
- **THEN** only row 5 SHALL be selected and the anchor SHALL become row 5

### Requirement: Cmd/Ctrl + Click toggles a single row
`Cmd + Click` on macOS and `Ctrl + Click` on Windows and Linux SHALL toggle the clicked
row's selection state without altering any other row's state. The clicked row SHALL
become the new anchor whether the toggle selected or deselected it.

#### Scenario: Additive toggle preserves existing selection
- **WHEN** rows 1 and 2 are selected and the user `Cmd + Click`s row 8
- **THEN** rows 1, 2, and 8 SHALL be selected

#### Scenario: Toggle deselects an already-selected row
- **WHEN** rows 1, 2, and 8 are selected and the user `Cmd + Click`s row 2
- **THEN** rows 1 and 8 SHALL be selected and row 2 SHALL NOT be selected

#### Scenario: Toggle moves the anchor
- **WHEN** the anchor is index 1 and the user `Cmd + Click`s index 8, then `Shift + Click`s index 10
- **THEN** rows 8, 9, and 10 SHALL be added to the selection

### Requirement: Select all covers only visible items
`Cmd/Ctrl + A` while the queue list has focus, and clicking the header checkbox, SHALL
select every item in the currently rendered list — that is, after the active search
query, filters, and queue filter mode have been applied. Items excluded by the active
filters SHALL NOT be selected. The keyboard shortcut SHALL NOT fire while focus is
inside a text input, textarea, or contenteditable element.

#### Scenario: Select all respects an active search
- **WHEN** the queue holds 200 items, a search query narrows the rendered list to 12, and the user presses `Cmd + A`
- **THEN** exactly those 12 items SHALL be selected

#### Scenario: Select all does not hijack text input
- **WHEN** focus is inside the queue search box and the user presses `Cmd + A`
- **THEN** the search text SHALL be selected and the queue selection SHALL be unchanged

#### Scenario: Header checkbox clears when already fully selected
- **WHEN** every rendered item is selected and the user clicks the header checkbox
- **THEN** the selection SHALL be cleared

### Requirement: Escape clears the selection
`Escape` SHALL clear the selection and reset the anchor whenever at least one item is
selected, from anywhere in the queue view — including while focus sits in the search
box, since `Escape` has no other duty in that field and dropping a selection must not
depend on where focus happens to be. The bulk action bar's close button SHALL perform
the same clear. `Escape` SHALL NOT clear the selection while a modal, dialog, or open
bulk-action panel is showing, so that the topmost surface dismisses first, nor while an
IME composition is active. Where a queue surface has its own transient mode, the
selection SHALL clear before that mode exits.

#### Scenario: Escape clears an active selection
- **WHEN** 12 items are selected and the user presses `Escape`
- **THEN** the selection SHALL be empty and the bulk action bar SHALL be hidden

#### Scenario: Escape clears the selection from the search box
- **WHEN** 12 items are selected and focus is in the queue search input, and the user presses `Escape`
- **THEN** the selection SHALL be empty

#### Scenario: Escape dismisses an overlay before the selection
- **WHEN** 12 items are selected and the bulk priority panel is open, and the user presses `Escape`
- **THEN** the panel SHALL close and the 12 items SHALL remain selected

#### Scenario: Escape does not clear the selection while a dialog is open
- **WHEN** 12 items are selected and a confirmation dialog is showing, and the user presses `Escape`
- **THEN** the 12 items SHALL remain selected

#### Scenario: Escape is ignored during IME composition
- **WHEN** items are selected and the user presses `Escape` while composing text with an IME
- **THEN** the selection SHALL be unchanged

#### Scenario: Selection clears before a browse mode exits
- **WHEN** the review queue is in manual browse with items selected and the user presses `Escape`
- **THEN** the selection SHALL clear and manual browse SHALL remain active until a second `Escape`

### Requirement: Selected rows are visually distinct
Every selected queue row SHALL render with the `bg-primary/10` background tint and a
`border-primary` border, and its row-level checkbox SHALL render checked. Unselected
rows SHALL render neither. The header checkbox SHALL render in an indeterminate state
when some but not all rendered items are selected.

#### Scenario: Row reflects selection
- **WHEN** a row is selected
- **THEN** it SHALL carry the `bg-primary/10` and `border-primary` classes and its checkbox SHALL be checked

#### Scenario: Header checkbox is indeterminate on a partial selection
- **WHEN** 12 of 40 rendered items are selected
- **THEN** the header checkbox SHALL render indeterminate — neither checked nor unchecked

### Requirement: Selection survives reordering but not reloading
Selected item ids SHALL be preserved when the list is re-sorted or re-filtered, and any
selected id no longer present in the rendered list SHALL be dropped from the selection.
A full queue reload SHALL clear the selection, because the reloaded rows are new server
truth.

#### Scenario: Re-sorting preserves the selection
- **WHEN** 5 items are selected and the user changes the sort order to priority descending
- **THEN** the same 5 items SHALL remain selected at their new positions

#### Scenario: Filtering out a selected item drops it
- **WHEN** 5 items are selected and the user applies a filter that excludes 2 of them
- **THEN** exactly 3 items SHALL remain selected

#### Scenario: Reload clears the selection
- **WHEN** 5 items are selected and the queue performs a full reload
- **THEN** the selection SHALL be empty
