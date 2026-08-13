## MODIFIED Requirements

### Requirement: Tracking Reading Time
The system MUST track the time spent reading a document for accurate scheduling metrics. The time recorded MUST be *active* time as defined by the `item-time-tracking` capability — idle periods, periods when the application window is not focused, and periods when another item is in the foreground MUST NOT be counted. Time MUST accrue from reading in the Reader as well as from reading in the Queue, so that reading a document without rating it still increases its recorded total.

#### Scenario: Time tracking
- **Given** the user opens a document
- **When** the user rates the document
- **Then** the active time spent viewing the document since it was opened (or last rated) should be recorded and added to the document's `total_time_spent`

#### Scenario: Reading without rating still accrues time
- **Given** the user opens a document in the Reader
- **When** the user reads actively for a period and navigates away without rating the document
- **Then** the active time spent should be recorded and added to the document's `total_time_spent`

#### Scenario: Idle time is excluded
- **Given** the user opens a document and reads for a short period
- **When** the document is left open and untouched past the inactivity threshold before the user rates it
- **Then** the idle period should be excluded from the time added to the document's `total_time_spent`
