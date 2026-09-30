## Purpose

Defines how the review session and queue surfaces behave on phone-sized viewports: popups and panels stay inside the screen, gesture-driven rows never come to rest off-screen, and every control a phone user needs to navigate or leave a surface is labelled.

## ADDED Requirements

### Requirement: Overlay surfaces stay within the viewport

Any panel, popup, or list presented over review or queue content SHALL be positioned so that all of it remains reachable within the visible viewport at phone widths, regardless of where its anchor sits.

#### Scenario: Session queue list opened on a narrow phone

- **GIVEN** a phone-sized viewport
- **WHEN** the user opens the session queue list
- **THEN** the entire list is visible within the screen's horizontal bounds
- **AND** no part of it is positioned at a negative horizontal offset
- **AND** its full height is reachable without the surrounding page scrolling horizontally

#### Scenario: Very narrow viewport

- **WHEN** the session queue list is opened on a viewport narrower than the list's natural width
- **THEN** the list narrows to fit the available width rather than overflowing
- **AND** its contents remain readable and tappable

#### Scenario: Window resized while the list is open

- **GIVEN** the session queue list is open
- **WHEN** the window or device is rotated, or the viewport is resized
- **THEN** the list repositions to remain within the new visible bounds

#### Scenario: Contextual panels over the same content

- **WHEN** any other panel is presented over review or queue content at a phone width
- **THEN** the same within-viewport guarantee holds for that panel

### Requirement: Gesture-driven rows return to a visible resting position

A row displaced by a horizontal drag SHALL come to rest fully visible, and SHALL be returned to its undisplaced position when the gesture is interrupted, cancelled, or not completed.

#### Scenario: Flick without a completed gesture

- **GIVEN** a queue row has been dragged horizontally
- **WHEN** the gesture ends without the row being released normally, such as when the touch is cancelled or the gesture is interrupted
- **THEN** the row animates back to its undisplaced, fully visible position

#### Scenario: Drag released past the intended threshold

- **GIVEN** a queue row has been dragged a long distance
- **WHEN** the user releases
- **THEN** the row's displacement is bounded so the row never rests with part of itself off-screen

#### Scenario: Row is activated

- **GIVEN** a row is displaced and the user activates one of its swipe actions
- **THEN** the row returns to its undisplaced position

#### Scenario: Container is resized

- **GIVEN** a row is at rest
- **WHEN** the viewport is resized or the layout reflows
- **THEN** the row remains fully visible

### Requirement: Queue content is not squeezed by adjacent fixed-width panels

A queue list SHALL shrink to the space available next to a fixed-width side panel, rather than being compressed below a usable width or causing the pane to overflow horizontally.

#### Scenario: Narrow pane with the inspector open

- **GIVEN** a queue view with a side inspector panel that is open
- **WHEN** the available pane is too narrow to show both at full width
- **THEN** the list narrows to the remaining space
- **AND** no content is clipped or pushed outside the pane

#### Scenario: Inspector opened or closed

- **WHEN** the user opens or closes the inspector
- **THEN** the list adjusts its width
- **AND** no horizontal page overflow appears

### Requirement: Phone navigation controls are labelled

Every control in a phone presentation that selects between views SHALL carry a readable text label, not an unlabelled icon or an empty target. Labels SHALL NOT be hidden at any viewport width.

#### Scenario: View switcher on a phone

- **GIVEN** a phone-sized viewport
- **WHEN** a view switcher is displayed
- **THEN** each of its options shows a readable text label alongside any icon

#### Scenario: Label visibility at every width

- **WHEN** the same switcher is rendered at phone, tablet, and desktop widths
- **THEN** the labels are visible at all three

#### Scenario: Screen reader

- **WHEN** a labelled icon-only-looking control is exposed to assistive technology
- **THEN** it has an accessible name that conveys its destination

### Requirement: Overlays do not exceed the visible area on wide screens either

Progress and status overlays anchored to a screen edge SHALL be bounded so they do not grow off-screen when their content grows.

#### Scenario: Large session

- **GIVEN** a long review session
- **WHEN** the session's progress indicator is displayed on a narrow viewport
- **THEN** the indicator remains fully within the screen
- **AND** the indicator still communicates progress, including when the session is longer than the space available for individual markers
