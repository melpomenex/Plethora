## ADDED Requirements

### Requirement: Modal overlays layer above the mobile bottom navigation

Modal overlays SHALL consume the documented overlay/dialog layer of the z-index scale so that, on every presentation, their scrim and their surface paint above the mobile bottom navigation. A modal overlay SHALL NOT rely on an ad-hoc z-index that places it below navigation chrome. While such an overlay is open, the bottom navigation SHALL NOT be reachable by pointer, keyboard, or assistive-technology activation of its destinations, and the navigation's own state (active destination, badges) SHALL remain unchanged by taps that land on its area.

#### Scenario: Overlay above navigation chrome

- **WHEN** a modal dialog or sheet is open at a phone presentation with the bottom navigation visible
- **THEN** the overlay layer's computed stacking places the scrim and the surface above the navigation
- **AND** hit-testing a point inside the navigation's bounds resolves to the overlay, not to a navigation destination

#### Scenario: Navigation cannot change underneath an overlay

- **WHEN** the user taps a destination's position while a modal overlay is open
- **THEN** the active destination does not change, no tab is opened, and the overlay stays open

#### Scenario: Restored after dismissal

- **WHEN** the overlay is dismissed
- **THEN** the navigation accepts pointer input again and its position and state are unchanged

### Requirement: Compact modal surfaces keep their actions inside the visible viewport

On compact presentations, a modal dialog or sheet SHALL bound its height by the dynamic viewport (accounting for the on-screen keyboard) and SHALL apply safe-area insets to its edges. Its scrollable body SHALL contain its scrolling without chaining to the page beneath, and its footer actions SHALL remain within the visible viewport above the safe-area inset, each remaining the hit target at its own center point.

#### Scenario: Footer actions are not clipped by chrome

- **WHEN** a modal surface with footer actions is open at a phone presentation
- **THEN** every footer action's bounding box lies inside the visible viewport minus the safe-area insets
- **AND** clicking or tapping the center of each action activates that action

#### Scenario: Body scrolling does not move the page

- **WHEN** the user scrolls the dialog's content to its end
- **THEN** the surface's header and footer actions remain visible and the content beneath the overlay does not scroll

#### Scenario: Keyboard-resized viewport

- **WHEN** the on-screen keyboard reduces the visible viewport while a modal input is focused
- **THEN** the surface re-bounds to the reduced viewport and the focused input remains visible
