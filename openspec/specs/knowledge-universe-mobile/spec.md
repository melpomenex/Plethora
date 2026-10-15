# knowledge-universe-mobile Specification

## Purpose
The Knowledge Universe (3D WebGL galaxy view) is currently a desktop-only feature. It is missing from the mobile navigation interface, and the WebGL container lacks viewport scaling, proper touch gestures (pinch-to-zoom and panning), and layout centering for mobile or tablet screens. This proposal adds the Knowledge Universe to the mobile app layout with appropriate gestures and resolves layout/centering issues on tablets.

## Requirements

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
