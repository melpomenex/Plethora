# command-palette-navigation Specification

## Purpose
The command palette currently resolves and opens documents but does not let users jump directly to core app sections like Settings. Adding section navigation reduces clicks and makes the palette a single, fast navigation surface.

## Requirements

### Requirement: Command Palette Surfaces Registered Destinations

The command palette SHALL return every registered navigation destination as a searchable result alongside document results. A destination SHALL match on its label, its aliases, its keywords, and its canonical path name.

#### Scenario: Query matches a section label

- **WHEN** the user types a query that exactly matches a registered destination label (for example, "settings")
- **THEN** the command palette includes that destination in the result list
- **AND** the destination is ranked ahead of weaker content and help matches

#### Scenario: Query matches a section alias

- **WHEN** the user types a query that matches a configured destination alias (for example, "prefs" for Settings)
- **THEN** the command palette includes the mapped destination in the result list

#### Scenario: Query matches a feature destination by name

- **WHEN** the user types the name of a registered feature destination (for example, "rss", "podcasts", "audiobooks", or "newsletters")
- **THEN** that destination is included in the result list
- **AND** activating it opens the destination

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

### Requirement: Every supported destination and operation is reachable by name

The palette SHALL provide a command for every registered feature destination, including Dashboard, Continue Reading, Documents, Queue, Scroll Mode, Review, Analytics/Statistics, Settings, RSS, Podcasts, Audiobooks, Newsletters, Images, Knowledge Sphere, Knowledge Network, Document Q&A, NotebookLM, Extracts, Import Needs Review, and Web Browser, and for supported operations including importing documents, creating flashcards, creating extracts, changing themes, opening settings sections, managing saved queues, refreshing feeds, and launching review or scroll-study sessions. Every registered command SHALL execute its described navigation, dialog, operation, or actionable setup state, and the palette SHALL NOT advertise commands that cannot execute.

#### Scenario: Destination reachable by primary name

- **WHEN** the user types "rss", "podcasts", "audiobooks", "newsletters", "images", "knowledge sphere", "knowledge network", "document q&a", or "settings"
- **THEN** the matching destination is offered
- **AND** activating it opens that destination view

#### Scenario: Destination reachable by common alias

- **WHEN** the user types "feeds", "stats", or "flashcards"
- **THEN** RSS, Analytics, and Review respectively are offered and open the corresponding view

#### Scenario: Operation commands execute their real workflow

- **WHEN** the user invokes "new flashcard", an import document command, a settings-section command, or a refresh-feeds command
- **THEN** the existing flashcard creation workflow, document import flow, settings section, or feed refresh runs respectively

#### Scenario: No dead-end commands

- **WHEN** any command is displayed in the palette
- **THEN** activating it leads to its described navigation, dialog, operation, or actionable setup state
- **AND** it does not silently close as though the operation succeeded

### Requirement: Destination commands activate existing tabs

When a destination command is invoked and a tab for that destination already exists anywhere in the workspace, the app SHALL activate that existing tab instead of creating a duplicate. When no such tab exists, the app SHALL create the destination through the established tab-creation flow. A destination whose surface is unavailable on the current platform SHALL resolve to the nearest available surface rather than a broken destination.

#### Scenario: Existing tab is activated, not duplicated

- **WHEN** the destination already has an open tab in any pane and the user invokes its command
- **THEN** that existing tab becomes the active tab
- **AND** no second tab for the destination is created

#### Scenario: Background destination tab is focused

- **WHEN** the destination has an open but inactive tab
- **THEN** the existing tab becomes active and its pane is focused

#### Scenario: Destination tab created when none exists

- **WHEN** no tab for the destination exists
- **THEN** the destination tab is created through the established tab-creation flow
- **AND** it becomes active

#### Scenario: Platform-hidden destination resolves to the nearest surface

- **WHEN** a command targets a destination whose surface is unavailable on the current platform
- **THEN** the app routes to the nearest available surface instead of a broken destination
