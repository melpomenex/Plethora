## MODIFIED Requirements

### Requirement: Video extract filters SHALL be applied server-side

The video-extract queue-candidate query SHALL apply the canonical queue-membership and eligibility predicate in SQL rather than fetching all video extracts and filtering in Rust. The predicate MUST require `queue_status = 'queued'`, MUST require an active parent document, and MUST select only rows where either the row is unreviewed with no scheduled date or its scheduled date is at or before the supplied cutoff. A queued reviewed row with no scheduled date MUST NOT be selected as due.

The separate library-wide `get_all_video_extracts` operation SHALL return all rows in the requested collection regardless of queue status or due date. Queue and library filters MUST NOT be conflated.

#### Scenario: New video extracts fetched with SQL filter
- **WHEN** the Queue retrieves video-extract candidates
- **THEN** the SQL query applies the canonical membership, parent-active, and eligibility conditions
- **AND** only matching rows are returned
- **AND** the caller does not perform a second Rust-side eligibility filter

#### Scenario: Not-queued and future rows excluded
- **WHEN** the collection contains a not-queued extract, a queued extract scheduled after the cutoff, and a queued extract due at the cutoff
- **THEN** only the due extract is returned to the Queue
- **AND** all three remain available to the library-wide query

#### Scenario: Reviewed row without a date
- **WHEN** a queued reviewed extract has no next review date
- **THEN** it is not returned as a queue candidate
- **AND** no fallback treats a missing date as due
