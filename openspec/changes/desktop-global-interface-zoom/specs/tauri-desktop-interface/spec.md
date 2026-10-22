## MODIFIED Requirements

### Requirement: Compact window remains usable
The main Tauri window SHALL enforce a tested minimum usable size no greater than 760 by 560 CSS pixels at 100% interface zoom. At that configured minimum window size, and at the maximum supported interface zoom of 150%, the user MUST be able to navigate, access the command/search surface, interact with the active tab, and reach overflowed toolbar actions without page-level two-axis scrolling. When interface zoom reduces the effective CSS viewport below the 760 by 560 CSS-pixel compact target, secondary panes SHALL collapse, scroll, or move into an existing drawer or sequential presentation rather than compressing the primary pane below its usable width. Essential controls and dialogs MUST remain reachable at every supported zoom level.

#### Scenario: Window reaches minimum size
- **WHEN** the user resizes the main window to the configured minimum dimensions at 100% interface zoom
- **THEN** core navigation, the active content header, and an overflow path for non-primary actions remain visible and operable

#### Scenario: Minimum window at maximum zoom
- **WHEN** the main window is at the configured minimum dimensions and interface zoom is 150%
- **THEN** core navigation, search/command access, active primary content, and overflow actions remain operable
- **AND** the page does not require simultaneous horizontal and vertical page-level scrolling
- **AND** dialogs and overlays remain inside the visible viewport

#### Scenario: Active feature normally uses multiple panes
- **WHEN** a multi-pane feature is viewed in a compact desktop window
- **THEN** secondary panes collapse into a drawer, inspector, or sequential view rather than compressing the primary pane below its usable width

#### Scenario: Split view at increased zoom
- **WHEN** interface zoom increases while a split view is open
- **THEN** secondary panes remain reachable through the existing collapse/drawer/sequential behavior
- **AND** the active reading or review surface is not clipped
