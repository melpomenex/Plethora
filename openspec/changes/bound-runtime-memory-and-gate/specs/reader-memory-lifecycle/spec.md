## Purpose

Defines how an open document tab acquires, holds, and releases memory: how document bytes reach the renderer, what a tab close or eviction must release, how many expensive readers may be simultaneously resident, and what reading state survives so a reconstructed reader is indistinguishable from one that stayed alive.

## ADDED Requirements

### Requirement: Opening a document does not materialize the whole file in renderer memory

On desktop platforms, displaying a document SHALL NOT require the document's complete byte content to be resident simultaneously in the renderer. The reader SHALL obtain document bytes through a bounded-range mechanism that fetches only the portions it needs, and SHALL NOT hold more than one copy of any fetched range at a time.

A whole-file path MAY remain as an explicit fallback for sources the range mechanism cannot serve. When the fallback is used, that fact SHALL be observable in diagnostics so a silent regression to whole-file loading is detectable.

Range access SHALL be subject to the same authorization scoping as the existing document-file access path: a range request for a document the caller is not authorized to read SHALL be rejected, and a request whose underlying file has changed identity since the source was resolved SHALL fail rather than return mixed content.

#### Scenario: Large document opens without a proportional renderer allocation

- **WHEN** a document substantially larger than the working set needed to render its first page is opened
- **THEN** the renderer's private memory increase after the first page is displayed is bounded by the reader's working set rather than growing in proportion to the file size
- **AND** the document renders correctly

#### Scenario: Only requested ranges are transferred

- **WHEN** a reader displays a page in the middle of a large document without visiting the intervening pages
- **THEN** only the ranges the reader requested are transferred from the backend
- **AND** the total transferred bytes are less than the file size

#### Scenario: Fallback to whole-file loading is visible

- **WHEN** a document source cannot be served through the range mechanism and the reader falls back to whole-file loading
- **THEN** the document still opens and renders correctly
- **AND** the fallback is recorded in the reader's diagnostics with the reason

#### Scenario: Unauthorized or changed source is refused

- **WHEN** a range is requested for a document that is not an authorized source, or the underlying file's identity has changed since the source was resolved
- **THEN** the request fails with an attributed error
- **AND** no bytes from the changed or unauthorized file are delivered to the reader

#### Scenario: Existing reader behavior is preserved

- **WHEN** a password-protected document, a document with an outline, and a document requiring text selection are opened through the range mechanism
- **THEN** the password prompt, outline extraction, text selection, and rendered output behave as they did under whole-file loading

### Requirement: Closing a document tab releases the resources that tab solely owned

Closing a document tab SHALL dispose every expensive resource whose only owner was that tab, making it eligible for reclamation without depending on garbage-collection timing or on process restart. Disposal SHALL cover at minimum: the parsed document and any worker-side state it owns, rendering surfaces and decoded page data, cached extracted text, object URLs created for the document, event listeners, observers, timers, subscriptions, in-flight asynchronous work, and any backend state held on that tab's behalf.

Disposal of one tab's resources SHALL NOT affect any other open tab.

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

- **WHEN** four document tabs are opened and then all are closed, and the application is allowed to settle
- **THEN** total proportional memory returns to within the configured post-close tolerance of the pre-open idle measurement
- **AND** it does not exceed the measurement taken while the tabs were open

### Requirement: Repeated open/close cycles reach a bounded steady state

Repeatedly opening and closing documents SHALL NOT accumulate memory without bound. After a warm-up period, memory across successive cycles SHALL converge toward a bounded steady state rather than growing with each cycle, both for a single document opened repeatedly and for multiple documents opened in rotation.

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

### Requirement: The number of simultaneously resident readers is bounded

The system SHALL limit how many expensive document readers are simultaneously mounted, independently of the general limit on resident tabs. The limit SHALL cover the active reader plus a bounded number of recently used readers, SHALL be explicitly configurable, and SHALL evict the least recently used reader beyond the limit.

Eviction SHALL release the same resources a close releases. An evicted tab SHALL remain present in the workspace with its identity, title, and lightweight state intact.

#### Scenario: Opening past the limit evicts the least recently used reader

- **WHEN** more reader tabs are activated than the configured reader limit allows
- **THEN** the least recently used reader beyond the limit is unmounted and its resources released
- **AND** every tab, including the evicted one, remains listed in the workspace

#### Scenario: Readers within the limit stay warm

- **WHEN** the user alternates between two reader tabs with a reader limit of two or more
- **THEN** neither reader is unmounted
- **AND** switching between them does not reload either document

#### Scenario: Non-reader tabs are unaffected by the reader limit

- **WHEN** the reader limit is reached and a non-reader tab is activated
- **THEN** no reader is evicted on account of the non-reader tab
- **AND** the general resident-tab limit continues to govern non-reader tabs

#### Scenario: Four open reader tabs stay within the memory budget

- **WHEN** four representative reader tabs are open simultaneously
- **THEN** total proportional memory is within the recorded four-tab budget
- **AND** it does not resemble the pre-change multi-gigabyte footprint

### Requirement: Reactivating an evicted reader restores its reading state

Activating a tab whose reader was evicted SHALL reconstruct the reader and restore the reading state the user expects: the document, the reading position (page or location), the reader's display settings, and the document's outline state. The user SHALL NOT lose their place, and SHALL NOT be returned to the beginning of the document.

#### Scenario: Position survives eviction

- **WHEN** a reader tab is evicted while positioned partway through a document and is later reactivated
- **THEN** the reader reopens at the same page or location
- **AND** the reader's display settings are the ones in effect before eviction

#### Scenario: Eviction does not lose unsaved reading progress

- **WHEN** a reader's position advances and the tab is evicted before the next scheduled position save
- **THEN** the position at the moment of eviction is persisted as part of the eviction
- **AND** reactivating the tab restores that position

#### Scenario: Reactivation is indistinguishable from an uninterrupted session

- **WHEN** an evicted reader tab is reactivated
- **THEN** its rendered content, position, selection-capability state, and available actions match a reader that had stayed mounted
- **AND** any additional load time is confined to reconstructing the reader

### Requirement: Backend state held for a document is released when the document is no longer open

Backend state retained on behalf of an open document — cached buffers, per-document handles, background tasks, and channels — SHALL be released when no tab holds that document open. Backend caches that survive across documents SHALL be explicitly bounded.

#### Scenario: Per-document backend state is dropped on close

- **WHEN** the last tab holding a document is closed
- **THEN** backend state retained for that document is dropped
- **AND** background tasks started on its behalf are cancelled

#### Scenario: Cross-document backend caches are bounded

- **WHEN** documents are opened until any cross-document backend cache would exceed its configured bound
- **THEN** the cache evicts entries to stay within the bound
- **AND** the eviction does not break any currently open document

#### Scenario: Native memory does not grow with cycles

- **WHEN** the repeated open/close scenario completes
- **THEN** the native process's proportional memory after the final cycle is within the configured ratchet allowance of its warmed-up steady state
