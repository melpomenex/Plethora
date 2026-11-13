## Purpose

Eliminate false same-day overdue flags for newly created items and separate incremental reading document rotation from flashcard memory recall.

## ADDED Requirements

### Requirement: Calendar-day normalized due date evaluation
The system SHALL evaluate item due state using the start of the local calendar day. An item with a due timestamp occurring on the current calendar day SHALL be classified as `Due Today` and SHALL NOT be classified as `Overdue`.

#### Scenario: Inspecting an item shortly after creation
- **GIVEN** a flashcard or document created today at 09:01:00 AM local time with due date set to creation time
- **WHEN** the item details or statistics modal is inspected today at 09:08:00 AM local time
- **THEN** the status label SHALL be "Due Today" or "Today"
- **AND** the item SHALL NOT be labeled "Overdue" or carry an overdue penalty

#### Scenario: Item due yesterday
- **GIVEN** an item whose due timestamp occurred yesterday at 23:59:59 PM local time
- **WHEN** the item is evaluated today
- **THEN** the status label SHALL be "Overdue" with overdue duration of 1 day

### Requirement: Disambiguated document rotation semantics
The system SHALL treat document and extract scheduling as incremental reading rotations rather than memory retrieval tests. Documents SHALL NOT present 1-4 recall rating buttons or evaluate memory retrievability.

#### Scenario: Completing a reading session on a document
- **GIVEN** an open document in reading or review mode
- **WHEN** the user concludes reading the current passage
- **THEN** the system SHALL offer reading interval options (e.g. Next in 3 days, Next in 7 days, Finished)
- **AND** the system SHALL NOT prompt for Again/Hard/Good/Easy recall ratings
- **AND** the document's reading position SHALL be preserved in SQLite

### Requirement: Configured document revisit interval

Standard reading revisit SHALL use the persisted validated 1–365 day interval, default 7. Continuing reading SHALL preserve existing dates. Explicit postpone dates SHALL take precedence.

#### Scenario: Changing the default revisit interval

- **GIVEN** a document with a saved future date
- **WHEN** the user changes the interval to 14, restarts, and explicitly requests a standard revisit on a different document
- **THEN** the second document is scheduled 14 days from the action, the first date is preserved and neither change updates flashcard recall history

### Requirement: New items retain immediate eligible availability

New in-queue documents, cards, clozes and extracts SHALL be eligible immediately under current filters when they have no future schedule. Opt-outs and explicit future dates SHALL be respected.

#### Scenario: First interaction after import

- **WHEN** the user imports a new in-queue document and creates a card
- **THEN** both are available for their initial activity when eligible
- **AND** reading progress and first card recall are recorded by their respective workflows
