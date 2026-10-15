## ADDED Requirements

### Requirement: Queue View has no Manual Browse mode

The Queue View SHALL NOT provide a Manual Browse toggle, an active browse mode, a browse-specific keyboard-navigation handler, or a browse control bar. The toolbar SHALL NOT render a "Manual Browse" button, and the list region SHALL NOT expose a `listbox` role, a focusable `tabIndex`, or a keydown handler whose purpose is browse-mode navigation.

#### Scenario: Toolbar renders without a Manual Browse toggle

- **WHEN** the Queue View renders with one or more queue items
- **THEN** the toolbar SHALL NOT contain a "Manual Browse" button or any equivalent browse-mode toggle
- **AND** the list region SHALL NOT have `role="listbox"`, SHALL NOT have a `tabIndex` enabling keyboard focus for browse navigation, and SHALL NOT bind a keydown handler that moves a browse selection

#### Scenario: No browse control bar or conditional hint

- **WHEN** the Queue View renders in any state (populated, empty, filtered, or multi-select)
- **THEN** the UI SHALL NOT render a "Browsing N / M" position indicator, Prev/Next/Open-Selected browse controls, or a hint whose copy toggles on a manual-browse flag

### Requirement: Queue items are activated by direct interaction

The Queue View SHALL activate (open or play) queue items via the item's primary pointer/click interaction. There SHALL be no secondary keyboard-driven browse-and-activate pathway and no "Open Selected" action bound to a browse selection. Each item remains directly activatable on its own row.

#### Scenario: Activating an item

- **WHEN** the user triggers an item's primary activation affordance (pointer click / tap on the row's open control)
- **THEN** the system SHALL open or play that specific item via the existing queue activation behavior (`onStartReview` / `onOpenDocument`)
- **AND** no browse-selection state SHALL gate or redirect the activation

#### Scenario: No keyboard browse-and-activate

- **WHEN** focus is within the Queue View list region and the user presses Arrow keys, J/K, Home, End, or Enter
- **THEN** the system SHALL NOT move a persistent browse selection, SHALL NOT open the "selected" item via Enter, and these keys SHALL fall through to default behavior

### Requirement: Shared item selection is preserved for the inspector

Removal of Manual Browse SHALL NOT remove the shared item-selection plumbing (`selectedId`, its reconciliation effects, and the `data-queue-item-id` row attributes) because those continue to drive the inspector pane. Only the manual-browse-only consumers of that selection SHALL be removed.

#### Scenario: Inspector selection continues to work after removal

- **WHEN** an item is selected in the Queue View by any remaining selection path
- **THEN** the inspector pane SHALL continue to resolve and display details for that item
- **AND** the `selectedId` / reconciliation / `data-queue-item-id` plumbing SHALL remain in place to support it

## REMOVED Requirements

### Requirement: Manual Queue Browsing in Queue View
**Reason**: The Manual Browse toggle and its persistent keyboard-driven browse mode are unused and add toolbar chrome; the queue is already fully navigable via direct item activation. Removed outright per the remove-manual-browse-button change.
**Migration**: No data migration — browse mode was component-local state and nothing is persisted. Users navigate by clicking items as before. Keyboard-driven browse-and-activate is gone; if keyboard navigation is wanted later it will be reintroduced as a separate change.

### Requirement: Keyboard and Pointer Browse Navigation
**Reason**: The dedicated keyboard navigation (Arrow/J/K/Home/End moving a browse selection) existed only to feed Manual Browse and has no remaining consumer once the toggle is removed.
**Migration**: Pointer/click selection and activation of individual items remains. There is no replacement keyboard-browse pathway.

### Requirement: Activate Selected Queue Item
**Reason**: "Activate the currently selected item" was the Manual Browse activation pathway (the Enter key and the "Open Selected" control-bar button). With browse mode removed there is no persistent browse selection to activate.
**Migration**: Items are activated directly from their own row via the existing open/play affordance.

### Requirement: Selection Continuity During Queue Updates
**Reason**: This requirement governed the browse selection's continuity across refreshes. Its reconciliation effect remains in code (Decision 2 of the change's design) to serve the inspector pane, but the normative browse-selection contract is withdrawn because there is no user-facing browse selection anymore.
**Migration**: None — the underlying reconciliation continues to run transparently for the inspector; no user-facing behavior change beyond the removal of browse mode itself.
