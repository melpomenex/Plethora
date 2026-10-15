## Purpose

Defines how a new application session detects, plans, and applies automatic recovery of overdue scheduled content. It keeps this behavior independent of Queue and Schedule rendering while making its scope, retries, and results observable.

## ADDED Requirements

### Requirement: Automatic postponement runs once after a new application session is ready
The system SHALL define a session start as the first main application-shell startup in a newly launched application process. When Auto-Postpone is enabled, the system SHALL run the operation once after persisted settings, the native or browser data backend, and the active collection scope are ready. Opening or reopening Queue or Schedule, switching tabs or collections, refreshing a view, and returning from the background SHALL NOT start another operation in that same process.

#### Scenario: Cold launch with the option enabled
- **WHEN** the main application shell starts in a new process, settings and backend are ready, and Auto-Postpone is enabled
- **THEN** the active collection is checked and eligible overdue content is processed without requiring a Queue or Schedule component to mount

#### Scenario: Direct Schedule entry
- **WHEN** the app starts with Schedule as the first visible surface
- **THEN** the same session-start operation runs before Schedule presents its refreshed persisted schedule

#### Scenario: Queue reopen and background return
- **WHEN** Queue is reopened or the app returns from the background after the operation has run
- **THEN** no additional automatic postponement is started in that process

#### Scenario: Settings are still hydrating
- **WHEN** backend startup finishes before persisted settings hydration
- **THEN** the system waits for hydration and uses the hydrated Auto-Postpone value rather than a default value

### Requirement: Candidate detection uses persisted scheduling data and explicit scope
The system SHALL derive candidates from persisted scheduling data for the active collection at session start, independently of visible rows, search, filters, or cached Queue and Document state. A scheduled item is overdue only when its valid due calendar date in the user's local timezone is strictly earlier than the local current date. Date-only values SHALL be interpreted as local calendar dates. Missing or invalid dates, unscheduled new items, suspended learning items, archived or dismissed documents, dismissed extracts, and inactive or deleted records SHALL NOT be postponed. Ineligible overdue records that can be identified SHALL be reported with a skip reason.

#### Scenario: New and future items are not overdue
- **WHEN** a new item has no due date, or a scheduled item is due today or later in the user's local timezone
- **THEN** neither item is selected for postponement

#### Scenario: Inactive overdue items are excluded
- **WHEN** overdue records are suspended, archived, dismissed, inactive, or deleted
- **THEN** they are not mutated, and any persisted record reported as skipped includes its reason

#### Scenario: Filtered Queue does not limit candidates
- **WHEN** only a subset of overdue rows is visible because of a Queue filter or search
- **THEN** detection still considers the full active-collection persisted candidate population

#### Scenario: Collection scope is respected
- **WHEN** more than one collection has overdue items
- **THEN** only items in the collection active when the session-start operation begins are considered

### Requirement: Automatic execution is type-aware, bounded, and idempotent
The system SHALL plan future due dates for eligible learning items, documents, and supported scheduled extracts. Every successful target date SHALL be later than the user's current local date. Planning SHALL distribute postponed items across the next 30 calendar days, accounting for already scheduled workload and using a stable tie-break so a backlog is not placed on one day. Execution SHALL apply a coherent type-aware batch with per-item outcomes, and a repeated or concurrent execution SHALL NOT move an item that has already received a future date. An entity type that cannot be safely scheduled or synchronized SHALL be reported as skipped with its reason.

#### Scenario: Old overdue items are recovered into the future
- **WHEN** an eligible item has a historical due date far earlier than today
- **THEN** its applied due date is in the future relative to today, regardless of whether adding its calculated interval to the historical date would still leave it overdue

#### Scenario: Backlog is distributed
- **WHEN** 49 eligible overdue items are processed and the next 30 days have no existing workload
- **THEN** all 49 receive future dates distributed across multiple days in the 30-day window rather than all being assigned to tomorrow

#### Scenario: Concurrent or repeated request
- **WHEN** two session-start requests overlap or the same request is retried after a partial item failure
- **THEN** successfully updated items are not postponed a second time, and remaining failures are reported accurately

#### Scenario: Unsupported scheduled entity
- **WHEN** an overdue scheduled entity lacks a safe type-specific persistence or synchronization path
- **THEN** it remains unchanged and is counted as skipped with an explicit reason

### Requirement: Automatic scheduling preserves learning history and synchronizes date changes
Automatic postponement SHALL change only the due-date fields required to move eligible content. It SHALL preserve FSRS stability, difficulty, retrievability, interval and state, review counts, last-review timestamps, and review history. Successful date changes SHALL use the application's normal synchronization journal so connected devices and schedule views can observe the update.

#### Scenario: FSRS state remains unchanged
- **WHEN** an eligible learning item is postponed
- **THEN** its due date changes while its memory state, review count, interval, last review date, and review history remain unchanged

#### Scenario: Persisted schedule refresh
- **WHEN** a batch completes successfully
- **THEN** Queue, Schedule, and synchronization reads observe the committed due dates and updated overdue count

### Requirement: Automatic operation reports complete per-item results
The system SHALL make a nonblocking result available after an automatic operation. The result SHALL include discovered, postponed, skipped, failed, and still-overdue counts plus the future-date distribution when items were postponed. Skips SHALL include reason counts, including unsupported video extracts, invalid dates, inactive or suspended content, and plan-rule exclusions. Failures SHALL be surfaced; an incomplete or failed operation SHALL NOT be presented as fully successful.

#### Scenario: Successful batch summary
- **WHEN** a batch discovers eligible and ineligible overdue records and commits its plan
- **THEN** the user sees discovered, postponed, skipped, failed, and remaining-overdue counts, skip reasons, and distribution information when applicable

#### Scenario: Backend failure
- **WHEN** candidate loading or batch persistence fails
- **THEN** the user receives a nonblocking error summary and no uncommitted item is counted as postponed
