## ADDED Requirements

### Requirement: Windowed rendering of the document library list
The Documents view SHALL render the compact card list and compact table layouts using windowed (virtualized) rendering, mounting only the rows within or near the visible viewport rather than every document in the current sort/filter result.

#### Scenario: Opening a large library
- **WHEN** the user opens the Documents view with a library of 272 documents and the default (compact table or compact card) layout active
- **THEN** the number of document row elements mounted in the DOM at any time SHALL be bounded to roughly the viewport size plus a small overscan buffer, not the full document count

#### Scenario: Scrolling through the list
- **WHEN** the user scrolls the document list
- **THEN** rows scrolled out of view SHALL be unmounted/recycled and rows scrolled into view SHALL be mounted, without visible flicker or scroll-position jumps

### Requirement: Interaction parity under virtualization
Virtualizing the document list SHALL NOT change any existing selection, navigation, or context-menu behavior available before virtualization.

#### Scenario: Range selection across virtualized rows
- **WHEN** the user shift-clicks a document row that is not currently mounted because it was previously scrolled out of view
- **THEN** the selection range SHALL be computed against the full sorted/filtered document list (not just currently-mounted rows), matching pre-virtualization behavior

#### Scenario: Keyboard and touch interactions unaffected
- **WHEN** the user uses keyboard shortcuts, long-press (mobile), or context-menu actions on a document row
- **THEN** the behavior SHALL be identical to the non-virtualized implementation

### Requirement: Bounded per-render list computations
Aggregate computations over the document list that are used to render filter counts and summaries SHALL be memoized so they only recompute when the underlying document list, filters, or sort actually change, not on every unrelated re-render.

#### Scenario: Selecting a document does not rescan the full library
- **WHEN** the user selects or deselects a document row
- **THEN** the per-filter document counts (all/priority/recent/active/parked/highlights/cards) SHALL NOT be recomputed by rescanning the entire document list, since selection state does not affect those counts
