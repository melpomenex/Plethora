## ADDED Requirements

### Requirement: Schedule can be entered and left from labelled controls

The Schedule workspace SHALL be reachable from a labelled control and SHALL expose a labelled control that returns the user to the surrounding queue, on every supported presentation. The workspace header SHALL NOT rely on an unrelated header icon as its only means of exit.

#### Scenario: Leaving Schedule on a phone

- **GIVEN** Schedule is displayed on a phone-sized viewport
- **WHEN** the user looks for a way to return to the queue
- **THEN** a control that returns to the queue is visible and labelled
- **AND** activating it returns to the queue's default view

#### Scenario: Leaving Schedule on a desktop-sized viewport

- **WHEN** the user is in Schedule on a desktop-sized viewport and wants to return to the queue
- **THEN** a labelled control returning to the queue is available

#### Scenario: The date filter is not mistaken for an exit

- **GIVEN** a date scope is active in the Schedule workspace
- **WHEN** the user views the workspace header
- **THEN** the control that clears the date scope is distinguishable from the control that leaves Schedule
- **AND** clearing the date scope does not leave the Schedule workspace

#### Scenario: Return target is the queue's default view

- **WHEN** the user leaves Schedule after having switched the queue into another mode
- **THEN** they land on the queue's default view rather than a mode chosen earlier in the same visit

#### Scenario: Keyboard operation

- **WHEN** a keyboard-only user focuses the control that leaves Schedule
- **THEN** it is reachable in the focus order, shows a visible focus state, and activates
