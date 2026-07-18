## ADDED Requirements

### Requirement: Full Zoom-Out on Any Aspect Ratio
The system SHALL derive the camera's maximum zoom-out distance from both the vertical and horizontal fields of view of the current viewport, such that the entire universe (all star systems including the outer belt and halo) fits within the visible frame at maximum zoom-out, regardless of device orientation or aspect ratio.

#### Scenario: Pinch out fully on a portrait phone
- **WHEN** the user pinches out to the zoom limit in a portrait viewport
- **THEN** the entire universe SHALL be visible within the screen bounds, with no nodes clipped by the narrow horizontal field of view.

#### Scenario: Camera limits follow orientation changes
- **WHEN** the viewport is resized or rotated between portrait and landscape
- **THEN** the system SHALL recompute the zoom limits for the new aspect ratio and re-clamp the current camera distance into the new range.

### Requirement: Aspect-Aware Home Framing
The system SHALL compute the home/reset camera distance from the current viewport aspect ratio so that the cluster core is fully framed in both screen axes.

#### Scenario: Reset view on a portrait phone
- **WHEN** the user activates reset view in a portrait viewport
- **THEN** the camera SHALL travel to a distance at which the cluster core fits fully within both the width and height of the screen.

### Requirement: Focal-Point Pinch Zoom
The system SHALL anchor pinch zoom to the gesture's focal point: the world point under the center of the two touches SHALL remain visually stationary while the camera distance changes.

#### Scenario: Pinch toward an off-center system
- **WHEN** the user pinches outward centered over a star system away from the screen center
- **THEN** the system SHALL zoom in toward that system, keeping the point under the gesture center fixed on screen rather than zooming toward the current orbit target.

### Requirement: Tap Zoom Gestures
The system SHALL support stepped zoom via taps on touch devices: a double-tap on empty space SHALL zoom in toward the tapped point with an animated transition, and a two-finger tap SHALL zoom out one step with an animated transition. A double-tap on a node SHALL retain its existing behavior of opening that node.

#### Scenario: Double-tap empty space to zoom in
- **WHEN** the user double-taps on empty space in the universe on a touch device
- **THEN** the camera SHALL animate one zoom step in toward the tapped point, and the tap SHALL NOT clear the selection or pop the focus level.

#### Scenario: Two-finger tap to zoom out
- **WHEN** the user taps briefly with two fingers without significant movement
- **THEN** the camera SHALL animate one zoom step out, clamped to the maximum zoom-out distance.

#### Scenario: Double-tap on a node still opens it
- **WHEN** the user double-taps a node
- **THEN** the system SHALL open the node as before and SHALL NOT apply a zoom step.

### Requirement: Two-Finger Twist Rotation
The system SHALL rotate the camera heading when the user twists two touch points around each other, composing with simultaneous pinch zoom and two-finger pan in the same gesture.

#### Scenario: Twist to orbit
- **WHEN** the user rotates two touching fingers around their midpoint
- **THEN** the camera SHALL orbit around the current target by the corresponding angle while any concurrent pinch zoom and pan continue to apply.

### Requirement: Zoom Momentum
The system SHALL continue a pinch zoom with decaying momentum when the fingers are released while still moving, consistent with the existing rotation inertia, and SHALL disable this momentum when the user prefers reduced motion.

#### Scenario: Release a fast pinch
- **WHEN** the user releases a pinch gesture while the zoom rate is still significant
- **THEN** the camera distance SHALL continue changing in the same direction with decaying momentum until it settles or reaches a zoom limit.

#### Scenario: Reduced motion preference
- **WHEN** the user has enabled the reduced-motion preference
- **THEN** releasing a pinch SHALL stop the zoom immediately with no momentum.

### Requirement: Gesture Tap Isolation
The system SHALL ensure that ending a multi-touch gesture never triggers tap actions: no node selection change, selection clearing, or focus-level pop may result from lifting fingers after a pinch, pan, twist, or two-finger tap. On touch devices, the empty-space single-tap action SHALL be deferred briefly so a second tap can convert it into a double-tap zoom instead.

#### Scenario: Lifting fingers after a pinch
- **WHEN** the user completes a pinch gesture and lifts both fingers
- **THEN** the system SHALL NOT interpret the gesture end as a tap, and the current selection and focus level SHALL remain unchanged.

#### Scenario: Single tap on empty space still navigates back
- **WHEN** the user taps once on empty space on a touch device and no second tap follows within the double-tap window
- **THEN** the system SHALL perform the existing empty-space action (clear selection, or pop one focus level) after the deferral window.

### Requirement: Touch-Reachable Non-Overlapping Chrome
The system SHALL lay out the universe view's chrome on the mobile shell so that the top controls, breadcrumb trail, and floating zoom/reset controls do not overlap one another at narrow widths and remain fully within safe-area insets.

#### Scenario: Narrow portrait layout
- **WHEN** the universe view renders in the mobile shell at a narrow viewport width
- **THEN** the search control SHALL be collapsed into an expandable icon, the breadcrumb SHALL render on its own row without overlapping other controls, and all controls SHALL remain tappable.

#### Scenario: Floating controls clear system bars
- **WHEN** the universe view renders on a device with bottom safe-area insets
- **THEN** the floating zoom and reset controls SHALL be offset above the safe-area inset and remain fully visible and tappable.
