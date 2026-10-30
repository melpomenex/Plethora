## Purpose

Give video segments an independent, understandable viewing and review lifecycle, preserving parent scheduling and committing each rating intent exactly once.

## ADDED Requirements

### Requirement: Seen and reviewed are distinct persisted states
A video extract SHALL persist first/last seen timestamps separately from its review history. Successful opening/playing SHALL record seen without recording a grade, updating memory, increasing review counters, or changing due dates. New SHALL mean unseen with zero committed reviews; seen but unreviewed SHALL show Seen and Not reviewed; reviewed SHALL require at least one committed grade. Due SHALL be an independent timestamp-derived badge.

#### Scenario: Open without rating
- **WHEN** a new extract successfully opens and the application restarts
- **THEN** it remains Seen and Not reviewed with unchanged review count, memory, and due date

#### Scenario: Legacy and failed playback
- **WHEN** an older reviewed row has no seen timestamps or a new extract fails to open
- **THEN** the older row remains Reviewed and the failed new row does not acquire a fabricated seen/review event

### Requirement: Extracts can be rated independently from ordinary views and review sessions
Ordinary extract views and dedicated extract review sessions SHALL expose Again, Hard, Good, and Easy for the selected extract, including never-rated extracts. Extract grades SHALL update only that extract's history/schedule, and parent-document grades SHALL NOT grade or reschedule its extracts. New extracts SHALL be reachable under existing new-item budgets.

#### Scenario: Parent and child independence
- **WHEN** the user grades a parent document then separately grades one extract
- **THEN** each operation changes only its own scheduling history and the other remains unchanged

### Requirement: One rating intent commits one event and advances once
Each rating intent SHALL have a retry-stable operation identity. Persistence SHALL atomically append one review event, update the extract's scheduling/counters, and return the committed record/receipt. Repeating the same operation/payload SHALL return the same result without incrementing counts; reusing its identity with different payload SHALL fail. Controls SHALL prevent duplicate activation while pending and show recoverable failures. A successful result SHALL advance its owning session once.

#### Scenario: One click through child and parent
- **WHEN** a user clicks Good in a dedicated review session
- **THEN** exactly one backend rating operation commits one event, review_count increases by one, and the session advances once

#### Scenario: Timeout retry and rapid activation
- **WHEN** a committed rating loses its response and is retried, or Enter/double-click repeats while pending
- **THEN** no duplicate event/counter increment occurs and the canonical result is shown once

### Requirement: Video lifecycle preserves data across migration backups and offline use
Existing review aggregates SHALL be preserved without fabricating historical events or viewing history. New fields/events SHALL participate in supported backup/restore and local adapters with absent-field defaults. Locally available extract metadata and ratings SHALL remain writable offline; remote media playback availability SHALL be distinguished from local review persistence.

#### Scenario: Upgrade and restore offline
- **WHEN** an existing collection is upgraded, backed up, restored, and an extract is rated offline
- **THEN** original counters/history remain intact and the new committed event survives restart and supported backup/restore
