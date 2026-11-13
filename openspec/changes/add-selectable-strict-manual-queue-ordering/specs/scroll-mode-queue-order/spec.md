## MODIFIED Requirements

### Requirement: Scroll Mode Launch in Queue Order

The system SHALL support launching Scroll Mode using the exact sequential order and filtering of the active Reading Queue list items. Optimal Session SHALL preserve the existing eligibility and composition rules and present the resulting items using the active queue ordering mode.

#### Scenario: User launches Scroll Mode from Queue header

- **WHEN** the user clicks the Scroll Mode button in the Queue header
- **THEN** the system opens a session in the exact visible Queue sequence without variety mixing

#### Scenario: User launches Optimal Session

- **WHEN** the user clicks Start Optimal Session with Adaptive active
- **THEN** the system uses the existing adaptive optimal session ordering

#### Scenario: User launches Optimal Session in Strict Manual mode

- **WHEN** the user clicks Start Optimal Session with Strict Manual active
- **THEN** the system orders the eligible composed items by effective manual priority with deterministic ties
