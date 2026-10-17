## Purpose

Makes mobile Deck Manager prioritize browsing cards through compact navigation, accessible on-demand controls, and predictable preservation of deck and list context.

## ADDED Requirements

### Requirement: Two-row mobile browsing chrome

In mobile-shell presentation, Deck Manager SHALL show a compact header containing Back, a deck-switching title, a directly available labeled Study action, and deck actions, followed by one row containing search and a labeled Filter & sort control. The selected deck name SHALL appear once in the default browsing chrome, with a compact count summary. Detailed statistics, category chips, the full sort chooser, and the single-column Card heading SHALL NOT occupy additional default rows. The card list SHALL consume the remaining available height without requiring the user to collapse controls first.

#### Scenario: Initial viewport prioritizes cards

- **WHEN** a populated deck is opened at normal text size in a 360–430 CSS px wide phone viewport with the keyboard closed
- **THEN** the distance from the top of Deck Manager content to the top of the first card is at most 128 CSS px, excluding operating-system safe-area insets and any application chrome outside Deck Manager
- **AND** the list is directly below the two control rows
- **AND** card text and row touch areas have not been reduced to achieve this budget

#### Scenario: Long deck names retain usable controls

- **WHEN** the selected deck has a long name at a 320 CSS px wide viewport
- **THEN** the header title truncates within its available space without pushing Back, Study, or deck actions off screen
- **AND** the complete name is available to assistive technology and in the deck picker
- **AND** no horizontal page scrolling is required

### Requirement: Discoverable deck identity and switching

The deck title SHALL expose an obvious switching affordance that opens a labeled deck picker containing full names, card counts, and the current selection. The default subtitle SHALL show the selected deck's total cards and due count. Changing decks SHALL clear search, category filtering, card selection, and stale card-detail state, reset list scroll to the start, and retain the chosen sort. Closing the picker without choosing SHALL preserve the current list context.

#### Scenario: Switch decks from the title

- **WHEN** the user taps the deck title and chooses another deck
- **THEN** that deck's cards and summary replace the current content
- **AND** search, category filtering, and selected card IDs from the previous deck are cleared
- **AND** the current sort remains applied and the list starts at its first result

#### Scenario: Picker cancellation preserves browsing

- **WHEN** the user opens the picker and dismisses it without choosing a deck
- **THEN** the current deck, query, filters, sort, selection, and list position remain unchanged

### Requirement: Search and disclosed filtering remain understandable

Search SHALL remain directly editable in the control row and SHALL preserve the existing question-text and tag matching behavior. Filter & sort SHALL open a sheet containing the existing All, New, Learning, Review, Suspended, and Leeches categories with counts, all six existing sort fields, and explicit ascending/descending choices. Learning SHALL include Learning and Relearning cards consistently in both membership and count. Category counts SHALL describe the complete active deck before search or category filtering. Filter/sort changes SHALL apply together through Apply; dismissal without Apply SHALL discard draft changes.

#### Scenario: Apply a category and sort

- **WHEN** the user chooses New and Difficulty descending and taps Apply
- **THEN** the list shows matching New cards in descending difficulty order
- **AND** the compact subtitle identifies the visible-versus-total count, New, and Difficulty descending
- **AND** Filter & sort has an active indicator distinguishable without color alone
- **AND** the default two-row layout remains intact

#### Scenario: Learning count agrees with the results

- **WHEN** a deck contains Learning and Relearning cards and the user applies Learning with an empty query
- **THEN** both states appear and the result count equals the Learning category count

#### Scenario: Cancel or reset sheet changes

- **WHEN** the user changes draft category or sorting and dismisses the sheet without Apply
- **THEN** the previous applied category and sort remain in effect
- **WHEN** the user instead chooses Reset and Apply
- **THEN** category returns to All and sorting returns to Due ascending without clearing the search query

#### Scenario: Empty search results provide recovery

- **WHEN** search or category filtering produces no cards
- **THEN** the list region explains that no cards match and provides Clear search and filters
- **AND** that action clears search and category filtering while preserving the deck and sort
- **AND** the empty state is distinguished from a genuinely empty deck

### Requirement: Deck tools and statistics use progressive disclosure

Deck actions SHALL open a labeled touch-accessible action sheet with Deck statistics, New card, Select cards, export formats, and the existing applicable rename, duplicate, suspend/unsuspend, and delete operations. Statistics SHALL describe the complete deck, clearly distinguished from filtered results. Study SHALL retain its existing deck-scoped behavior. Export SHALL retain its existing full-deck scope and format/destination behavior regardless of current search or filters. Applicable destructive actions SHALL retain confirmation and all operations SHALL retain success/failure feedback. Controls without a working action SHALL NOT be presented as available commands.

#### Scenario: Inspect deck statistics on demand

