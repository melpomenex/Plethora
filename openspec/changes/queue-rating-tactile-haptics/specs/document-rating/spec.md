## MODIFIED Requirements

### Requirement: Document Review and Navigation
The system SHALL support rating documents during reading, which triggers rescheduling, immediate tactile haptic feedback, and navigation.

#### Scenario: User rates a document after reading
- **WHEN** the user selects a rating (Again, Hard, Good, Easy) via the `HoverRatingControls`, floating Rating Orbs, or keyboard shortcuts
- **THEN** the application should submit the rating to the backend with the time spent
- **AND** the application should emit grade-specific tactile haptic feedback through the device's vibration motors
- **AND** the backend should reschedule the document using FSRS
- **AND** the application should automatically navigate to the next document in the queue
