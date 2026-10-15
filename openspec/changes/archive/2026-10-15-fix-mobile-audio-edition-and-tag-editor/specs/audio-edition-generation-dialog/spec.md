## Purpose

Provides a responsive, scrollable, and stacking-context-isolated modal dialog for configuring and initiating document audio edition generation across mobile and desktop devices.

## ADDED Requirements

### Requirement: Dialog Viewport Containment and Top-Level Portaling
The system SHALL render the Audio Edition creation dialog through a top-level DOM portal into document.body, positioned above all application layout chrome including the mobile bottom navigation bar with a high z-index (z-50 or higher). The dialog backdrop overlay SHALL allow vertical scrolling when viewport height is constrained.

#### Scenario: Mobile viewport presentation
- **WHEN** the user triggers "Create Audio Edition" on a mobile device or compact viewport
- **THEN** the dialog renders centered within visible viewport bounds, does not draw off-screen beyond unreachable coordinates, and is not covered by the mobile bottom navigation bar

### Requirement: Touch and Vertical Scrollability
The Audio Edition creation dialog body SHALL enforce flex shrink constraints (`min-h-0`) and vertical overflow scrolling (`overflow-y-auto`) so that all configuration controls, voice auditioning, cost summaries, and submission buttons can be scrolled into view on small screens.

#### Scenario: Scrolling dialog content on compact screens
- **WHEN** the rendered dialog content height exceeds the available viewport height
- **THEN** the internal dialog content area scrolls vertically, allowing the user to reach all voice settings, toggles, and action buttons

### Requirement: Document Context Menu Invocation
The Documents library view SHALL expose the "Create Audio Edition" option for eligible non-audio documents across both list view and grid card context menus triggered by right-click or long-press.

#### Scenario: Long-press trigger in grid view
- **WHEN** the user performs a long-press on a document card in grid view
- **THEN** the context menu displays a "Create Audio Edition" option that opens the creation dialog for that document
