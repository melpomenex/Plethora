## ADDED Requirements

### Requirement: Palette opens saved queue management and creation

Manage Queues and New Queue SHALL open their respective functional interfaces from any app view on desktop and mobile where queue navigation is supported. The interfaces SHALL provide the existing management and creation behavior after navigation or delayed loading, without requiring a second invocation.

#### Scenario: Manage from a document
- **WHEN** the user invokes Manage Queues from an open document
- **THEN** the Queue destination opens and its saved queue manager is visible and interactive
- **AND** existing saved queues can be managed through that interface

#### Scenario: New queue on mobile
- **WHEN** a mobile user invokes New Queue from the palette
- **THEN** the queue creation interface opens
- **AND** saving a valid configuration creates a persisted queue and makes it active

#### Scenario: Empty saved queue list
- **WHEN** the user opens Manage Queues with no saved queues
- **THEN** the manager shows a usable empty state and a creation action

### Requirement: Palette saved queue entries reflect current persisted profiles

The palette SHALL reflect loaded saved queue profiles for the current collection and update labels and membership after creation, rename, deletion, or collection change. Invoking a stale entry SHALL NOT activate an unknown or deleted queue. Loading and load failures SHALL remain distinguishable from an empty list.

#### Scenario: Queues finish loading while palette is open
- **WHEN** saved queues load after the palette opens
- **THEN** commands for those queues appear without restarting the app or reopening the palette

#### Scenario: Queue is renamed or deleted
- **WHEN** a saved queue is renamed or deleted
- **THEN** its command label updates or its entry disappears on the next catalogue update

#### Scenario: Stale deleted entry is invoked
- **WHEN** an entry is activated after its queue was deleted
- **THEN** no unknown active queue is created
- **AND** the user sees an explanation and can choose another queue

#### Scenario: Saved queue loading fails
- **WHEN** loading saved queues fails
- **THEN** the user sees a recoverable load error rather than a misleading empty saved queue list

### Requirement: Palette selection applies the full saved queue configuration

Selecting a saved queue command SHALL activate that profile and display its effective filtered queue using its membership filters, item types, duration, item limit, session goal, and ranking preset where configured. This SHALL work after delayed loading and when the same profile is selected again. A command such as Saved Queues: Quick Review SHALL select that named profile without automatically starting a review. Activation persistence failures SHALL be reported and leave the previous active configuration intact.

#### Scenario: Select Quick Review from another view
- **WHEN** the user invokes Saved Queues: Quick Review from a document
- **THEN** Queue opens with Quick Review active and its full configuration applied
- **AND** displayed eligible items satisfy the profile's filters and item limit
- **AND** a review session does not start automatically

#### Scenario: Queue data arrives after its view mounts
- **WHEN** the selected profile loads after the Queue view mounts
- **THEN** its configuration is applied when available without another invocation

#### Scenario: Reselect the active profile
- **WHEN** the user changes temporary filters and invokes the already active saved queue
- **THEN** the profile's saved configuration is reapplied

#### Scenario: Profile matches no items
- **WHEN** the selected saved queue has no eligible items
- **THEN** the profile remains visibly active and Queue shows its normal empty state
- **AND** unrelated items are not substituted

#### Scenario: Persistence fails
- **WHEN** saving the new active queue fails
- **THEN** the user sees an activation error and can retry
- **AND** the previous active configuration remains intact
