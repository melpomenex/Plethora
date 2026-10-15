## ADDED Requirements

### Requirement: The canvas supports zoom and pan while authoring

The composer canvas SHALL support zooming between at least 100% and 800% and panning the zoomed image, and regions SHALL remain editable at every zoom level. Zoom SHALL be reachable by scroll-wheel/pinch, by explicit zoom controls, and by a "fit to view" reset. Region coordinates SHALL remain percent-based relative to the source image and SHALL NOT change when the view is zoomed or panned.

#### Scenario: Drawing at high zoom

- **WHEN** the user zooms to 400% and draws a region over a small diagram label
- **THEN** the region is created at the drawn location
- **AND** its stored coordinates correspond to the same location when the view is reset to fit

#### Scenario: Panning does not move regions

- **WHEN** the user pans the zoomed canvas
- **THEN** no region's stored coordinates change

#### Scenario: Fit to view resets the viewport

- **WHEN** the user activates "fit to view"
- **THEN** the whole image is visible and centred in the canvas

### Requirement: Regions can be drawn, selected, moved, resized and deleted

The canvas SHALL support drawing a region by dragging on empty image space, selecting a region by clicking it, moving a selected region by dragging its body, resizing it by dragging any of its corner or edge handles, and deleting it via the Delete/Backspace key or an explicit delete control. Every mutation SHALL be clamped to the image bounds.

#### Scenario: Draw creates a region

- **WHEN** the user drags across empty image space
- **THEN** a region is created matching the dragged rectangle
- **AND** it becomes the selected region

#### Scenario: Resize from any handle

- **WHEN** the user drags a region's edge handle
- **THEN** only that edge moves and the opposite edge stays fixed

#### Scenario: Drag outside the image is clamped

- **WHEN** the user drags a region partly beyond the image edge
- **THEN** the region is clipped to the image bounds and retains positive area

#### Scenario: Delete key removes the selected region

- **WHEN** a region is selected and the user presses Delete while focus is not in a text field
- **THEN** that region is removed

### Requirement: Keyboard control provides precise region placement

With a region selected, arrow keys SHALL nudge it by one pixel of the source image, Shift+arrow SHALL nudge by ten, and Alt/Option+arrow SHALL resize by the same increments. Tab SHALL cycle selection through the region list in order.

#### Scenario: Arrow nudge

- **WHEN** a region is selected and the user presses the right arrow key
- **THEN** the region moves right by one source pixel

#### Scenario: Shift accelerates the nudge

- **WHEN** the user presses Shift and the down arrow key
- **THEN** the region moves down by ten source pixels

#### Scenario: Nudging at the edge is clamped

- **WHEN** a region is flush against the image edge and the user nudges it further in that direction
- **THEN** the region does not leave the image bounds

### Requirement: Multiple regions can be selected and acted on together

The canvas SHALL support adding a region to the selection with a modifier click and selecting several regions with a rubber-band drag on empty space when a select tool or modifier is active. Move, delete, and duplicate SHALL apply to every selected region.

#### Scenario: Modifier click extends the selection

- **WHEN** the user clicks one region and modifier-clicks a second
- **THEN** both regions are selected

#### Scenario: Moving a multi-selection

- **WHEN** two regions are selected and the user drags one of them
- **THEN** both regions move by the same offset

#### Scenario: Duplicating a selection

- **WHEN** the user duplicates a selection of two regions
- **THEN** two new regions are created offset from the originals and become the selection

### Requirement: A numbered region list mirrors the canvas

The composer SHALL show a list of the current regions in creation order, each with its ordinal number, an editable label, and a delete control. Selecting a list entry SHALL select and scroll to the corresponding region on the canvas, and selecting a region on the canvas SHALL highlight its list entry. Each region SHALL render its ordinal on the canvas.

#### Scenario: List selection drives the canvas

- **WHEN** the user clicks the third entry in the region list
- **THEN** the third region is selected on the canvas and scrolled into view

#### Scenario: Canvas selection drives the list

- **WHEN** the user selects a region on the canvas
- **THEN** its list entry is highlighted

#### Scenario: Labels are editable from the list

- **WHEN** the user types a label into a region's list entry
- **THEN** that label is stored on the region and displayed with its ordinal on the canvas

### Requirement: Undo and redo cover every region mutation

The composer SHALL maintain an undo/redo history covering draw, move, resize, delete, duplicate, label, and accepted AI suggestions. Undo and redo SHALL be available via toolbar controls and the platform undo/redo shortcuts. History SHALL be scoped to the composer session and cleared when it closes.

#### Scenario: Undo restores a deleted region

- **WHEN** the user deletes a region and then undoes
- **THEN** the region reappears with its previous geometry and label

#### Scenario: Redo reapplies an undone move

- **WHEN** the user moves a region, undoes, then redoes
- **THEN** the region returns to the moved position

#### Scenario: Undo is unavailable at the start of a session

- **WHEN** the composer has just opened and nothing has been edited
- **THEN** the undo control is disabled

### Requirement: Touch input is a first-class authoring path

On touch devices the canvas SHALL support drawing by drag, pinch-to-zoom, two-finger pan, and tap-to-select, and region handles SHALL present a hit target of at least 44×44 CSS pixels. Region handles SHALL NOT overlap so densely that a handle becomes unreachable at fit-to-view zoom.

#### Scenario: Pinch zoom on touch

- **WHEN** the user pinches on the canvas
- **THEN** the canvas zooms about the pinch centre without creating a region

#### Scenario: Touch handles are large enough

- **WHEN** the composer renders on a mobile shell
- **THEN** each resize handle exposes a hit area of at least 44×44 CSS pixels
