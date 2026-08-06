## ADDED Requirements

### Requirement: Remaining days badge on document cards
Each document card SHALL display a badge showing the number of days until the document is due or how many days it is overdue.

#### Scenario: Document due in the future
- **WHEN** a document's `next_reading_date` is 4 days from today
- **THEN** the card SHALL display "Due in 4 days"

#### Scenario: Document due today
- **WHEN** a document's `next_reading_date` is today
- **THEN** the card SHALL display "Due today"

#### Scenario: Document overdue
- **WHEN** a document's `next_reading_date` was 2 days ago
- **THEN** the card SHALL display "Overdue by 2 days"

### Requirement: Remaining days in reader header
The reader header SHALL display the same due/overdue badge as the document card for the currently open document.

#### Scenario: Reader header shows due status
- **WHEN** the user opens a document that is due in 3 days
- **THEN** the reader header SHALL display "Due in 3 days"
