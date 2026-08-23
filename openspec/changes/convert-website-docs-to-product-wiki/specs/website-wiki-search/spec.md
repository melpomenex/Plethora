## ADDED Requirements

### Requirement: Local-First Static Search Engine
The documentation center SHALL provide a fast, local-first search system built into the static site assets, indexing article titles, headings, aliases, keywords, category labels, and body text without making requests to third-party hosted search APIs.

#### Scenario: Static search index generation
- **WHEN** the website build runs (`npm run website:build`)
- **THEN** the search indexing process scans all published documentation articles and emits an offline-accessible search index without requiring external server credentials.

#### Scenario: Search execution with keyword query
- **WHEN** user types "FSRS retention" into the search input
- **THEN** the search engine returns matching articles ranked by relevance (title and heading matches weighted higher than body matches), displaying category badges and highlighted snippets.

### Requirement: Modal Search Dialog & Global Keyboard Shortcut
The documentation search SHALL be globally triggerable via a dedicated search input on the `/docs` landing page, a compact search trigger button on article pages, and the global keyboard shortcut `/` or `⌘K` / `Ctrl+K`.

#### Scenario: User triggers search via keyboard shortcut
- **WHEN** user presses `/` or `⌘K` while browsing any page in `/docs` (and focus is not inside an editable text input)
- **THEN** the search modal dialog opens immediately, places cursor focus in the search field, and traps focus within the dialog.

#### Scenario: User dismisses search modal
- **WHEN** user presses `Escape` or clicks outside the active search modal
- **THEN** the search modal closes cleanly and restores focus to the previously focused trigger element.

### Requirement: Full Keyboard Navigation & Accessible ARIA Combobox
The search UI SHALL implement the WAI-ARIA combobox pattern, allowing complete keyboard control with Up/Down arrow keys to navigate results and Enter to open the selected document, with live region result count announcements.

#### Scenario: Keyboard navigation through search results
- **WHEN** search results are displayed and user presses `Down Arrow`
- **THEN** focus moves to the first result item with `aria-selected="true"`, and pressing `Enter` navigates to that article.

#### Scenario: Screen reader announcements
- **WHEN** search results update after typing a query
- **THEN** an `aria-live="polite"` region announces the number of matching results (e.g. "7 results found") to assistive technology.

### Requirement: Progressive Enhancement Fallback
The documentation center SHALL remain fully functional and navigable when JavaScript is disabled or fails to execute in the user's browser.

#### Scenario: User visits documentation with JavaScript disabled
- **WHEN** a user browses `/docs` without JavaScript execution
- **THEN** all category navigation cards, sidebar links, table of contents links, and breadcrumbs remain directly clickable HTML anchors.
