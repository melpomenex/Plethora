## MODIFIED Requirements

### Requirement: Document Review and Navigation
The system SHALL support rating documents during reading, which triggers rescheduling and navigation, ONLY when the document is being actively reviewed from the queue (`openedFrom === "queue"`). When viewing a document outside the queue (such as from the library, search, recent files, or bookmarks), rating affordances SHALL NOT be displayed and rating keyboard shortcuts SHALL NOT be active.

#### Scenario: Document opened from Queue shows rating orbs
- **WHEN** a document tab is opened with origin `openedFrom === "queue"` and viewed in "document" view mode
- **THEN** the inline rating orbs (Again, Hard, Good, Easy, Dismiss) SHALL be displayed
- **AND** keyboard shortcuts 1-4 SHALL submit the corresponding document rating and advance to the next queue item

#### Scenario: Document opened outside Queue hides rating orbs
- **WHEN** a document tab is viewed with any origin other than `"queue"` (including `openedFrom === "documents"`, `openedFrom === undefined`, search results, recent files, continue reading, or restored tabs)
- **THEN** the inline rating orbs SHALL NOT be displayed, regardless of whether the document is scheduled in the user's queue
- **AND** clicking rating orbs cannot occur because they are hidden

#### Scenario: Rating keyboard shortcuts disabled outside Queue
- **WHEN** a document tab is viewed with any origin other than `"queue"`
- **THEN** keyboard number keys 1-4 SHALL NOT trigger document rating submissions or queue navigation
