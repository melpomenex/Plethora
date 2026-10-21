## Purpose

The Knowledge Graph and its Universe view are spatial surfaces: the canvas is the content, and filters are an instrument for looking at it. This capability defines how that workspace adapts its chrome and filter surface to the available width, keeps active filtering legible when the surface is closed, and guarantees the canvas and its controls stay inside the usable, safe-area-aware viewport.

## ADDED Requirements

### Requirement: Responsive filter surface
The system SHALL present the Knowledge Graph filter controls in a surface appropriate to the available width: a dismissible bottom sheet over the canvas on phone and portrait-tablet presentation modes, and a docked sidebar on wide layouts.

#### Scenario: Phone opens with the canvas unobstructed
- **WHEN** the Knowledge Graph opens in the mobile shell
- **THEN** the filter surface SHALL be closed, the canvas SHALL occupy the full content width, and the Filters control SHALL be visible in the page chrome

#### Scenario: Opening the sheet on a phone
- **WHEN** the user activates the Filters control on a phone
- **THEN** the filter controls SHALL open in a sheet anchored to the bottom of the visible viewport, within safe-area insets and above the bottom navigation in stacking order, with a visible close affordance and a scrim separating it from the canvas

#### Scenario: Closing the sheet
- **WHEN** the user activates the close affordance, taps the scrim, or presses Escape
- **THEN** the sheet SHALL close, the canvas SHALL return to full width, previously applied filters SHALL remain active, and focus SHALL return to the Filters control

#### Scenario: Docked sidebar on a wide layout
- **WHEN** the Knowledge Graph renders on a desktop or wide-tablet layout
- **THEN** the filter controls SHALL be docked beside the canvas and SHALL NOT cover it

### Requirement: Single filter-surface control
The system SHALL expose exactly one control that expands and collapses the filter surface, and its expanded state SHALL be reflected programmatically. The docked sidebar SHALL persist its state; the phone sheet SHALL remain transient.

#### Scenario: No duplicate collapse affordances
- **WHEN** the filter surface is open
- **THEN** the page SHALL show one Filters control whose `aria-expanded` state is true and whose expanded state can be toggled from that control, and the filter panel SHALL NOT contain a second independent collapse toggle

#### Scenario: State survives navigation
- **WHEN** the user collapses or expands the docked sidebar, leaves the Knowledge Graph tab, and returns on a wide layout
- **THEN** the sidebar SHALL reopen in the state the user last chose

#### Scenario: Sheet stays transient on phones
- **WHEN** the user opens and closes the filter sheet on a phone, leaves the Knowledge Graph tab, and returns
- **THEN** the sheet SHALL start closed, and any active filters SHALL remain applied and visible in the active-filter summary

### Requirement: Live filtering feedback
The system SHALL apply filter changes immediately and expose the resulting visible-node count while the filter surface is open, including a zero-result state with a reset action.

#### Scenario: Count updates as filters change
- **WHEN** the user changes a node type, category, tag, or search query while the sheet or sidebar is open
- **THEN** the visible-node count SHALL update immediately, the canvas SHALL re-render behind the surface, and the sheet footer SHALL offer an action labeled with the current visible-node count

#### Scenario: Zero results are recoverable
- **WHEN** the active filters match no nodes
- **THEN** the filter surface SHALL show a zero-result message and a Reset control that clears all filters in one action

#### Scenario: Filter semantics are unchanged
- **WHEN** search, node-type, category, and tag filters are combined
- **THEN** the visible node and edge sets SHALL be identical to the existing filter semantics, including the existing select-all and clear-all behavior

### Requirement: Active filter summary while closed
The system SHALL keep active filtering visible and reversible when the filter surface is closed.

#### Scenario: Summary chips for active filters
- **WHEN** the filter surface is closed and at least one filter is active
- **THEN** the page SHALL show a compact summary of active filters, including removable entries for excluded node types, selected categories, selected tags, and the active search term, plus a Clear all action

#### Scenario: Removing a filter from the summary
- **WHEN** the user removes one summary entry
- **THEN** only that filter SHALL be cleared, the canvas and visible-node count SHALL update immediately, and the remaining entries SHALL stay visible

#### Scenario: No filters, no summary
- **WHEN** no filters are active
- **THEN** the summary SHALL be absent and the Filters control SHALL NOT show an active-count badge

### Requirement: Responsive page chrome without clipping
The Knowledge Graph page chrome SHALL fit the available width without overlapping, wrapping the title, clipping content, or hiding primary actions.

#### Scenario: Narrow phone width
- **WHEN** the page renders at a 320px-wide viewport
- **THEN** the title and visible/total count, the Graph/Universe switch, the Filters control with its active-count badge, and an overflow action menu SHALL all be reachable and non-overlapping, and the title SHALL truncate rather than wrap into the header's clip area

#### Scenario: Wide layout keeps direct actions
- **WHEN** the page renders on a wide layout
- **THEN** the inline search and export actions SHALL remain directly available without opening the overflow menu

#### Scenario: Header grows with content
- **WHEN** the page chrome's content is taller than its minimum height (for example, larger text settings)
- **THEN** the header SHALL grow to contain its content rather than clipping it

### Requirement: Canvas containment and safe areas
The graph and Universe canvases SHALL fill only the usable content area and SHALL NOT paint beneath the page chrome, the status bar, or the bottom navigation.

#### Scenario: Canvas starts below the chrome
- **WHEN** the page renders on a device with a top safe-area inset
- **THEN** the top of the canvas SHALL be at or below the bottom of the page header, and the header SHALL be at or below the safe-area inset, applied once

#### Scenario: Resize and orientation changes
- **WHEN** the viewport resizes, rotates, or the filter surface opens or closes
- **THEN** the canvas SHALL resize to the new usable area and re-fit or preserve its current viewport without clipping nodes or losing the selected node

#### Scenario: Floating controls stay reachable
- **WHEN** the graph is rendered on a device with bottom or side safe-area insets
- **THEN** the zoom, fit, minimap, and settings controls SHALL remain fully visible and tappable within the insets

### Requirement: Filter surface accessibility
The filter surface SHALL be operable by keyboard and assistive technology.

#### Scenario: Keyboard operation
- **WHEN** the user focuses the Filters control and activates it with Enter or Space
- **THEN** the surface SHALL open, focus SHALL move inside it, and Escape SHALL close it and return focus to the Filters control

#### Scenario: Announced result changes
- **WHEN** the visible-node count changes because of a filter action
- **THEN** the count SHALL be exposed in a polite live region without stealing focus

#### Scenario: Touch targets
- **WHEN** filter rows, chips, and sheet actions are rendered in the mobile shell
- **THEN** each interactive target SHALL be at least 44px along its smallest dimension
