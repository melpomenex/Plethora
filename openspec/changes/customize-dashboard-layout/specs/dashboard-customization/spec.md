# dashboard-customization Specification

## Purpose
Allow users to configure which sections and Quick Actions appear on the Dashboard and in what order, persisting preferences locally across sessions and tabs.

## ADDED Requirements

### Requirement: Dashboard Layout Persistence and Normalization
The application SHALL persist Dashboard section order, hidden sections, Quick Action order, and hidden Quick Actions in `localStorage` under `plethora_dashboard_layout_v1` and normalize malformed or partial payloads safely.

#### Scenario: Missing or malformed storage falls back to defaults
- **WHEN** `localStorage` has no layout entry or contains invalid JSON / unknown IDs
- **THEN** the store initializes with the default 9 sections and 8 Quick Actions, all visible
- **AND** any unknown or duplicate IDs are ignored while missing default IDs are appended in default order

#### Scenario: Cross-tab storage synchronization
- **WHEN** a `storage` event fires for `plethora_dashboard_layout_v1`
- **THEN** `useDashboardLayoutStore` reloads the updated layout from `localStorage`

### Requirement: Inline Dashboard Customize Mode
Users SHALL be able to enter and exit an inline Customize mode on the Dashboard via the header Customize button or the surface context menu.

#### Scenario: Entering and exiting Customize mode
- **WHEN** the user activates the `Customize` button in the Dashboard header (or `Customize dashboard` from the surface context menu)
- **THEN** the Dashboard enters Customize mode, displaying `Done` and `Reset to default` actions in the header
- **WHEN** the user activates `Done` or presses `Escape`
- **THEN** Customize mode exits and normal Dashboard rendering resumes

### Requirement: Section Reordering and Visibility
In Customize mode, users SHALL be able to reorder any Dashboard section and toggle its visibility, with changes reflected immediately and persisted.

#### Scenario: Reordering sections updates Dashboard order
- **WHEN** the user moves a section up or down (via move buttons or drag-and-drop)
- **THEN** the section moves to the new position in `sectionOrder`, persists to `localStorage`, and renders in that order in normal mode

#### Scenario: Hiding a section omits it in normal mode
- **WHEN** the user toggles a section's visibility switch off
- **THEN** in Customize mode the section remains visible as a collapsed control bar with a `Hidden` indicator so it can be re-enabled or reordered
- **AND** in normal mode the hidden section is not rendered

#### Scenario: Hiding all sections shows recovery empty state
- **WHEN** all Dashboard sections are hidden in normal mode
- **THEN** the Dashboard displays a recovery empty state with actions to customize the Dashboard or restore defaults

### Requirement: Quick Actions Reordering and Visibility
In Customize mode, users SHALL be able to toggle individual Quick Action tiles and reorder them.

#### Scenario: Hiding and reordering Quick Actions
- **WHEN** the user hides a Quick Action tile or moves it left/right in Customize mode
- **THEN** in normal mode only visible Quick Action tiles render, in the user's configured order

### Requirement: Reset to Default Layout
Users SHALL be able to restore the default Dashboard section order, Quick Action order, and visibility with a single action.

#### Scenario: Resetting to default
- **WHEN** the user activates `Reset to default` in Customize mode
- **THEN** all sections and Quick Actions are restored to their default order and visibility