- **WHEN** the user opens Deck statistics from deck actions while a category filter is active
- **THEN** a labeled statistics surface shows total, due, new, learning, mature, and retention information for the complete deck
- **AND** closing it returns to the same deck, query, applied controls, and list position

#### Scenario: Deck actions preserve established scope

- **WHEN** a search leaves only part of the deck visible and the user chooses Study or Export
- **THEN** the operation retains its established full-deck scope rather than silently using only visible results
- **AND** export identifies the deck and number of cards being exported before confirmation

#### Scenario: Tools have working outcomes

- **WHEN** the user inspects the mobile deck action sheet
- **THEN** each enabled command invokes a working operation
- **AND** an inert Import command is absent
- **AND** deleting a deck or selected cards requires confirmation before mutation

### Requirement: Explicit card selection avoids permanent browsing controls

Select cards SHALL enter an explicit selection mode that exposes individually labeled checkboxes and a labeled Select all results command. Row activation in this mode SHALL toggle selection instead of opening Card Details. Bulk operations SHALL use the existing mobile floating selection-bar contract above bottom navigation, with accessible overflow, count, and clear-selection controls. The list SHALL have enough bottom clearance to scroll its last card above the bar. Search/category changes SHALL clear selection so hidden cards cannot be affected unintentionally. Leaving selection mode SHALL clear selection.

#### Scenario: Select a subset without opening details

- **WHEN** the user enters Select cards and taps two card rows or their checkboxes
- **THEN** only those two cards are selected and Card Details stays closed
- **AND** the floating bar shows two selected and provides the existing applicable bulk actions
- **AND** no additional bulk toolbar is inserted above the card list

#### Scenario: Select all results has visible scope

- **WHEN** the user chooses Select all results with a search or category filter active
- **THEN** only cards in the current results are selected
- **AND** the selection count matches the number of current results
- **AND** clearing selection dismisses the floating bar

#### Scenario: Changes cannot leave hidden selection behind

- **WHEN** selected cards exist and the user changes the search or applies a different category
- **THEN** selection is cleared before bulk actions can run against the new result set
- **WHEN** the user leaves selection mode
- **THEN** card taps resume opening Card Details

### Requirement: Mobile controls respect accessibility and platform navigation

New or migrated mobile controls SHALL have non-overlapping touch targets at least 48 CSS px on Android and 44 CSS px on other mobile presentations, accessible names, visible focus, and appropriate selected/expanded states. Sheets SHALL be readable in all supported themes, appear above bottom navigation, trap modal focus, and return focus to their trigger when dismissed. Back and Escape SHALL dismiss the topmost transient surface first; Back in selection mode SHALL exit selection before leaving Deck Manager. Enlarged text SHALL reflow without clipped controls, and the 128px normal-text budget SHALL NOT override accessibility. Keyboard and safe-area handling SHALL keep focused fields and actions reachable.

#### Scenario: Back closes the current surface

- **WHEN** a picker, filter sheet, statistics surface, or action confirmation is open and the user invokes system Back or Escape
- **THEN** only the topmost surface closes and Deck Manager stays on its current deck
- **AND** focus returns to the invoking control

#### Scenario: Larger text and keyboard remain usable

- **WHEN** the user increases text size to 200 percent, rotates a native phone, or opens the search keyboard
- **THEN** the layout can grow beyond two fixed-height rows as necessary without hiding controls
- **AND** the card list and sheet bodies remain scrollable within the available viewport
- **AND** focused controls remain reachable above the keyboard and safe-area insets

### Requirement: Browsing context and desktop interactions remain stable

Opening and closing Card Details or a non-mutating deck tool SHALL preserve the current deck, query, applied category, sort, and list position. Resizing across presentation modes SHALL preserve the selected deck and applied query/filter/sort, close mobile-only sheets, and clear transient selection. Desktop SHALL retain its multi-pane layout, visible toolbar, statistics, column headers, context menus, and keyboard workflows. Populated, loading, no-decks, deleted-deck, and empty-deck states SHALL remain usable without stale actions targeting a previous deck.

#### Scenario: Return from card inspection

- **WHEN** the user opens Card Details from a scrolled, filtered list and returns
- **THEN** the same deck, query, category, sort, and list position are restored
- **AND** Preview, Edit, History, and existing card operations continue to work

#### Scenario: Desktop presentation keeps its tools

- **WHEN** Deck Manager is rendered in desktop presentation
- **THEN** the desktop layout, toolbar, statistics, sort controls, and preview remain available
- **AND** the mobile two-row header and mobile-only sheets do not replace them

#### Scenario: No selected deck cannot expose stale commands

- **WHEN** no decks exist or the active deck has been removed
- **THEN** the user sees the appropriate empty state or the next valid deck
- **AND** deck-scoped actions cannot target the removed or nonexistent deck
