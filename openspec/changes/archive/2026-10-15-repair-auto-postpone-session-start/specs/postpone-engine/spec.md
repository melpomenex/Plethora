## ADDED Requirements

### Requirement: Overdue recovery produces future workload-balanced dates without changing FSRS state
When the postpone engine recovers overdue scheduled content, it SHALL anchor proposed dates to the current local date rather than shifting an item's historical due date. It SHALL assign eligible items to dates from tomorrow through 30 days ahead, choosing lower-workload dates first and using a stable tie-break. Execution SHALL change due-date fields only and SHALL NOT change intervals, memory state, review metadata, or review history.

#### Scenario: Historical due date remains overdue after a simple shift
- **WHEN** an eligible item's due date is September 1, today is October 10, and the ordinary postpone calculation yields a seven-day increase
- **THEN** the recovery plan assigns a date later than October 10 instead of September 8

#### Scenario: Large backlog does not land on one day
- **WHEN** 49 eligible items are planned with no existing workload in the next 30 days
- **THEN** their proposed dates cover multiple days in that window and each target is later than today

#### Scenario: Scheduling history is preserved
- **WHEN** a future recovery date is applied to an FSRS-scheduled learning item
- **THEN** only its due-date field and ordinary modification/synchronization metadata change
