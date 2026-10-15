# postpone-ui Specification

Defines the user-facing controls and feedback for single-item, batch, and automatic postpone operations.

## Purpose

The postpone interface gives users understandable manual controls and clear feedback when scheduled work is moved, without hiding outcomes or requiring an unnecessary interruption.

## Requirements

### Requirement: Single-item postpone uses algorithm-aware computation
The queue context menu "Postpone" action SHALL compute the new interval using the postpone engine instead of adding a fixed number of days. The context menu SHALL show the computed increase and allow the user to confirm or cancel.

#### Scenario: Context menu shows computed postpone result
- **WHEN** a user right-clicks a learning item in the queue and selects "Postpone"
- **THEN** a dialog SHALL show the computed new interval (e.g., "Postpone by 30 days? New interval: 60 days") with Confirm and Cancel buttons

#### Scenario: Postpone document from queue
- **WHEN** a user right-clicks a document in the queue and selects "Postpone"
- **THEN** the system SHALL use topic parameters to compute the increase and display the result

### Requirement: Postpone-all action postpones eligible items in batch
The queue toolbar SHALL include a "Postpone All" button that postpones all eligible items (both learning items and documents) in the current queue view. The system SHALL show a confirmation dialog with the count of items to be postponed before executing.

#### Scenario: Postpone-all with confirmation
- **WHEN** a user clicks "Postpone All" with 25 eligible items in the queue
- **THEN** a dialog SHALL show "Postpone 25 items?" with Confirm and Cancel buttons

#### Scenario: Postpone-all skips ineligible items
- **WHEN** a user clicks "Postpone All" with 40 items in the queue, 15 of which pass eligibility checks
- **THEN** the dialog SHALL show "Postpone 25 items?" (40 total minus 15 skipped) and upon confirmation, only the 25 eligible items SHALL have their intervals increased

#### Scenario: Postpone-all with empty queue
- **WHEN** a user clicks "Postpone All" with no items in the queue
- **THEN** the action SHALL be disabled or show a message "No items to postpone"

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

### Requirement: Postpone settings are configurable in the learning settings panel
The learning settings page SHALL include a "Postpone" section with controls for: auto-postpone toggle, simple mode toggle, randomization toggle, item/topic increase percentages, min/max increase limits, eligibility thresholds, and floor/cap values. All controls SHALL include labels and tooltips explaining what each parameter does.

#### Scenario: Settings panel displays all postpone parameters
- **WHEN** a user navigates to Settings > Learning > Postpone
- **THEN** all postpone parameters SHALL be displayed with their current values and the ability to modify them

#### Scenario: Settings are validated before saving
- **WHEN** a user sets itemMinIncrease greater than itemMaxIncrease
- **THEN** the system SHALL show a validation error and SHALL NOT save the invalid configuration

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
