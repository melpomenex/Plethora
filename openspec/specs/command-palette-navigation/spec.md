# command-palette-navigation Specification

## Purpose
The command palette currently resolves and opens documents but does not let users jump directly to core app sections like Settings. Adding section navigation reduces clicks and makes the palette a single, fast navigation surface.

## Requirements

### Requirement: Command Palette Surfaces App Sections
The command palette SHALL return app section entries as searchable results alongside document results.

#### Scenario: Query matches a section label
- **WHEN** the user types a query that matches a configured app section label (for example, "settings")
- **THEN** the command palette includes that app section in the result list

#### Scenario: Query matches a section alias
- **WHEN** the user types a query that matches a configured app section alias
- **THEN** the command palette includes the mapped app section in the result list

### Requirement: Unified Keyboard Selection Across Result Types
The command palette SHALL support arrow-key navigation and Enter activation across a mixed result list containing documents and app sections.

#### Scenario: Move highlight through mixed results
- **WHEN** the result list contains both document and app section entries and the user presses ArrowUp or ArrowDown
- **THEN** the highlighted selection moves predictably through the unified list without skipping valid entries

#### Scenario: Activate highlighted section result
- **WHEN** an app section entry is highlighted and the user presses Enter
- **THEN** the command palette activates that app section entry

### Requirement: Selecting a Section Opens Its Target App Area
Selecting an app section result from the command palette MUST navigate the user to that section's target area in the app.

#### Scenario: Open section from mouse selection
- **WHEN** the user clicks an app section result in the command palette
- **THEN** the app navigates to the target section associated with that result

#### Scenario: Open section from keyboard selection
- **WHEN** the user activates a highlighted app section result using Enter
- **THEN** the app navigates to the same target section associated with that result

### Requirement: Existing Document Open Behavior Is Preserved
Adding app section results MUST NOT change existing document selection and open behavior.

#### Scenario: Open document with keyboard after feature addition
- **WHEN** the user highlights a document result and presses Enter
- **THEN** the app opens that document using the existing document-open flow

#### Scenario: Open document with pointer after feature addition
- **WHEN** the user selects a document result with the pointer
- **THEN** the app opens that document exactly as before section support was added

### Requirement: Advertised commands have supported observable outcomes

Every command advertised in Actions, View All, or search SHALL lead to its described navigation, dialog, operation, or actionable setup state. Unsupported platform commands SHALL be omitted. The palette SHALL show only one command for the same user intent and scope when multiple platform implementations exist.

#### Scenario: One supported recording action
- **WHEN** the user opens Actions on a platform supporting lecture capture
- **THEN** exactly one Record Lecture command is shown for that intent
- **AND** activating it opens or controls the supported recording flow

#### Scenario: Unsupported recording platform
- **WHEN** the platform has no supported lecture capture implementation
- **THEN** the palette does not advertise Record Lecture

#### Scenario: Required configuration is missing
- **WHEN** the user invokes a supported command that needs recoverable setup
- **THEN** the app opens the relevant setup or shows an actionable explanation
- **AND** it does not silently close as though the operation succeeded

### Requirement: Destination actions survive navigation and view loading

Commands that navigate and open a destination action SHALL deliver that action after the destination is ready, independent of rendering or data-loading speed. Each invocation SHALL execute at most once in the targeted active pane. Requests abandoned by navigation or target closure SHALL NOT execute on a later unrelated visit.

#### Scenario: Destination loads slowly
- **WHEN** the user invokes a destination command and its view takes longer than 150 milliseconds to mount
- **THEN** the requested dialog or operation opens once after the destination is ready

#### Scenario: Destination already open
- **WHEN** the user invokes the command while its destination is already active
- **THEN** its requested operation executes once without requiring a route change

#### Scenario: Another pane has the same destination
- **WHEN** the command targets a pane while another pane has an equivalent mounted view
- **THEN** only the targeted active pane performs the operation

#### Scenario: User abandons the destination
- **WHEN** the user navigates elsewhere before a pending destination action can execute
- **THEN** that request is cancelled
- **AND** revisiting the destination does not replay it

### Requirement: Command activation reports asynchronous failures consistently

Pointer and keyboard activation across Actions, View All, and search SHALL use equivalent completion and failure behavior. Errors SHALL be visible and actionable, repeated activation while the same invocation is pending SHALL NOT duplicate work, and the palette SHALL release focus before opening destination dialogs or results.

#### Scenario: An asynchronous action rejects
- **WHEN** an invoked command fails asynchronously
- **THEN** the user sees a localized error with an appropriate recovery step
- **AND** the app does not report success or leave an unhandled rejection

#### Scenario: User invokes a pending command twice
- **WHEN** the same command is activated repeatedly before its current invocation completes
- **THEN** only one operation is started for that invocation

#### Scenario: Dialog receives focus
- **WHEN** a command opens a dialog from any palette surface
- **THEN** the palette closes and the dialog receives focus
