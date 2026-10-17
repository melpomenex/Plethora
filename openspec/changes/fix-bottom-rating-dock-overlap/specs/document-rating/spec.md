## MODIFIED Requirements

### Requirement: Relocatable and Persisted Rating Controls
The system SHALL support relocatable rating controls in the queue view, allowing the user to position the rating container on any edge of the viewport (top, bottom, left, right), snap it, and persist this setting across sessions. A settled bottom dock SHALL remain fully above visible bottom navigation and the closed Assistant bubble, with at least 8 CSS pixels between their interactive bounds. Automatic clearance adjustments SHALL NOT change the saved edge preference.

#### Scenario: User drags the rating container to snap to an edge
- **WHEN** the user drags the rating panel and releases it near an edge of the viewport
- **THEN** the system SHALL calculate the nearest edge (top, bottom, left, or right) and snap the panel to it
- **AND** the system SHALL dynamically update the layout (vertical stack for left/right edges, horizontal ratings for top/bottom edges)
- **AND** the system SHALL save the new position to settings
- **AND** a bottom snap SHALL resolve to a position clear of the Assistant bubble and navigation

#### Scenario: User changes rating controls position using directional UI controls
- **WHEN** the user selects a different position (top, bottom, left, or right) from the placement buttons on the panel or settings
- **THEN** the system SHALL immediately reposition the panel to that edge and update the layout and settings
- **AND** bottom placement SHALL apply the same clearance as drag-to-snap

#### Scenario: Rating controls position is persisted across sessions
- **WHEN** the user opens the queue view in a new session
- **THEN** the rating controls SHALL be initialized at the last saved edge position
- **AND** a saved bottom position SHALL use the current viewport and visible controls to establish clearance before the dock becomes interactive

#### Scenario: Bottom dock and Assistant are visible together
- **WHEN** bottom-docked rating controls and the closed Assistant bubble are visible on a mobile queue reading surface
- **THEN** the entire dock SHALL sit at least 8 CSS pixels above the bubble's interactive bounds
- **AND** each rating and the Assistant bubble SHALL be fully tappable without activating the other
- **AND** the bubble and navigation SHALL retain their established positions

#### Scenario: Visible bottom controls or viewport change
- **WHEN** navigation or the Assistant bubble appears, disappears, resizes, or moves, or the visible viewport or safe area changes
- **THEN** the bottom dock SHALL update its clearance to match the current visible controls
- **AND** hidden controls SHALL NOT reserve space
- **AND** the saved edge preference SHALL remain unchanged

## ADDED Requirements

### Requirement: Responsive and Accessible Rating Dock
The system SHALL keep all currently applicable rating actions and placement controls reachable within the visible viewport. On touch devices, interactive targets SHALL be at least 44 by 44 CSS pixels. The dock SHALL preserve rating order, distinct icons, accessible action names, and visible keyboard focus at narrow widths and enlarged text sizes.

#### Scenario: Narrow phone viewport
- **WHEN** a bottom rating dock is shown in a viewport 320 CSS pixels wide
- **THEN** all applicable rating actions SHALL fit without horizontal viewport overflow
- **AND** positioning utilities SHALL reflow to a secondary row if they cannot fit alongside the ratings
- **AND** no rating SHALL be removed or reduced below the minimum touch target

#### Scenario: Limited vertical space
- **WHEN** the visible viewport cannot accommodate the dock's full height between upper reader controls and the reserved bottom region
- **THEN** the dock SHALL constrain its height and allow its contents to scroll without covering those reserved controls
- **AND** every rating and placement control SHALL remain reachable through touch and keyboard navigation

#### Scenario: Assistant sheet is open
- **WHEN** the Assistant sheet is open over a queue reading surface
- **THEN** rating controls SHALL remain behind the sheet and unavailable to pointer and keyboard interaction until the sheet closes
- **AND** closing the sheet SHALL restore the dock with clearance for the reappearing Assistant bubble

### Requirement: Theme-Aware Rating Orbs
The system SHALL style rating orbs and their dock, placement menu, tooltips, borders, and interaction states using the active theme's surface, foreground, and semantic accent roles. The same rating action SHALL use the same visual treatment in Scroll Mode and the inline queue reader. Theme changes SHALL update these controls without a reload or resetting queue state. Grade identity SHALL remain recognizable through icons, order, and accessible names independently of color.

#### Scenario: Active theme changes
- **WHEN** the user switches between light, dark, or custom themes while rating orbs are visible
- **THEN** orb and dock colors SHALL update to the selected theme
- **AND** the placement menu, tooltips, hover, pressed, disabled, and focus states SHALL use that theme
- **AND** the current item, saved dock edge, and rating behavior SHALL remain unchanged

#### Scenario: Rating identity across surfaces and variants
- **WHEN** the same rating action is presented in Scroll Mode or the inline queue reader
- **THEN** it SHALL use consistent theme roles and retain its existing icon and meaning
- **AND** mark-as-read SHALL share the Good action treatment and dismiss SHALL use a neutral theme treatment
- **AND** the currently applicable action set, shortcuts, and haptic feedback SHALL remain unchanged

#### Scenario: Readable themed controls
- **WHEN** rating controls are rendered in a supported light, dark, custom, or monochrome presentation
- **THEN** normal-size text SHALL have at least 4.5:1 contrast against its resolved background
- **AND** action icons and focus indicators SHALL have at least 3:1 contrast against adjacent colors
- **AND** actions SHALL remain identifiable without depending on different hues
- **AND** disabled controls SHALL remain visibly distinct and non-interactive
