## ADDED Requirements

### Requirement: Relocatable and Persisted Rating Controls
The system SHALL support relocatable rating controls in the queue view, allowing the user to position the rating container on any edge of the viewport (top, bottom, left, right), snap it, and persist this setting across sessions.

#### Scenario: User drags the rating container to snap to an edge
- **WHEN** the user drags the rating panel and releases it near an edge of the viewport
- **THEN** the system SHALL calculate the nearest edge (top, bottom, left, or right) and snap the panel to it
- **AND** the system SHALL dynamically update the layout (vertical stack for left/right edges, horizontal row for top/bottom edges)
- **AND** the system SHALL save the new position to settings

#### Scenario: User changes rating controls position using directional UI controls
- **WHEN** the user selects a different position (top, bottom, left, or right) from the placement buttons on the panel or settings
- **THEN** the system SHALL immediately reposition the panel to that edge and update the layout and settings

#### Scenario: Rating controls position is persisted across sessions
- **WHEN** the user opens the queue view in a new session
- **THEN** the rating controls SHALL be initialized at the last saved edge position
