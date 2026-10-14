## Purpose

Keep the desktop Dashboard reachable when tabs have been closed or a saved workspace lacks it, while preserving the user's restored work and startup preference.

## ADDED Requirements

### Requirement: Dashboard can be opened from an empty desktop workspace

The desktop application SHALL provide a working Open Dashboard action when no tabs are open. Activating it SHALL display and select a Dashboard tab without restarting the app.

#### Scenario: Open Dashboard after the final tab is closed
- **WHEN** the desktop workspace has no open tabs and the user activates Open Dashboard in the empty workspace
- **THEN** one Dashboard tab is visible and active with its content rendered

### Requirement: Desktop Dashboard navigation recovers a missing tab

The desktop Dashboard toolbar action and existing Dashboard keyboard navigation SHALL create and activate a Dashboard tab when absent. Repeated Dashboard navigation SHALL activate the existing instance, including when it belongs to another split pane, without duplicating it or removing other tabs.

#### Scenario: Open Dashboard from Queue only
- **WHEN** Queue is the only open tab and the user activates the desktop Dashboard toolbar action
- **THEN** Dashboard is created and displayed while Queue remains open

#### Scenario: Repeat Dashboard navigation
- **WHEN** the user invokes Dashboard navigation repeatedly, including through the existing Dashboard shortcut
- **THEN** exactly one Dashboard tab exists and is active

#### Scenario: Dashboard exists in another pane
- **WHEN** Dashboard is open in one split pane and the user invokes Dashboard navigation while another pane has focus
- **THEN** the existing Dashboard is activated in its containing pane and the split layout and other tabs are preserved

#### Scenario: Saved Dashboard has no containing pane
- **WHEN** Dashboard exists in the saved tab list but no pane contains its ID
- **THEN** restoration repairs its pane membership while preserving Default View focus
- **AND** invoking Dashboard navigation selects and renders that same Dashboard without duplication

#### Scenario: Collapse the split containing Dashboard
- **WHEN** the user collapses a pane containing Dashboard or other open tabs
- **THEN** those tabs remain reachable in a surviving pane with their IDs and data preserved
- **AND** the surviving pane retains its active tab until the user selects another tab

### Requirement: Desktop startup restores a missing Dashboard base tab

When desktop startup restores a workspace without Dashboard, the application SHALL make one Dashboard base tab available alongside the restored tabs. It SHALL preserve existing tab identities and split layout and SHALL apply the configured Default View as the startup focus. An empty saved session SHALL also produce a usable workspace with Dashboard available.

#### Scenario: Relaunch with a Queue-only saved session
- **WHEN** the user relaunches the desktop application with session restoration enabled, a Queue-only saved workspace, and Default View set to Queue
- **THEN** Dashboard and the restored Queue are available, Queue is focused, and Dashboard can be selected and rendered

#### Scenario: Restore a split workspace without Dashboard
- **WHEN** desktop startup restores a split workspace lacking Dashboard
- **THEN** Dashboard becomes available without discarding restored tabs or collapsing their split layout, and the configured Default View is focused

#### Scenario: Relaunch after saving an empty workspace
- **WHEN** the desktop application starts with an empty saved workspace
- **THEN** Dashboard is available and can be displayed, and the configured Default View is focused

#### Scenario: Navigation occurs while session restoration is pending
- **WHEN** the user opens a tab while desktop session restoration is pending
- **THEN** startup recovery preserves that tab, provides exactly one Dashboard, and leaves the workspace usable

### Requirement: Recovered Dashboard retains the desktop base-tab policy

A desktop Dashboard created, reopened, or restored from an older saved session SHALL use the current non-closable base-tab behavior. Close All Tabs SHALL retain Dashboard when it is present. The recovered Dashboard SHALL remain available after the workspace is saved and the application is relaunched.

#### Scenario: Restore a legacy closable Dashboard
- **WHEN** desktop startup restores a Dashboard saved with a closable policy and the user invokes Close All Tabs
- **THEN** Dashboard remains available as the non-closable base tab

#### Scenario: Recovery survives a subsequent launch
- **WHEN** Dashboard is recovered from a workspace that lacked it, the workspace is saved, and the desktop application is relaunched
- **THEN** one Dashboard is available without duplication and can be selected and rendered
