## MODIFIED Requirements

### Requirement: Closing a document tab releases the resources that tab solely owned

Closing a document tab SHALL dispose every expensive resource whose only owner was that tab, making it eligible for reclamation without depending on garbage-collection timing or on process restart. Disposal SHALL cover at minimum: the parsed document and any worker-side state it owns, rendering surfaces and decoded page data, cached extracted text, object URLs created for the document, event listeners, observers, timers, subscriptions, in-flight asynchronous work, and any backend state held on that tab's behalf.

Disposal SHALL include document-scoped entries in module-global caches (including reflow object URL caches and in-flight reflow render tasks keyed by document id). Disposal of one tab's resources SHALL NOT affect any other open tab.

#### Scenario: Closing a tab releases its document

- **WHEN** a document tab is closed
- **THEN** the document's parsed representation and any worker-side state it owns are explicitly destroyed
- **AND** no rendering surface, decoded page, cached text, or object URL created for that document remains allocated

#### Scenario: In-flight loading is abandoned on close

- **WHEN** a document tab is closed while its document is still loading
- **THEN** the pending load is cancelled
- **AND** no further backend requests are issued on that tab's behalf
- **AND** no error surfaces to the user from the cancelled load

#### Scenario: Closing one tab leaves siblings intact

- **WHEN** one of several open document tabs is closed
- **THEN** every remaining tab continues to render, scroll, and respond to input unchanged
- **AND** no remaining tab's document is destroyed

#### Scenario: Memory returns after closing all documents

- **WHEN** four document tabs are opened and then all are closed, and the application is allowed to settle on a Linux release build
- **THEN** web-content proportional memory returns to within the configured post-close allowance of the pre-open idle measurement
- **AND** total proportional memory does not exceed the measurement taken while the tabs were open

#### Scenario: Document-scoped object URLs are revoked on close

- **WHEN** a document tab that displayed reflow figures is closed
- **THEN** every object URL created for that document's reflow assets is revoked
- **AND** the reflow object URL cache contains no entries for that document id

### Requirement: Repeated open/close cycles reach a bounded steady state

Repeatedly opening and closing documents SHALL NOT accumulate memory without bound. After a warm-up period, memory across successive cycles SHALL converge toward a bounded steady state rather than growing with each cycle, both for a single document opened repeatedly and for multiple documents opened in rotation.

On Linux release builds, the web-content proportional memory after the final cycle stage SHALL be within the configured cycle-ratchet allowance of the warmed-up idle measurement.

#### Scenario: Single document opened and closed repeatedly

- **WHEN** the same document is opened and closed for the configured number of cycles
- **THEN** the measured memory after the final cycle does not exceed the warmed-up steady state by more than the configured ratchet allowance
- **AND** the trend across the post-warm-up cycles is not consistently increasing

#### Scenario: Multiple documents opened and closed repeatedly

- **WHEN** several distinct documents are opened and closed in rotation for the configured number of cycles
- **THEN** each cycle does not permanently add another document's worth of memory
- **AND** the memory after the final cycle is within the configured ratchet allowance of the warmed-up steady state

#### Scenario: Live object counts do not grow with cycles

- **WHEN** the number of open/close cycles is doubled
- **THEN** the count of live reader instances, rendering surfaces, and document objects after the cycles is unchanged
- **AND** it equals the count expected for the number of tabs actually open
