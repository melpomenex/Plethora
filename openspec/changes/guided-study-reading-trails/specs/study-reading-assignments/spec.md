## Purpose

Give Study Plan learners ordered, durable reading material that teaches objectives and can be resumed offline.

## ADDED Requirements

### Requirement: Versioned source-grounded reading assignments
The application SHALL store bounded reading passages with a plan version, topic, source revision, learning objectives, and canonical evidence references. It SHALL validate eligible sources, preserve extract scope, and disclose incomplete objective coverage.

#### Scenario: Backfill an existing version
- **WHEN** a learner prepares reading from an existing published version
- **THEN** the application expands eligible evidence into ordered, deduplicated passages and reports coverage gaps without altering the published curriculum.

#### Scenario: Author a passage
- **WHEN** a learner selects a bounded passage from eligible source material for a topic
- **THEN** the system verifies the selected text and saves it as an assigned range for that topic.

### Requirement: Persist independent reading progress
The application SHALL transact manifest and session updates against their saved revision and persist explicit completion independently of topic mastery.

#### Scenario: Update a plan and resume a session
- **WHEN** a plan receives a new version and the learner returns to Guided Reading
- **THEN** the new version has its own assignments and progress, and the previous version retains its historical records.
