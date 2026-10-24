## MODIFIED Requirements

### Requirement: Playback Position Restoration
The system SHALL restore the last saved playback position for any audio document or podcast episode when creating a new audio session for that source. Attaching or reopening a player view for an already loaded session SHALL observe its current position rather than repeat restoration. Restoration SHALL complete after metadata/seekability is available regardless of its arrival order, and cold application restoration SHALL remain paused.

#### Scenario: User opens a previously played podcast
- **WHEN** the user opens a podcast episode or audio document they have previously played and explicitly loads it for listening
- **THEN** the session fetches the last saved position from the database
- **AND** the playback head moves to that position as soon as the source is seekable, regardless of whether metadata has already loaded

#### Scenario: User returns to an active podcast
- **WHEN** a podcast continues playing while the user leaves and reopens its source view
- **THEN** the view shows the live session position without reading an older saved position back into the engine

### Requirement: Continuous Position Saving
The system SHALL have one playback-owner persistence schedule that saves changed playing position at least every five seconds and flushes immediately on pause, completed seek, source/part change, stop and orderly lifecycle shutdown. Source-view navigation or unmount SHALL request a coalesced save without ending playback. Persistence failures SHALL retain a dirty checkpoint for bounded retry and SHALL NOT be marked saved prematurely.

#### Scenario: User pauses playback
- **WHEN** the user clicks pause while listening to audio
- **THEN** the system immediately flushes the current timestamp to the database or retains a durable pending native checkpoint if the database is unavailable

#### Scenario: User navigates away from the player
- **WHEN** the user navigates to another page or the source player component unmounts
- **THEN** the current timestamp is flushed through the single playback-owner writer
- **AND** playback and the owner's periodic saving continue without a duplicate timer

#### Scenario: Continuous playback and unchanged pause
- **WHEN** audio plays for one minute without control changes and then remains paused
- **THEN** no more than twelve periodic position commits occur during that playing minute, in addition to explicit lifecycle flushes
- **AND** unchanged paused state causes no periodic database writes

### Requirement: Unified Persistence for Promoted Podcasts
Promoted podcast episodes SHALL preserve consistent positions between episode tracking and the actual promoted audio document. A checkpoint commit SHALL update both representations and the existing document-sync journal atomically when that promoted mapping exists. Standalone episodes SHALL NOT write document positions under synthetic episode IDs. Episode progress SHALL NOT overwrite unrelated visual reading positions.

#### Scenario: User plays a promoted podcast in Scroll Mode
- **WHEN** the user listens to a podcast promoted to a document in Scroll Mode
- **THEN** a committed checkpoint updates both episode playback position and the mapped document time position in one transaction
- **AND** a transaction failure leaves neither representation partially advanced

#### Scenario: Episode has no promoted document
- **WHEN** the user listens to a standalone episode in the podcast manager
- **THEN** its episode position is saved without creating or updating a fictitious document using its episode ID
