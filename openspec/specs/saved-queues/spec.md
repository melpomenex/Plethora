# saved-queues Specification

## Purpose
Provides user-defined saved queues that allow learners to filter, name, persist, and quickly switch between customized study sessions by category, item type, priority, and session parameters.

## Requirements

### Requirement: Saved Queue Data Model and Persistence
The system SHALL persist named saved queue profiles across sessions and app restarts. Each saved queue SHALL contain a unique identifier, a user-defined display name, an optional icon, filter criteria (categories, tags, item types, priority min/max range, exclude suspended toggle), session limits (duration, max items), and optional adaptive ranking settings (goal and preset ID).

#### Scenario: Saved queue persisted across restart
- **WHEN** a user creates or modifies a saved queue and restarts the application
- **THEN** the saved queue remains available in the list with all configured filters intact

### Requirement: Queue Toolbar and Header Navigation
The system SHALL provide a "Saved Queues" selector in the Queue view header and Toolbar navigation. The selector SHALL display the currently active queue, list all available saved queues, and provide direct actions to create a "New Queue" or manage saved queues.

#### Scenario: Switching active saved queue
- **WHEN** the user selects a saved queue from the Saved Queues selector
- **THEN** the queue list immediately refreshes to filter items according to the saved queue's criteria
- **AND** the active queue indicator updates to display the selected queue's name

#### Scenario: Accessing New Queue from toolbar
- **WHEN** the user clicks "New Queue" in the Saved Queues menu
- **THEN** the system opens the queue creation modal with filter configuration controls

### Requirement: Queue Creation and Editing
The system SHALL allow users to create new saved queues and update existing ones from the session customization interface. Users SHALL be able to specify a queue name, configure membership filters (categories, item types, priority thresholds, tags, suspended items), and save the configuration.

#### Scenario: Creating a new named queue
- **WHEN** the user configures filter criteria, provides a name, and clicks "Save Queue"
- **THEN** the new saved queue is created, persisted, and made active

#### Scenario: Updating an existing saved queue
- **WHEN** the user modifies filter settings on an active saved queue and chooses "Save Changes"
- **THEN** the existing saved queue is updated with the new filter parameters

### Requirement: Saved Queue Management and Deletion
The system SHALL provide a management interface allowing users to rename, duplicate, reorder, set default, and delete saved queues. Deleting a saved queue SHALL NOT delete any underlying documents, extracts, or learning items.

#### Scenario: Deleting a saved queue
- **WHEN** the user confirms deletion of a saved queue
- **THEN** the saved queue is removed from the saved queue list
- **AND** if it was active, the queue view falls back to the default "All Items" view
- **AND** all library items remain intact

#### Scenario: Setting a default saved queue
- **WHEN** the user marks a saved queue as default
- **THEN** subsequent app startups or Queue navigations activate this saved queue automatically

### Requirement: Starter Default Queues
The system SHALL initialize with sensible default starter queues if no custom queues exist, including "All Due" and starter presets matching documented examples ("Quick Review", "Deep Dive"), which users can modify or remove.

#### Scenario: Initializing starter queues on clean install
- **WHEN** the user opens the application for the first time
- **THEN** the system provides default starter queues so the queue selector is immediately functional

### Requirement: Seamless Scroll Mode Integration
When entering Scroll Mode (sequential or optimal), the system SHALL carry the active saved queue's effective item types, categories, and priority filters into the Scroll Mode session.

#### Scenario: Launching Scroll Mode from a saved queue
- **WHEN** a saved queue is active and the user clicks "Scroll Mode" or "Start Optimal Session"
- **THEN** the Scroll Mode session contains only items matching the active saved queue's filter criteria

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
