## ADDED Requirements

### Requirement: Queue items expose clear triage actions
The system SHALL present a labeled primary action for each queue item and SHALL keep lower-frequency actions in a keyboard-accessible secondary menu.

#### Scenario: User views a queue item
- **WHEN** a queue item is visible in the queue
- **THEN** its primary action SHALL be available without relying on hover and secondary actions SHALL remain available through a labeled menu

#### Scenario: User uses a secondary action with a keyboard
- **WHEN** a keyboard user opens a queue item action menu
- **THEN** the user SHALL be able to navigate, activate, and dismiss the menu using the keyboard

### Requirement: Reversible triage actions provide recovery feedback
The system SHALL provide immediate confirmation for reversible queue actions and SHALL offer Undo when a supported inverse operation is available.

#### Scenario: User postpones or dismisses a queue item
- **WHEN** the user completes a reversible queue action
- **THEN** the system SHALL show a confirmation message and an Undo action for the configured recovery period

#### Scenario: Undo cannot be completed
- **WHEN** a user activates Undo and the inverse operation fails
- **THEN** the system SHALL preserve accurate queue state and display a clear failure message
