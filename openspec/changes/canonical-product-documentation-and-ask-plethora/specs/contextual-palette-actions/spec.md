## MODIFIED Requirements

### Requirement: Contextual actions are matched alongside global commands when typing

When the user types a query, contextual actions SHALL participate in the same ranked result set as global commands, content-search results, and canonical product help results, matching on action title, keywords, and registered documentation aliases. Matching contextual actions and direct help actions SHALL be ranked appropriately based on detected intent, while existing content-search behavior (documents, RSS articles, podcast episodes) SHALL remain preserved.

#### Scenario: Typing finds a contextual action above global commands

- **WHEN** the user types "bookm" while in the Audiobook view
- **THEN** the "Add Bookmark" contextual action appears in the results
- **AND** it is ranked above any matching global commands
- **AND** existing content-search results are still returned

#### Scenario: Content search remains functional in supported views

- **WHEN** the user types a document title while in the document viewer
- **THEN** document content-search results are returned as before
- **AND** contextual actions may also appear if their title/keywords match

#### Scenario: Help action triggers from palette search

- **WHEN** the user types a query that resolves to a safe documentation action (e.g., "e-ink mode" → `settings.appearance.eink`)
- **THEN** the palette surfaces the direct action item with appropriate category and icon for immediate execution

## ADDED Requirements

### Requirement: Palette executes allowlisted documentation actions
The command palette SHALL support executing allowlisted action IDs surfaced by the Ask Plethora help system and canonical documentation results. Only statically registered action IDs in `src/commandPalette/contextualActions.ts` or `src/features/help/registeredHelpActions.ts` SHALL be accepted for dispatch.

#### Scenario: Safe execution of allowlisted help action
- **WHEN** the user selects an action button from a help result (e.g. `action: settings.learning.algorithm`)
- **THEN** the palette closes and executes the pre-registered action dispatch safely
- **AND** arbitrary non-allowlisted string commands are rejected
