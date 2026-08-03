## ADDED Requirements

### Requirement: Local storage shall be the sole source for migration
The migration SHALL read user data exclusively from the device's local database. The previous transport's replicated document SHALL NOT be treated as an authority; it SHALL first be drained into local storage, and local storage SHALL then seed the new transport.

#### Scenario: Seeding the new transport
- **WHEN** the migration publishes a device's library to the new transport
- **THEN** every published record SHALL be read from the local database
- **THEN** no record SHALL be published directly from the previous transport's replicated document

#### Scenario: Drain precedes seeding
- **WHEN** the migration begins on a device with an existing replicated document
- **THEN** the system SHALL first project every entry of that document into local storage
- **THEN** seeding SHALL NOT begin until the drain has been confirmed complete

### Requirement: The drain shall be verified complete before the migration advances
The system SHALL advance past the drain phase only after every replicated collection has been enumerated, every resulting projection task has completed, and no projection has been dead-lettered during the run.

#### Scenario: A projection fails during the drain
- **WHEN** one or more records fail to project into local storage during the drain
- **THEN** the system SHALL NOT advance to the seeding phase
- **THEN** the system SHALL retry the drain on the next start rather than proceeding

#### Scenario: Drain completeness is recorded per domain
- **WHEN** the drain completes
- **THEN** the system SHALL record, for each synchronized domain, the number of records enumerated and projected
- **THEN** those counts SHALL be available for later verification

### Requirement: Seeding shall be idempotent and safe to interrupt
Seeded records SHALL carry their existing clock values unchanged. Repeating or interrupting the seed SHALL NOT alter any record's content or clock.

#### Scenario: The seed is run twice
- **WHEN** the seeding phase runs a second time over records already seeded
- **THEN** no record SHALL be modified, because each carries a clock no greater than the one already stored

#### Scenario: The seed is interrupted
- **WHEN** seeding is interrupted part-way
- **THEN** the records already seeded SHALL constitute a valid partial state
- **THEN** resuming SHALL complete the remainder without correcting or rewriting what was already seeded

#### Scenario: Clocks are preserved verbatim
- **WHEN** a record is seeded to the new transport
- **THEN** its clock value SHALL be identical to the one stored locally
- **THEN** the system SHALL NOT restamp records with the migration time

### Requirement: Devices on the previous transport shall keep syncing during migration
While the migration is in progress, an upgraded device SHALL publish every mutation to both transports and accept changes from both, so that devices which have not yet upgraded continue to send and receive changes.

#### Scenario: A mixed-version room
- **WHEN** one device has migrated and others have not
- **THEN** changes made on the migrated device SHALL reach the others over the previous transport
- **THEN** changes made on the others SHALL reach the migrated device and be projected locally

#### Scenario: The same change arrives over both transports
- **WHEN** a change is delivered over both transports to the same device
- **THEN** the system SHALL apply it once and treat the duplicate as a no-op

### Requirement: Cutover shall require verified convergence and explicit confirmation
The system SHALL NOT stop using the previous transport until per-domain content digests agree across the room's known devices and the user has explicitly confirmed the cutover.

#### Scenario: Digests disagree
- **WHEN** a device's per-domain digest differs from another device's
- **THEN** the system SHALL NOT offer cutover
- **THEN** the system SHALL surface which domains disagree

#### Scenario: A known device has not checked in
- **WHEN** a device previously seen in the room has not reported since the migration began
- **THEN** the system SHALL surface it as outstanding
- **THEN** cutover SHALL remain available only as an explicit user decision, with its consequence for that device stated plainly

#### Scenario: User confirms cutover
- **WHEN** digests agree and the user confirms
- **THEN** the system SHALL stop publishing to the previous transport
- **THEN** the system SHALL continue reading from it until the teardown step

### Requirement: No previous-transport data shall be deleted before a confirmed teardown
The system SHALL retain the previous transport's local database and any server-side stored frames until a distinct, user-confirmed teardown step that follows a quiescence period.

#### Scenario: Migration is in progress or cut over
- **WHEN** the migration is at any phase before teardown
- **THEN** the previous transport's local database SHALL remain intact
- **THEN** no server-side stored frames SHALL be deleted

#### Scenario: Teardown is offered
- **WHEN** the system has cut over and observed no changes arriving only via the previous transport for the configured quiescence period
- **THEN** the system SHALL offer teardown as an explicit action
- **THEN** the system SHALL offer to create a backup before proceeding

#### Scenario: User declines teardown
- **WHEN** the user declines or defers teardown
- **THEN** the system SHALL continue operating on the new transport with the previous transport's data retained

### Requirement: The migration shall be reversible before teardown
At every phase before teardown, disabling the new transport SHALL return the device to working synchronization on the previous transport with no loss of local data.

#### Scenario: Reverting mid-migration
- **WHEN** the new transport is disabled at any phase before teardown
- **THEN** local data SHALL be unchanged
- **THEN** the device SHALL resume synchronizing over the previous transport

#### Scenario: Reverting after cutover but before teardown
- **WHEN** the new transport is disabled after cutover but before teardown
- **THEN** the previous transport's local database SHALL still be present and usable
- **THEN** changes made while cut over SHALL still be present locally and SHALL republish to the previous transport

### Requirement: Device pairing shall be unaffected by the transport change
The migration SHALL NOT change how users pair devices. The invite payload format, its version, the room identifier format, and the room secret SHALL all be preserved, and no device SHALL be required to re-pair, re-scan, or rotate its secret as a consequence of the migration.

#### Scenario: A previously generated invite is used after migration
- **WHEN** a user scans or pastes an invite code generated before the migration
- **THEN** the receiving device SHALL join the room successfully
- **THEN** the system SHALL NOT require a new invite in a different format

#### Scenario: Pairing a new device after migration
- **WHEN** a user pairs a new device after the migration completes
- **THEN** the pairing steps SHALL be the same as before — display or scan the room invite, or paste the room code
- **THEN** the invite payload SHALL remain at its existing format version

#### Scenario: Additional keys are derived locally
- **WHEN** the new transport requires a key material not previously used
- **THEN** that key SHALL be derived on-device from the room secret the device already holds
- **THEN** the system SHALL NOT transmit it, prompt for it, or require the user to re-establish trust between devices

#### Scenario: A custom sync endpoint is configured
- **WHEN** a user has configured a self-hosted sync endpoint before the migration
- **THEN** the system SHALL carry that configuration forward to the new service rather than silently reverting it to the default

### Requirement: Migration state and progress shall be visible to the user
The system SHALL expose the current migration phase, per-domain progress, and the roster of devices known to the room with their last check-in.

#### Scenario: User opens sync settings during migration
- **WHEN** the user opens sync settings while a migration is in progress
- **THEN** the system SHALL display the current phase and per-domain drain and seed progress
- **THEN** the system SHALL list known devices and when each last reported

#### Scenario: A migration step fails
- **WHEN** any migration step fails or records are dead-lettered
- **THEN** the system SHALL surface the failure with the affected domain and offer a retry
- **THEN** the system SHALL NOT advance the phase or report success
