## ADDED Requirements

### Requirement: Sync operations shall carry a server-readable envelope over an encrypted payload
Each synchronized change SHALL be transmitted as a plaintext envelope — an opaque key tag, a clock value, and an operation kind — alongside an encrypted payload. The server SHALL be able to order and deduplicate operations using only the envelope, and SHALL never be able to read the payload.

#### Scenario: Server orders two operations for the same entity
- **WHEN** two operations bearing the same key tag arrive with different clock values
- **THEN** the system SHALL retain the operation with the greater clock value and discard the other
- **THEN** the system SHALL make that decision using only the envelope, without decrypting either payload

#### Scenario: Key tags are opaque and non-correlatable
- **WHEN** the same entity is synchronized in two different rooms
- **THEN** its key tag SHALL differ between those rooms
- **THEN** the key tag SHALL NOT permit recovering the entity identifier or the domain it belongs to

#### Scenario: Payload format is unchanged from the previous transport
- **WHEN** an operation payload is encrypted for transmission
- **THEN** it SHALL use the same authenticated-encryption format and room-derived key as the previous transport, so that a payload is interchangeable between transports during migration

### Requirement: The server shall retain at most one live operation per entity
For upsert and delete operations, the server SHALL retain exactly one row per (room, key tag) pair — the one with the greatest clock. Server storage SHALL therefore be a function of the number of live entities, not of the number of operations ever performed.

#### Scenario: Repeated edits to one entity do not accumulate
- **WHEN** the same entity is updated many times over an extended period
- **THEN** the server SHALL hold exactly one row for that entity
- **THEN** total room storage SHALL NOT grow as a function of elapsed time or operation count

#### Scenario: A superseded operation is not delivered
- **WHEN** a client performs a cold start after an entity has been updated repeatedly
- **THEN** the client SHALL receive that entity at most once

#### Scenario: Append operations are exempt from compaction
- **WHEN** an operation is of the append kind (an immutable log entry such as a review result)
- **THEN** the server SHALL retain it independently rather than collapsing it against another operation sharing its key tag

### Requirement: Clients shall synchronize by cursor in bounded, resumable pages
Clients SHALL request changes by supplying a cursor and receive a bounded page of operations, and SHALL persist the cursor only after a page has been fully projected to local storage.

#### Scenario: Cold start on a large library
- **WHEN** a device with no prior cursor synchronizes a room containing a large library
- **THEN** the system SHALL retrieve changes in bounded pages rather than as a single whole-document transfer
- **THEN** peak memory during the cold start SHALL be bounded by the page size rather than by the size of the library

#### Scenario: Cold start is interrupted
- **WHEN** the application is terminated part-way through a cold start
- **THEN** on restart the system SHALL resume from the last fully-projected page
- **THEN** the system SHALL NOT restart the transfer from the beginning

#### Scenario: Incremental synchronization after a cold start
- **WHEN** a device that has completed a cold start reconnects
- **THEN** it SHALL receive only operations recorded after its stored cursor

### Requirement: A device offline for any duration shall converge on reconnect
The system SHALL NOT impose a maximum offline duration after which a device silently fails to converge. Reconnection SHALL produce the current state regardless of how long the device was absent.

#### Scenario: Device returns after a prolonged absence
- **WHEN** a device reconnects after being offline longer than any server-side retention window
- **THEN** the system SHALL deliver the room's current live state to that device
- **THEN** the device SHALL converge with its peers for all upsert and delete operations

#### Scenario: Reconnection does not resurrect deleted entities
- **WHEN** a long-absent device reconnects holding entities deleted elsewhere while it was offline
- **THEN** those entities SHALL be removed locally rather than republished

### Requirement: The server shall reclaim operations every device has already read
The server SHALL track a per-device cursor and SHALL delete append operations, and sufficiently aged delete operations, once every non-stale device in the room has read past them. Upsert operations SHALL never be reclaimed.

#### Scenario: All devices have read past an append operation
- **WHEN** every non-stale device in a room reports a cursor beyond a stored append operation
- **THEN** the server SHALL delete that operation

#### Scenario: An abandoned device does not block reclamation
- **WHEN** a device has not reported a cursor for longer than the configured staleness window
- **THEN** the server SHALL exclude it when computing the reclamation threshold

#### Scenario: Live state is never reclaimed
- **WHEN** reclamation runs
- **THEN** no upsert operation SHALL be deleted, regardless of device cursors

### Requirement: All sync requests shall be authenticated
Every request to the sync service SHALL be authenticated with a key derived from the room secret. Knowledge of a room identifier alone SHALL NOT grant read or write access.

#### Scenario: Unauthenticated request
- **WHEN** a request arrives without a valid authentication tag
- **THEN** the system SHALL reject it and SHALL NOT disclose whether the room exists

#### Scenario: Tampered request
- **WHEN** a request body is modified after its authentication tag was computed
- **THEN** the system SHALL reject the request

### Requirement: The sync service shall operate within a fixed small resource budget
The service SHALL hold no per-room document state in memory, SHALL bound per-request and per-page sizes, and SHALL sustain normal operation on a single-core host with 1 GB of memory shared with other services.

#### Scenario: Many rooms are active
- **WHEN** many rooms are synchronizing concurrently
- **THEN** service memory SHALL remain bounded and SHALL NOT scale with the number or size of rooms
- **THEN** the service SHALL NOT materialize any room's full document in memory

#### Scenario: An oversized request arrives
- **WHEN** a client submits a request exceeding the configured body or page limits
- **THEN** the system SHALL reject it rather than buffering it

#### Scenario: A room becomes idle
- **WHEN** every device disconnects from a room
- **THEN** the system SHALL retain no in-memory state for that room

### Requirement: Existing merge semantics shall be preserved across the transport change
The system SHALL continue to resolve conflicts using the merge mode each entity type already relies on — whole-row last-writer-wins, field-level last-writer-wins, or append-only — evaluated against the existing clock format.

#### Scenario: Whole-row conflict
- **WHEN** two devices edit the same row while disconnected and then reconnect
- **THEN** the row with the greater clock SHALL win, matching the prior behaviour

#### Scenario: Field-level conflict
- **WHEN** two devices change different independently-clocked fields of the same row while disconnected
- **THEN** each field SHALL resolve against its own clock rather than the whole row being overwritten

#### Scenario: Append-only entity
- **WHEN** the same immutable log entry is delivered more than once
- **THEN** the system SHALL apply it once and treat repeat deliveries as no-ops
