# queue-item-details Specification

## Purpose
Provides a responsive, scrollable, and dismissible item details modal/sheet for queue items, ensuring users can review complete metadata and actions without being trapped by unbounded overlays.

## Requirements

### Requirement: Bounded Mobile Sheet Presentation and Scrolling
The system SHALL present item details in a responsive bottom sheet bounded by viewport height, ensuring the details content is vertically scrollable without expanding beyond the screen edges or hiding controls.

#### Scenario: Viewing item details on mobile viewport
- **WHEN** a user opens the Details overlay while viewing an item in the Queue on a mobile or compact screen
- **THEN** the details sheet is constrained within safe viewport dimensions (capped to safe height) and allows vertical scrolling to inspect all sections and actions without clipping.

### Requirement: Persistent Header with Close Button
The system SHALL maintain a fixed, visible header at the top of the item details modal containing the title and a prominent close button that never scrolls out of view.

#### Scenario: Closing item details via header close button
- **WHEN** a user taps or clicks the close ("X") button in the item details header
- **THEN** the item details interface closes immediately and restores full interaction to the queue item viewer.

### Requirement: Backdrop Scrim with Tap-to-Dismiss
The system SHALL render a full-screen dimmed backdrop overlay behind the item details interface on mobile devices that dismisses the details modal when tapped.

#### Scenario: Closing item details via backdrop tap
- **WHEN** a user taps or clicks the dimmed backdrop area outside the item details sheet
- **THEN** the item details sheet closes and returns the user to the queue reading view.

#### Scenario: Protecting initial open tap from accidental dismissal
- **WHEN** the item details sheet is initially opened by a touch event
- **THEN** taps landing on the backdrop within the first 300ms of opening are ignored to prevent immediate dismissals from in-flight touch gestures.

### Requirement: Keyboard and Action Dismissal
The system SHALL close the item details interface when the user presses the Escape key or triggers an item action that removes the item from the queue.

#### Scenario: Dismissing details via Escape key
- **WHEN** a user presses the Escape key while the item details interface is open
- **THEN** the details interface closes.

#### Scenario: Dismissing or deleting item from details
- **WHEN** a user successfully deletes or dismisses the current item from within the details modal
- **THEN** the modal closes and the queue advances or refreshes appropriately.

### Requirement: Desktop Popover Bounded Height
The system SHALL constrain the desktop popover presentation so it does not exceed the visible window height and permits vertical scrolling when item metadata is tall.

#### Scenario: Viewing item details on desktop viewport
- **WHEN** a user opens the details popover on a desktop browser or window with constrained vertical height
- **THEN** the popover content scrolls vertically within a bounded container without overflowing off the bottom of the screen.
