# Study Mode Workspace Specification

## ADDED Requirements

### Requirement: Unified 4-Tab Primary Navigation
Study Mode SHALL organize all study tools into exactly 4 primary tabs: `Learn`, `Practice`, `Explore`, and `Progress`.

#### Scenario: Primary tabs expose consolidated tools
- **GIVEN** a learner opens Study Mode on any supported source
- **WHEN** the workspace renders
- **THEN** the tab bar displays `Learn`, `Practice`, `Explore`, and `Progress`
- **AND** legacy separate tabs (`Source`, `Mind Map`, `Audio`, `Slides`) are consolidated into the always-visible Source pane and the `Explore` tab.

### Requirement: Desktop 3-Pane Source-Centric Layout
On desktop viewports, Study Mode SHALL present a 3-pane layout with a collapsible, resizable **Learning Path** (left), an always-accessible **Original Source** (center), and **Contextual Study Tools** (right), while leaving ordinary Read Mode 100% untouched when Study Mode is closed.

#### Scenario: Collapsing and resizing panes preserves source accessibility
- **GIVEN** Study Mode is open on a desktop viewport
- **WHEN** the learner collapses the Learning Path pane or drags a resize handle
- **THEN** the Original Source pane remains visible and readable alongside the active Study Tools
- **AND** exiting Study Mode returns to ordinary Read Mode with zero layout or scroll regression.

### Requirement: Focus Mode, Selection-Based Studying, Keyboard Shortcuts, and Session Duration
Study Mode SHALL provide a Focus Mode toggle that hides non-essential chrome, selection-based studying ("Study this") on highlighted source text, keyboard shortcuts for core navigation/actions, a session duration selector (`5`, `15`, or `30` min), and full Plethora semantic theme token integration.

#### Scenario: Highlighting text triggers selection-based studying
- **GIVEN** a learner is viewing the Original Source pane in Study Mode
- **WHEN** the learner selects a text passage and activates "Study this"
- **THEN** Study Mode scopes to that selection (updating the scope key and showing a clear selection scope badge with an option to return to full passage).

#### Scenario: Keyboard shortcuts navigate tabs and toggle Focus Mode
- **GIVEN** focus is inside Study Mode (outside a text input)
- **WHEN** the learner presses `Alt+1` through `Alt+4` or `Alt+F`
- **THEN** the active tab switches to `Learn`, `Practice`, `Explore`, or `Progress`, or Focus Mode toggles accordingly.

### Requirement: Responsive Mobile Layout with Bottom-Sheet Study Tools
On mobile/narrow viewports, Study Mode SHALL display a full-screen primary learning view with Study Tools accessible in a toggleable bottom sheet.

#### Scenario: Mobile viewport uses bottom-sheet study tools
- **GIVEN** Study Mode is rendered in mobile layout mode
- **WHEN** the learner views the workspace
- **THEN** the primary source/learning content occupies full width and the study tools drawer can be opened and collapsed as a bottom sheet without horizontal overflow.
