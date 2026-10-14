## MODIFIED Requirements

### Requirement: Command palette surfaces actions for the active view

When the command palette is opened while a supported view is the active tab, the palette SHALL surface a set of contextual actions that operate on that active view. The set of actions SHALL be determined by the active tab's view type, and actions that do not apply to the current view SHALL NOT be shown.

Supported view types are: document viewer (`document-viewer`, covering PDF/EPUB/HTML/TXT/MD), RSS (`rss`), Podcast (`podcast`), and Audiobook (`audiobook`, also covering `audiobook-epub-sync`).

With an empty query in All, applicable contextual actions SHALL appear in a named “Actions in this view” section before the command hub's general Quick Actions and reading/suggestion content. The reference dashboard composition SHALL remain unchanged when there are no applicable contextual actions. The Actions catalogue SHALL make every applicable contextual action reachable and SHALL place those actions before global commands. Typed All/Actions results SHALL retain contextual priority and existing content-search behavior.

#### Scenario: Palette shows contextual actions for the active view

- **WHEN** the user opens the command palette while a document viewer is the active tab
- **THEN** the palette displays document-applicable actions (e.g. Search in Document) before general hub actions and above matching global navigation commands
- **AND** actions from other views (e.g. RSS actions) are not shown

#### Scenario: Palette shows no contextual actions for unsupported views

- **WHEN** the user opens the command palette while the active tab is a view with no defined actions (e.g. Analytics)
- **THEN** the palette shows the general command hub without an empty contextual-action section
- **AND** global commands remain reachable through Actions, View all, or typing

#### Scenario: Contextual actions appear by default without typing

- **WHEN** the user opens the command palette in a supported view with an empty query and All selected
- **THEN** the palette displays applicable contextual actions in “Actions in this view” before the general Quick Actions, reading, and suggestion content
- **AND** the user can select them by keyboard or pointer without first entering a query

#### Scenario: Full contextual set remains discoverable

- **WHEN** the supported view has more contextual actions than fit in the compact home section
- **THEN** the Actions catalogue exposes the complete applicable set before global commands
- **AND** the home section provides an explicit route to that catalogue

#### Scenario: Unsupported actions stay filtered in every presentation

- **WHEN** a contextual action does not apply to the active document format or no required target episode/item exists
- **THEN** that action is absent from the home contextual section, action catalogue, and typed results
- **AND** adding the home does not create an executable unavailable contextual action
