# mobile-bulk-selection-bar Specification

## Purpose
Defines the consolidated responsive and mobile presentation for multi-selection and bulk action toolbars across application surfaces, ensuring actions are thumb-accessible, never horizontally clipped, and cleanly positioned above mobile navigation.

## Requirements

### Requirement: Mobile Floating Dock Presentation
On mobile shell presentations (`isMobileShell` or phone viewports), when one or more items are selected in an item list surface (such as Documents, Queue, Extracts, Review, or Deck Manager), the bulk selection toolbar SHALL render as a floating bar docked near the bottom of the viewport rather than statically inline at the top of the content. The toolbar SHALL be positioned above the mobile bottom navigation bar with appropriate clearance (at least `calc(4.5rem + env(safe-area-inset-bottom, 0px))` when bottom navigation is visible).

#### Scenario: Selecting items on mobile displays floating bottom bar
- **WHEN** the user selects one or more items on a phone viewport
- **THEN** the bulk action toolbar appears floating near the bottom of the screen above the bottom navigation bar, remaining visible as the list scrolls.

#### Scenario: Clearing selection dismisses floating toolbar
- **WHEN** the user taps clear selection or deselects all items on mobile
- **THEN** the floating bulk action toolbar is dismissed.

### Requirement: Horizontal Overflow and Action Accessibility
The bulk action toolbar SHALL NOT allow action buttons to be cut off, truncated without access, or hidden beyond screen boundaries on narrow viewports (such as 360px–412px widths). The action buttons SHALL be contained within a single-row horizontally scrollable track with smooth touch scrolling (`overflow-x-auto touch-pan-x flex-nowrap`) and/or provide an explicit overflow affordance (a "More" / ⋯ button).

#### Scenario: Long action lists scroll horizontally on narrow screens
- **WHEN** the number of bulk actions exceeds the available viewport width on mobile
- **THEN** all actions remain accessible via smooth horizontal scrolling without vertical layout distortion or off-screen clipping.

#### Scenario: Overflow action sheet presents all actions
- **WHEN** the user taps the overflow affordance (⋯) on a surface with secondary bulk actions
- **THEN** a mobile bottom sheet opens displaying all available bulk actions with clear icons, labels, and accessible touch targets.

### Requirement: Compact Selection Count and One-Tap Dismissal
The selection summary in the bulk action toolbar SHALL display the count of selected items compactly without multi-line line breaks and SHALL provide a dedicated, accessible dismiss/clear button (✕) that clears all selected items in a single tap.

#### Scenario: Compact count display
- **WHEN** one or multiple items are selected on mobile
- **THEN** the count is displayed in a compact badge alongside a dismiss button without breaking across multiple vertical lines.

#### Scenario: One-tap selection clearing
- **WHEN** the user taps the dismiss button (✕) on the selection badge
- **THEN** the entire active selection is immediately cleared.

### Requirement: Desktop Presentation Preservation
When rendered on a desktop or wide viewport (`presentation: desktop`), the surface SHALL maintain its desktop layout without unwanted mobile bottom docking, preserving keyboard shortcuts and desktop aesthetics.

#### Scenario: Desktop selection bar layout
- **WHEN** the user selects items on a desktop viewport
- **THEN** the bulk selection controls render in their desktop-optimized layout without mobile bottom floating overlays.

### Requirement: Mobile Touch Target Accessibility
All action buttons within the mobile bulk selection toolbar and any associated bottom sheets SHALL provide an accessible touch target size of at least 40×40px on coarse pointer devices to ensure reliable thumb interaction.

#### Scenario: Touch target sizing on touch devices
- **WHEN** the bulk action bar is displayed on a device with a coarse pointer
- **THEN** each action button meets the minimum accessible touch hit target dimensions.
