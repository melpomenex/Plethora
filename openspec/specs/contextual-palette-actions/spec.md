# contextual-palette-actions Specification

## Purpose
Surfaces per-view, keyboard-discoverable actions in the command palette (Ctrl/Cmd+K) based on the active tab's view type. When a supported view (document viewer, RSS, Podcast, Audiobook) is active, the palette shows actions that operate on that view — each dispatching to the view's existing handler without re-implementing behavior.

## Requirements

### Requirement: Command palette surfaces actions for the active view

When the command palette is opened while a supported view is the active tab, the palette SHALL surface a set of contextual actions that operate on that active view. The set of actions SHALL be determined by the active tab's view type, and actions that do not apply to the current view SHALL NOT be shown.

Supported view types are: document viewer (`document-viewer`, covering PDF/EPUB/HTML/TXT/MD), RSS (`rss`), Podcast (`podcast`), and Audiobook (`audiobook`, also covering `audiobook-epub-sync`).

When in `document-viewer`, the command palette SHALL surface Smart Tagging actions including "Retag this document" and "Suggest tags for this document".

#### Scenario: Palette shows contextual actions for the active view

- **WHEN** the user opens the command palette while a document viewer is the active tab
- **THEN** the palette displays document-applicable actions (e.g. Search in Document, Retag Document, Suggest Tags) ranked above global navigation commands
- **AND** actions from other views (e.g. RSS actions) are not shown

#### Scenario: Palette shows no contextual actions for unsupported views

- **WHEN** the user opens the command palette while the active tab is a view with no defined actions (e.g. Analytics)
- **THEN** the palette shows only the existing global commands and no contextual-action results

#### Scenario: Contextual actions appear by default without typing

- **WHEN** the user opens the command palette in a supported view with an empty query
- **THEN** the palette lists the applicable contextual actions for that view first, followed by the existing global commands

#### Scenario: Retag document contextual action triggers re-analysis

- **WHEN** the user is viewing an open document in the document viewer and selects "Retag this document" from the command palette
- **THEN** the palette dispatches the retag action to the document viewer handler
- **AND** Smart Tagging re-analyzes the document and updates the document's tags

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

### Requirement: Command palette surfaces direct actions for detected X/Twitter content
When the Command Palette detects a valid X/Twitter status URL, it SHALL prioritize a direct "Open and analyze this thread" action above generic global search results.

#### Scenario: URL detected in palette input prioritizes content opening
- **WHEN** the user inputs an X/Twitter status URL in the command palette
- **THEN** the top result is the contextual X thread action
- **AND** pressing Enter immediately executes navigation to the X reader workspace

### Requirement: Palette executes allowlisted documentation actions
The command palette SHALL support executing allowlisted action IDs surfaced by the Ask Plethora help system and canonical documentation results. Only statically registered action IDs in `src/commandPalette/contextualActions.ts` or `src/features/help/registeredHelpActions.ts` SHALL be accepted for dispatch.

#### Scenario: Safe execution of allowlisted help action
- **WHEN** the user selects an action button from a help result (e.g. `action: settings.learning.algorithm`)
- **THEN** the palette closes and executes the pre-registered action dispatch safely
- **AND** arbitrary non-allowlisted string commands are rejected

### Requirement: Translate Selection uses the active reader selection

Translate Selection SHALL be available for a non-empty selection belonging to the active reader, including PDF, EPUB, HTML, and text readers. Opening the palette SHALL preserve the selected passage for invocation even when focusing its input clears the native selection. The action SHALL translate the entire captured passage and target only its owning reader. It SHALL NOT use palette input or a selection from an inactive pane.

#### Scenario: Selection survives palette focus
- **WHEN** the user selects a passage in a supported reader, opens the palette, and activates Translate Selection
- **THEN** the captured passage is used even if the native selection collapsed
- **AND** the user sees progress followed by a translation result in the owning reader

#### Scenario: Selection contains several sentences
- **WHEN** the user translates a multi-sentence selection
- **THEN** the entire selected passage is translated rather than only the first sentence or an unrelated document window

#### Scenario: No usable selection
- **WHEN** the palette opens without a non-empty active-reader selection
- **THEN** Translate Selection is not listed as an executable action

#### Scenario: Selection belongs to another pane
- **WHEN** an inactive reader retains a selection and the active reader has none
- **THEN** the palette does not offer translation of the inactive reader's selection

#### Scenario: Owner changes before invocation
- **WHEN** the captured selection's document is closed or the active reader changes before invocation
- **THEN** the stale selection is invalidated and is not translated against the new reader

### Requirement: Selection translation exposes languages and truthful availability

Translation SHALL use the configured profile's translation direction when present, otherwise obtain a target language from translation settings or a target-language prompt. It SHALL honor existing provider and offline policies, retain the original text, and present translated text with source/target languages and accurate provider provenance. Command descriptions SHALL NOT promise on-device processing when a remote provider can be used. Missing providers, models, or configuration SHALL produce actionable guidance. Selection translation SHALL NOT silently enable Language Mode.

#### Scenario: Downloaded local language pair
- **WHEN** a usable local model is available and the user translates while offline
- **THEN** the translation completes locally and identifies its source and target languages
- **AND** no cloud request is made

#### Scenario: Configured remote fallback
- **WHEN** local translation cannot serve the pair and user policy permits a configured remote provider
- **THEN** the permitted provider translates the passage and its provenance is shown accurately

#### Scenario: No usable provider
- **WHEN** the selected language pair cannot be translated by an allowed available provider
- **THEN** the result UI explains the missing setup or model and offers a relevant next step
- **AND** the original selection remains available to retry

#### Scenario: No configured target language
- **WHEN** translation is invoked without a language profile or configured target language
- **THEN** the user can choose a target language before translation starts

#### Scenario: Reader closes during translation
- **WHEN** the owning reader closes or changes document during a translation request
- **THEN** its work is cancelled or the late result is discarded
- **AND** no result appears in another document
