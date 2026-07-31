## ADDED Requirements

### Requirement: Command palette surfaces actions for the active view

When the command palette is opened while a supported view is the active tab, the palette SHALL surface a set of contextual actions that operate on that active view. The set of actions SHALL be determined by the active tab's view type, and actions that do not apply to the current view SHALL NOT be shown.

Supported view types are: document viewer (`document-viewer`, covering PDF/EPUB/HTML/TXT/MD), RSS (`rss`), Podcast (`podcast`), and Audiobook (`audiobook`, also covering `audiobook-epub-sync`).

#### Scenario: Palette shows contextual actions for the active view

- **WHEN** the user opens the command palette while a document viewer is the active tab
- **THEN** the palette displays document-applicable actions (e.g. Search in Document) ranked above global navigation commands
- **AND** actions from other views (e.g. RSS actions) are not shown

#### Scenario: Palette shows no contextual actions for unsupported views

- **WHEN** the user opens the command palette while the active tab is a view with no defined actions (e.g. Analytics)
- **THEN** the palette shows only the existing global commands and no contextual-action results

#### Scenario: Contextual actions appear by default without typing

- **WHEN** the user opens the command palette in a supported view with an empty query
- **THEN** the palette lists the applicable contextual actions for that view first, followed by the existing global commands

### Requirement: Contextual actions dispatch to existing view handlers without duplicating logic

Contextual actions SHALL invoke the existing handler already present in the active view component. The palette SHALL NOT re-implement any view behavior; it SHALL dispatch a typed action event that the active view's listener routes to its existing handler. Only the active view's listener SHALL be registered, so actions are never handled by an inactive view.

#### Scenario: Selecting an action invokes the existing view handler

- **WHEN** the user selects a "Refresh Feed" contextual action in the RSS view
- **THEN** the palette dispatches the action to the RSS view's existing refresh handler
- **AND** the same refresh code path runs as if invoked from the RSS UI directly
- **AND** the palette closes

#### Scenario: Inactive views do not handle actions

- **WHEN** two views of the same type are mounted in split panes and the user triggers an action for the active view
- **THEN** only the active view's listener handles the action
- **AND** the inactive view's listener does not execute the handler

### Requirement: Contextual actions are matched alongside global commands when typing

When the user types a query, contextual actions SHALL participate in the same ranked result set as global commands and content-search results, matching on action title and keywords. Matching contextual actions SHALL be ranked above matching global commands, and existing content-search behavior (documents, RSS articles, podcast episodes) SHALL remain unchanged.

#### Scenario: Typing finds a contextual action above global commands

- **WHEN** the user types "bookm" while in the Audiobook view
- **THEN** the "Add Bookmark" contextual action appears in the results
- **AND** it is ranked above any matching global commands
- **AND** existing content-search results are still returned

#### Scenario: Content search remains functional in supported views

- **WHEN** the user types a document title while in the document viewer
- **THEN** document content-search results are returned as before
- **AND** contextual actions may also appear if their title/keywords match

### Requirement: Document-view actions respect the active document format

Document-view contextual actions SHALL be filtered by the active document's format, because not all actions apply to every format. Actions that do not apply to the current format (e.g. "Jump to Page" for a plain Markdown file) SHALL be hidden rather than shown disabled.

#### Scenario: Paging action hidden for non-paginated formats

- **WHEN** the active document is a Markdown/TXT file
- **THEN** the "Jump to Page" action is not shown in the palette
- **WHEN** the active document is a PDF or EPUB
- **THEN** the "Jump to Page" action is shown

### Requirement: Podcast actions target a resolvable episode

Podcast-view contextual actions that act on an episode SHALL target a single resolvable episode. If a now-playing episode exists it SHALL be the target; otherwise the currently selected/highlighted episode SHALL be the target. If no episode can be resolved, episode-specific actions SHALL be hidden.

#### Scenario: Podcast episode action targets the now-playing episode

- **WHEN** an episode is playing and the user selects "Mark Played"
- **THEN** the now-playing episode is the target of the mark-played handler

#### Scenario: Podcast episode action hidden when no episode is selected

- **WHEN** no episode is playing and none is selected
- **THEN** episode-specific actions (e.g. "Mark Played", "Download") are not shown

### Requirement: Contextual action definitions are centralized and type-safe

Contextual action identifiers, supported view constants, and per-view action sets SHALL be defined in a single shared module imported by both the palette (for listing) and the view listeners (for dispatch routing). The action identifier and view type SHALL be statically typed so that a misspelled identifier or unsupported view is a compile-time error.

#### Scenario: Adding a new action requires one registry entry and one handler route

- **WHEN** a developer adds a new audiobook action
- **THEN** they add the action descriptor to the shared audiobook action set and add the matching `actionId → handler` route in the audiobook listener
- **AND** no other code needs to change for the action to appear and work

#### Scenario: Unknown action identifier is surfaced during development

- **WHEN** the palette dispatches an action identifier that the active view's listener does not recognize
- **THEN** a development-only warning is emitted
- **AND** the action otherwise fails silently without crashing the palette
