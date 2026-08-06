## ADDED Requirements

### Requirement: Overdue days is a selectable queue sort order
The queue sort options SHALL include an overdue-days field. Selecting it in descending
direction SHALL order the queue so that the most overdue item appears first. The option
SHALL be selectable through the same sort control as the existing sort fields and SHALL
persist alongside them.

#### Scenario: Most overdue item sorts first
- **WHEN** the queue holds items overdue by 10, 3, and 25 days and the user sorts by overdue days descending
- **THEN** the 25-day item SHALL appear first, then the 10-day item, then the 3-day item

#### Scenario: Ascending direction reverses the order
- **WHEN** the same queue is sorted by overdue days ascending
- **THEN** the 3-day item SHALL appear first and the 25-day item last

### Requirement: Overdue days is computed as a non-negative whole-day count
An item's overdue days SHALL be `max(0, whole days between its due date and today)`.
Items due today or in the future SHALL have an overdue-days value of zero. Items with no
due date SHALL also be treated as zero for sorting purposes, so that they never
displace genuinely overdue items from the top of a descending sort.

#### Scenario: Future-due item is not overdue
- **WHEN** an item is due in 5 days
- **THEN** its overdue days SHALL be 0

#### Scenario: Item due today is not overdue
- **WHEN** an item is due today
- **THEN** its overdue days SHALL be 0

#### Scenario: Items with no due date do not outrank overdue items
- **WHEN** the queue is sorted by overdue days descending and contains items with no due date alongside items overdue by 5 days
- **THEN** the 5-day overdue items SHALL appear above the items with no due date

### Requirement: Ties resolve by the existing default order
When two items have equal overdue days, their relative order SHALL fall back to the
queue's existing default ordering rather than being arbitrary, so that repeated renders
of the same queue produce the same sequence.

#### Scenario: Equal overdue days sort stably
- **WHEN** three items are each overdue by 7 days and the queue is re-rendered
- **THEN** those three items SHALL appear in the same relative order each time
