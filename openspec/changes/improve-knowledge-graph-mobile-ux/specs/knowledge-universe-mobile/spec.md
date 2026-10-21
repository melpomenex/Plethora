## MODIFIED Requirements

### Requirement: Touch-Reachable Non-Overlapping Chrome
The system SHALL lay out the universe view's chrome on the mobile shell so that the top controls, breadcrumb trail, and floating zoom/reset controls do not overlap one another at narrow widths and remain fully within the workspace's usable canvas and safe-area insets. The top controls SHALL start below the page header and top safe-area inset and SHALL NOT paint beneath the status bar or page chrome.

#### Scenario: Narrow portrait layout
- **WHEN** the universe view renders in the mobile shell at a narrow viewport width
- **THEN** the search control SHALL be collapsed into an expandable icon, the breadcrumb SHALL render on its own row without overlapping other controls, and all controls SHALL remain tappable.

#### Scenario: Floating controls clear system bars
- **WHEN** the universe view renders on a device with bottom safe-area insets
- **THEN** the floating zoom and reset controls SHALL be offset above the safe-area inset and remain fully visible and tappable.

#### Scenario: Top controls clear the page chrome and status bar
- **WHEN** the universe view renders beneath the Knowledge Graph page header on a device with a top safe-area inset
- **THEN** the universe top bar, search control, and breadcrumb SHALL be positioned at or below the bottom of the page header, and the header SHALL be at or below the safe-area inset, applied once.

#### Scenario: Filter surface changes the usable canvas
- **WHEN** the Knowledge Graph filter surface opens or closes while the universe view is active
- **THEN** the universe canvas and its overlay controls SHALL reflow to the new usable area without overlapping the page chrome, the filter surface, or one another.
