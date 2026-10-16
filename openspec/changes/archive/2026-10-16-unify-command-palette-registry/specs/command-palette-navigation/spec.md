## RENAMED Requirements

- FROM: `### Requirement: Command Palette Surfaces App Sections`
- TO: `### Requirement: Command Palette Surfaces Registered Destinations`

## MODIFIED Requirements

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

## ADDED Requirements

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
