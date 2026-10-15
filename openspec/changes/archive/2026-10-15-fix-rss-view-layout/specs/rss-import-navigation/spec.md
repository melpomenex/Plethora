## ADDED Requirements

### Requirement: RSS Sidebar Toolbar Stays Within Sidebar Bounds
On desktop (`lg:` breakpoint and above), the RSS sidebar header toolbar — containing the Add Feed, Import by URL, Newsletter Directory, Scroll Mode, Select Mode, Refresh All, and Options buttons — SHALL be constrained so its full content remains within the sidebar's configured width (`lg:w-72`) and SHALL NOT overflow or spill into the adjacent items-list or article pane.

#### Scenario: Many toolbar buttons rendered in a narrow sidebar
- **WHEN** the RSS view is displayed at desktop width (`lg:` breakpoint and above) and all sidebar header toolbar buttons (Add, Import URL, Newsletter, Scroll, Select, Refresh, Options) are rendered
- **THEN** the toolbar content SHALL remain within the horizontal bounds of the `lg:w-72` sidebar with no portion overlapping or spilling into the items-list pane or article pane next to it

#### Scenario: Toolbar width constrained when sidebar has a fixed basis
- **WHEN** the sidebar is sized to its `lg:w-72` flex basis and the toolbar's intrinsic content width would exceed that basis
- **THEN** the sidebar column SHALL allow flexbox to clamp its width (via `min-w-0`) and the toolbar SHALL wrap or clip within the sidebar rather than expanding the column

### Requirement: RSS Feed List Scrolls Vertically
The RSS sidebar feed list SHALL scroll vertically when the number of feeds exceeds the available sidebar height, so that all feeds remain reachable regardless of how many are subscribed.

#### Scenario: Feed list taller than sidebar viewport
- **WHEN** the user has subscribed to more feeds than fit vertically in the visible sidebar height on desktop
- **THEN** the feed list region SHALL become vertically scrollable (`overflow-y-auto`) and the user SHALL be able to scroll to reach feeds below the fold without the header toolbar or filter controls scrolling away

#### Scenario: Bounded height propagated to feed list
- **WHEN** the RSS view is rendered on desktop inside a sized parent container
- **THEN** the layout chain from the outer container down through the sidebar column to the feed list SHALL propagate a bounded height (via `min-h-0` and `flex-col`) so that the feed list's `flex-1 overflow-y-auto` region engages scrolling rather than collapsing or overflowing the viewport
