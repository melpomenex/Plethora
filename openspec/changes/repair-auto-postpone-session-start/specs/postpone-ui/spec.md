## REMOVED Requirements

### Requirement: Auto-postpone prompt appears on session start
**Reason**: Automatic session recovery replaces the confirmation prompt.
**Migration**: Keep existing manual review and postpone controls; use the automatic session-start summary for feedback.

## ADDED Requirements

### Requirement: Auto-postpone runs without a confirmation prompt
When Auto-Postpone is enabled and an application session starts with overdue items, the system SHALL automatically process eligible items without a blocking prompt. The system SHALL present a nonblocking summary containing discovered, postponed, skipped, failed, and remaining-overdue counts. Users SHALL retain existing manual controls to review or postpone overdue items independently.

#### Scenario: Eligible backlog is processed without confirmation
- **WHEN** Auto-Postpone is enabled and the new application session discovers overdue eligible items
- **THEN** they are processed automatically and no confirmation modal is required

#### Scenario: No overdue items
- **WHEN** Auto-Postpone is enabled and no eligible overdue items exist
- **THEN** no postponement runs and no completion prompt is shown

#### Scenario: User reviews overdue content manually
- **WHEN** a user chooses to review overdue content or uses a manual postpone control
- **THEN** that choice remains available independently of the automatic setting

## MODIFIED Requirements

### Requirement: Postpone statistics are displayed after batch operations
After a manual or automatic batch operation completes, the system SHALL display a nonblocking summary that distinguishes discovered, postponed, skipped, failed, and still-overdue items. It SHALL include the future scheduling distribution when items were postponed. Only persisted successes SHALL count as postponed.

#### Scenario: Summary reflects mixed outcomes
- **WHEN** a batch completes with successful, skipped, and failed items
- **THEN** the summary shows each outcome count and the remaining overdue count accurately

#### Scenario: Summary after postpone-all
- **WHEN** a manual or automatic batch completes with items postponed and other items skipped or failed
- **THEN** the nonblocking summary shows persisted successes, skipped items, failures, still-overdue items, and the future-date distribution

#### Scenario: Summary does not claim uncommitted work
- **WHEN** persistence fails before an item is committed
- **THEN** that item is counted as failed and is not included in the postponed count
