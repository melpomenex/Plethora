## ADDED Requirements

### Requirement: Compact View sidebar exposes Extracts and Flashcards sort shortcuts
The Compact View left sidebar SHALL expose dedicated "Extracts" and "Flashcards" sort shortcut controls, in addition to the existing "Has extracts" / "Has cards" Signals filters, allowing the user to sort the document list by extract count or flashcard count without leaving the sidebar.

#### Scenario: Sorting by extracts from the sidebar
- **WHEN** the user clicks the "Extracts" sort shortcut in the Compact View sidebar
- **THEN** the document list SHALL be sorted by extract count (descending by default)

#### Scenario: Sorting by flashcards from the sidebar
- **WHEN** the user clicks the "Flashcards" sort shortcut in the Compact View sidebar
- **THEN** the document list SHALL be sorted by flashcard (learning item) count (descending by default)

#### Scenario: Repeat click toggles direction
- **WHEN** the user clicks an already-active sort shortcut (e.g. "Extracts" while already sorted by extracts)
- **THEN** the sort direction SHALL toggle between ascending and descending

### Requirement: Sort shortcuts are visually distinct from Signals filters
The Extracts/Flashcards sort shortcuts SHALL be visually distinguishable from the Signals filter buttons (Has extracts / Has cards) so that sorting and filtering are not confused with each other, since they are different, independently-applicable operations.

#### Scenario: Sort shortcuts do not show a filter-style count badge
- **WHEN** the Compact View sidebar renders the Extracts/Flashcards sort shortcuts
- **THEN** they SHALL NOT display the same document-count badge styling used by the Signals filter buttons

#### Scenario: Sort shortcuts and Signals filters can be used together
- **WHEN** a Signals filter (e.g. "Has extracts") is active and the user clicks a sort shortcut (e.g. "Flashcards")
- **THEN** the filtered subset of documents SHALL be sorted by the selected sort key, with both the filter and the sort remaining active simultaneously

### Requirement: Sort state is consistent across Compact, List, and Grid views
Sorting by extracts or flashcards, however triggered (Compact sidebar shortcuts, Compact "Sort by" dropdown, or List view column headers), SHALL apply a single shared sort state that is reflected consistently across Compact, List, and Grid views.

#### Scenario: Sort set in Compact view persists when switching to List view
- **WHEN** the user sorts by extracts using the Compact View sidebar shortcut and then switches to List view
- **THEN** the document list in List view SHALL remain sorted by extracts, and the List view's "Extracts" column header SHALL indicate it is the active sort

#### Scenario: Grid view respects the active sort
- **WHEN** the user sorts by flashcards (from either Compact or List view controls) and then switches to Grid view
- **THEN** documents in Grid view SHALL be ordered according to the active flashcard sort
