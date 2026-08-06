## ADDED Requirements

### Requirement: Queue order stays stable across reactivation
The system SHALL keep the reading/review queue's displayed item order unchanged when the user returns to the Queue after closing and reopening the Queue tab, switching tabs and switching back, or returning from a document, Scroll Mode, or review session. The displayed order SHALL only change when the user changes sort, filter, or search, or explicitly refreshes.

#### Scenario: Returning from a document does not reorder the queue
- **WHEN** the user opens a document from the Queue, then closes that document tab to land back on the Queue
- **THEN** the rendered queue item id order SHALL be identical to the order before the document was opened

#### Scenario: Closing and reopening the Queue tab does not reorder
- **WHEN** the user closes the Queue tab and reopens it without changing sort, filter, or search
- **THEN** the rendered queue item id order SHALL be identical to the order before the tab was closed

#### Scenario: Switching tabs and back does not reorder
- **WHEN** the user switches from the Queue to another tab and back
- **THEN** the rendered queue item id order SHALL be identical to the order before switching away

#### Scenario: Explicit refresh may reorder
- **WHEN** the user changes sort, filter, or search, or triggers an explicit refresh (Toolbar refresh / pull-to-refresh)
- **THEN** the queue SHALL be permitted to reorder to reflect the new query or fresh server data

### Requirement: Post-mutation reconcile uses one mode-aware reload path
Every queue reconcile that follows a user mutation or navigation SHALL route through a single shared, mode-aware store reload entry point that re-issues the active filter mode's query (due-all / due-today / all-items / new-only). No reconcile site SHALL replace the queue item array with a different filter mode's result set.

#### Scenario: Reconcile after a single-item mutation does not replace the whole list
- **WHEN** the user postpones, suspends, archives, or finishes a single queue item and the local optimistic update was applied successfully
- **THEN** only that item's row SHALL move or be removed; unrelated rows SHALL NOT change position

#### Scenario: A reload that follows a mutation uses the active filter mode
- **WHEN** a genuine server refresh is required after a bulk action (e.g. unsuspend, lifecycle "forget", postpone-all) and the active filter mode is `due-all`
- **THEN** the reload SHALL re-issue the `due-all` query, not the `all-items` query

### Requirement: Queue first-load state survives tab unmount
The "has the first load completed for the current query" state SHALL live in the queue store, not in component refs, so that closing and reopening the Queue tab does not re-run the first-load path (including the bounded startup snapshot fast-path) against an already-loaded queue.

#### Scenario: Reopened Queue tab does not re-apply the bounded startup snapshot
- **WHEN** the full, unbounded queue has already loaded for the current query and the user closes and reopens the Queue tab
- **THEN** the system SHALL NOT replace the loaded queue with the bounded (≤50 item) startup snapshot

### Requirement: Selection stays coherent across the stable reload path
When the stable reload path runs, the queue SHALL keep multi-select coherent: a row the user can no longer see SHALL NOT remain selected, and the reload path SHALL NOT clear a selection that is still visible unless the action that triggered the reload is itself a bulk action that releases selection.

#### Scenario: Visible selection survives a mode-stable reload
- **WHEN** the user has selected visible rows and a reload runs through the shared mode-aware path without a user bulk action
- **THEN** the selection over still-visible rows SHALL be preserved

#### Scenario: Bulk action still releases selection
- **WHEN** the user performs a bulk action that releases selection (e.g. bulk suspend, bulk delete)
- **THEN** the selection SHALL be cleared as part of that action
