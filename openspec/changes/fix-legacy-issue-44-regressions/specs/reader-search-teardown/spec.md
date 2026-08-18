## ADDED Requirements

### Requirement: Clearing in-document search restores a pristine reader DOM

When in-document search is cleared, the reader SHALL remove all search highlight marks it inserted, restoring the content DOM to its pre-search structure. Search highlighting SHALL unwrap previous search marks before applying new ones, SHALL NOT nest marks inside marks, and SHALL NOT persist search marks into any cached "original content" baseline.

#### Scenario: Clear leaves no highlight marks

- **WHEN** the user searches for a word and then clears the search
- **THEN** no search highlight elements remain in the rendered content
- **AND** the content renders identically to a never-searched document

#### Scenario: Re-searching does not nest highlights

- **WHEN** the user searches a second term after a first search
- **THEN** matches of the second term are wrapped exactly once, with the first search's marks removed first

#### Scenario: Later edits do not bake marks into the baseline

- **WHEN** the user clears a search and subsequently creates a persistent highlight (extract)
- **THEN** the persisted highlight operates on mark-free content, and no search mark survives into the restored baseline

### Requirement: AI actions work immediately after clearing search

Clearing search SHALL leave selection-dependent features fully functional: text-selection AI actions (Explain/Summarize/Simplify) SHALL execute against the current selection without a reload, and no code path SHALL act on a selection captured before the search was cleared.

#### Scenario: Explain works right after clearing search

- **WHEN** the user selects text and runs an AI action after previously searching and clearing
- **THEN** the action executes against the freshly selected text
- **AND** a text selection anchored in unwrapped content survives the teardown
