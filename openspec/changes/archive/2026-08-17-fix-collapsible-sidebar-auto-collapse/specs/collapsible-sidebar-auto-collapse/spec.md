## ADDED Requirements

### Requirement: Toolbar collapses on pointer leave after button interaction
The collapsible toolbar rail SHALL collapse back to its collapsed (icon-only) state after the pointer leaves the rail, even if a toolbar button was previously clicked or received focus.

#### Scenario: Pointer leaves toolbar rail after button click
- **WHEN** the user hovers over the toolbar rail, clicks a toolbar button (e.g., Settings or Dashboard), and moves the pointer away into the content area
- **THEN** the toolbar rail collapses back to its collapsed icon-only width after the close delay

#### Scenario: Pointer leaves toolbar rail without click
- **WHEN** the user hovers over the toolbar rail so it expands, and then moves the pointer away
- **THEN** the toolbar rail collapses back to its collapsed icon-only width after the close delay

### Requirement: Toolbar auto-collapses on tab and view navigation
The collapsible toolbar rail SHALL collapse immediately whenever the active tab or view changes in the application.

#### Scenario: Navigating to Settings or switching tabs
- **WHEN** a new tab is activated (e.g., SettingsTab, ReviewTab, or DocumentViewer) via toolbar click, keyboard shortcut, or command palette
- **THEN** any expanded toolbar rail collapses and does not remain stuck open over the newly activated view

### Requirement: Toolbar collapses on outside interaction
The collapsible toolbar rail SHALL collapse when the user clicks or interacts with the page outside the toolbar rail.

#### Scenario: Clicking outside expanded toolbar rail
- **WHEN** the toolbar rail is expanded and the user clicks on the main view or document area outside the toolbar
- **THEN** the toolbar rail collapses

### Requirement: Keyboard navigation maintains accessibility
The collapsible toolbar rail SHALL support accessible keyboard navigation: expanding immediately upon keyboard focus entry, staying expanded while navigating between toolbar controls, and collapsing when focus moves outside the toolbar.

#### Scenario: Keyboard tabbing into and out of toolbar
- **WHEN** a user tabs into a toolbar button from outside
- **THEN** the toolbar rail expands immediately
- **WHEN** the user tabs between buttons inside the toolbar
- **THEN** the toolbar rail remains expanded
- **WHEN** the user tabs out of the toolbar to an external element
- **THEN** the toolbar rail collapses
