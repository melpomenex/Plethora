## ADDED Requirements

### Requirement: First reviewed timestamp column
The `documents` and `learning_items` tables SHALL have a `first_reviewed_at` DATETIME column that records the timestamp of the item's first review.

#### Scenario: First review populates timestamp
- **WHEN** a document or learning item is reviewed for the first time
- **THEN** the `first_reviewed_at` column SHALL be set to the current timestamp

#### Scenario: Subsequent reviews do not overwrite
- **WHEN** a document or learning item is reviewed again after the first review
- **THEN** the `first_reviewed_at` column SHALL retain its original value

### Requirement: First reviewed display in UI
The "First Reviewed" timestamp SHALL be displayed in the Document Inspector, Review Transparency Panel, and Analytics views.

#### Scenario: Document Inspector shows first reviewed date
- **WHEN** the user opens Document Inspector for a document that has been reviewed
- **THEN** the inspector SHALL display the "First Reviewed" date

#### Scenario: Never-reviewed item shows no date
- **WHEN** the user opens Document Inspector for a document that has never been reviewed
- **THEN** the "First Reviewed" field SHALL display "Not yet reviewed" or be absent

### Requirement: Backfill from existing review log
The migration adding `first_reviewed_at` SHALL backfill the column from existing `review_log` data using `MIN(review_date)` per item.

#### Scenario: Existing items get backfilled dates
- **WHEN** the migration runs on a database with existing review_log entries
- **THEN** each document and learning_item with review history SHALL have `first_reviewed_at` set to its earliest review date
