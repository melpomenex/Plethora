## ADDED Requirements

### Requirement: Synchronize Card Creation
The system SHALL publish a card state update to the shared room's Yjs `learningItems` map immediately upon creating a new learning item on a Tauri device.

#### Scenario: Create a card
- **WHEN** a new learning item is created via `createLearningItem` or generated from an extract
- **THEN** the system publishes the new card details to the Yjs sync map

### Requirement: Synchronize Card Edits
The system SHALL publish a card state update to the shared room's Yjs `learningItems` map immediately upon editing a card's content, state, suspension, or scheduling attributes on a Tauri device.

#### Scenario: Edit a card's question or answer
- **WHEN** a card is edited via `updateLearningItemContentWithVersion` or has its version reverted
- **THEN** the system publishes the updated card details to the Yjs sync map

#### Scenario: Suspend or unsuspend cards
- **WHEN** card suspension status is changed individually or in bulk
- **THEN** the system publishes the updated cards to the Yjs sync map

#### Scenario: Reschedule or load balance cards
- **WHEN** card scheduling is modified via postpone, advance, load balancing, or easy days operations
- **THEN** the system publishes the updated cards with their new schedules to the Yjs sync map

### Requirement: Synchronize Card Deletion
The system SHALL delete the card from the shared room's Yjs `learningItems` map (writing a tombstone) immediately upon deleting a learning item on a Tauri device.

#### Scenario: Delete cards
- **WHEN** cards are deleted individually or in bulk
- **THEN** the system publishes tombstone deletes to the Yjs sync map

### Requirement: Synchronize Card Imports
The system SHALL publish all imported cards to the shared room's Yjs `learningItems` map after importing an Anki package or restoring a collection archive on a Tauri device.

#### Scenario: Import Anki package
- **WHEN** an Anki package is successfully imported
- **THEN** the system publishes all newly imported cards to the Yjs sync map
