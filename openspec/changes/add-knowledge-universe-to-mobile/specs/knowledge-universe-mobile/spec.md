## ADDED Requirements

### Requirement: Mobile Navigation Access
The system SHALL show the "Knowledge Universe" option in the mobile navigation menu (within the "More" sheet).

#### Scenario: Tap on Knowledge Universe menu item
- **WHEN** the user opens the mobile navigation "More" sheet and taps "Knowledge Universe"
- **THEN** the system SHALL open the Knowledge Universe tab.

### Requirement: Safe Area Inset Support on Tablets
The system SHALL apply safe area paddings to prevent drawing under system bars in all presentation modes (including desktop mode on tablets) on native mobile devices.

#### Scenario: Drawing in desktop presentation mode on native tablet
- **WHEN** the application runs in desktop presentation mode on a native Android or iOS device
- **THEN** the system SHALL add bottom padding equal to the safe-area-inset-bottom to clear the system navigation bar, and top/left/right padding to clear notches.

### Requirement: Multi-Touch Gestures
The system SHALL support multi-touch pinch gestures to zoom in and out and pan the camera in the 3D WebGL Knowledge Universe.

#### Scenario: Pinch-to-zoom in and out
- **WHEN** the user drags two fingers closer together or further apart on the 3D Knowledge Universe canvas
- **THEN** the system SHALL adjust the camera distance to zoom out or in.

#### Scenario: Two-finger pan
- **WHEN** the user drags two fingers on the 3D Knowledge Universe canvas while maintaining the distance
- **THEN** the system SHALL translate the camera target relative to the screen plane to move the universe center.

### Requirement: Single-Pointer Panning
The system SHALL support single-pointer panning using right-click or drag with modifier keys.

#### Scenario: Right-click drag to pan
- **WHEN** the user right-click drags or Shift-left-click drags on the 3D Knowledge Universe canvas
- **THEN** the system SHALL translate the camera target relative to the screen plane.

### Requirement: Viewport Centering Offset
The system SHALL shift the WebGL viewport center to the left when the selected node detail panel is open on desktop/tablet views.

#### Scenario: Centering with selected node detail panel open
- **WHEN** a node is selected in desktop/tablet view of the Knowledge Universe, opening the detail panel
- **THEN** the system SHALL apply a viewport screen-space offset to center the focused node in the remaining visible area.
