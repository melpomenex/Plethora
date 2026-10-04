## Purpose

Provides user-defined saved queues that allow learners to filter, name, persist, and quickly switch between customized study sessions by category, item type, priority, and session parameters.

## ADDED Requirements

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
