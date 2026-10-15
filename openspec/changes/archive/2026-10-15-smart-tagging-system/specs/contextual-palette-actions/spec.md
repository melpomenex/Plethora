# contextual-palette-actions Specification

## MODIFIED Requirements

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
