## ADDED Requirements

### Requirement: Overdue days calculation
The system SHALL calculate `overdue_days = max(0, floor(today - due_date))` for all queue items with a past due date.

#### Scenario: Item overdue by 5 days
- **WHEN** an item's due date was 5 days ago
- **THEN** `overdue_days` SHALL be 5

#### Scenario: Item not yet due
- **WHEN** an item's due date is in the future
- **THEN** `overdue_days` SHALL be 0

### Requirement: Overdue metadata display in queue
Queue rows and headers SHALL display overdue metadata including the outstanding date and overdue days count.

#### Scenario: Overdue item in queue row
- **WHEN** an item is 5 days overdue with a due date of Oct 12
- **THEN** the queue row SHALL display "Outstanding since Oct 12 (5 days overdue)"

#### Scenario: Non-overdue item in queue row
- **WHEN** an item is due in the future
- **THEN** the queue row SHALL NOT display overdue metadata

### Requirement: Sort by overdue days
The queue SHALL support sorting items by `Overdue Days (Descending)` to surface the most overdue items first.

#### Scenario: Sorting by overdue days
- **WHEN** the user selects "Overdue Days (Descending)" sort order
- **THEN** items with the highest overdue_days SHALL appear first in the queue list
