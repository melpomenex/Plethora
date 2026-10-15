## ADDED Requirements

### Requirement: Viewport-Independent Universe Centering
The system SHALL derive the Knowledge Universe home target from the geometric center of the visible layout and SHALL project that target at the center of the usable canvas on every supported viewport size and aspect ratio.

#### Scenario: Initial render of an asymmetric universe
- **WHEN** the Knowledge Universe first renders a dataset whose visible nodes are distributed asymmetrically around the world origin
- **THEN** the geometric center of the visible layout SHALL appear at the center of the usable canvas rather than in a corner or along an edge.

#### Scenario: Reset after camera navigation
- **WHEN** the user activates reset/home after rotating, zooming, panning, or focusing into a node system
- **THEN** the camera SHALL return to a view centered on the geometric center of the complete universe layout.

#### Scenario: Centering across viewport classes
- **WHEN** the home view renders on a phone, tablet, compact desktop window, or full desktop window in portrait or landscape orientation
- **THEN** the universe SHALL remain centered in both screen axes within the usable canvas.

### Requirement: Responsive Center Stability
The system SHALL recompute framing and projection for viewport and overlay changes without introducing a stale screen-space offset or discarding intentional camera navigation.

#### Scenario: Orientation or window-size change at home
- **WHEN** the viewport is resized or rotated while the universe is at its home view
- **THEN** the camera SHALL reframe the layout for the new aspect ratio and the universe SHALL remain centered in the usable canvas.

#### Scenario: Resize after deliberate pan or focus
- **WHEN** the viewport is resized after the user has deliberately panned the universe or focused a system or node
- **THEN** the system SHALL preserve that navigation target while updating the projection and valid zoom range.

#### Scenario: Detail panel occupies the right side
- **WHEN** a selected-node detail panel occupies part of the right side of the canvas
- **THEN** the focused target SHALL appear at the geometric center of the remaining unobscured canvas area.

#### Scenario: Detail panel closes or becomes an overlay
- **WHEN** the selected-node detail panel closes or a responsive presentation change makes it overlay rather than occupy canvas width
- **THEN** the system SHALL clear the panel projection offset and center the home target in the full usable canvas.
