# queue-filter-fixes Specification

## Purpose
Users encountered several usability, filtering, and functional bugs in Issue #44: "Due All" filtering omitted learning items/extracts, NotebookLM displayed a connected status without rendering notebooks, the Knowledge Universe graph was off-center, Scroll Mode became stuck on an inescapable "Nothing to Read" state when filters were set to zero, "New Only" showed read/overdue documents, section mentions with # failed in document Q&A for EPUB Table.

## Requirements

### Requirement: Due All filter displays all due item types
The queue filtering logic SHALL include due documents, extracts, and flashcards/learning items when the user selects the "Due All" filter in the Reading Queue, ensuring proper collection-scoping without filtering out non-document item types.

#### Scenario: User selects Due All filter
- **WHEN** the user selects the "Due All" filter in the Reading Queue tab
- **THEN** the queue displays all due documents, extracts, and learning items matching the active collection context

### Requirement: New Only filter excludes read and scheduled items
The queue filtering logic SHALL filter out any items with review history, due dates, or progress when the user selects the "New Only" filter.

#### Scenario: User selects New Only filter
- **WHEN** the user selects the "New Only" filter in the Reading Queue tab
- **THEN** only documents and items with status "new" (no due date, 0 reviews, no progress) are shown in the queue list

### Requirement: Scroll Mode empty state filter recovery
When Scroll Mode filtering yields zero items to read, the interface SHALL provide a prominent "Reset Filters" or "Customize Session" control directly on the empty state screen.

#### Scenario: Scroll Mode filters yield zero items
- **WHEN** all items are filtered out in Scroll Mode
- **THEN** the "Nothing to Read" screen displays an actionable button to adjust or reset session filters and return to reading
