## ADDED Requirements

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
